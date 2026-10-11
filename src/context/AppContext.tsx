import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AppGroup,
  AppUser,
  Branding,
  Customer,
  CustomerWithBalance,
  BusinessEffect,
  DriverTransaction,
  DriverTransactionCategory,
  DriverMonthSalary,
  DriverLifetimeSalary,
  SavedBill,
  SupportBusinessSummary,
  Trip,
  TripEditRequest,
  TripInput,
  Vehicle,
  VehicleDocument,
} from '../types';
import type { PaletteMode } from '@mui/material';
import { enqueueTrip, generateClientRequestId, getQueueCount, getQueuedTrips, removeQueuedTrip } from '../utils/offlineQueue';
import { scheduleDocumentReminders } from '../utils/documentReminders';
import { documentStatus, type DocumentStatus } from '../utils/documentStatus';
import { TOKEN_KEY, getApiBase, setApiBase } from '../utils/serverConnection';
import { useKeepAlive } from '../hooks/useKeepAlive';

const DOC_NOTIF_PREFS_KEY = 'shivam_doc_notif_prefs';
const DOC_REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

// Last-known session snapshot, so a cold app start can render the real UI immediately (native-app
// feel) instead of blocking behind a network round-trip to /api/me — which, against a Render free
// instance woken from sleep, can take 30+ seconds and makes the app feel like a slow website load.
// The mount effect below still re-validates against the server right away; this is only what's
// shown while that's in flight.
const ME_CACHE_KEY = 'shivam_cached_me';

function getCachedMe(): { user: AppUser; group: AppGroup } | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedMe(user: AppUser, group: AppGroup) {
  localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ user, group }));
}

// TrackMarg's Get Started flow sends `?mode=signup` to mean "start fresh" - but `user`/`group`
// below are seeded synchronously from whatever is cached in THIS browser, so a leftover session
// from earlier testing or a previous account would render the logged-in dashboard immediately,
// before AuthPage ever gets a chance to show signup. Clearing it here, at module scope, runs
// before AppProvider's useState calls read the cache, which a useEffect (runs after the first
// render) would be one render too late for.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'signup') {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ME_CACHE_KEY);
}

// Keyed by document id. Kept per-browser (not synced to the server) since it's a personal
// "stop bugging me about this one" preference, not shared account data. `expiryDate` pins the
// preference to the document's CURRENT expiry — renewing the document (a new expiryDate) makes
// the stored preference stop matching, so the reminder reappears automatically without needing
// its own cleanup logic.
export interface DocumentReminderPref {
  status: 'snoozed' | 'dismissed';
  expiryDate: string;
  until?: number; // epoch ms; only set for 'snoozed'
}

export interface ActiveDocumentReminder {
  vehicleId: string;
  vehicleNumber: string;
  document: VehicleDocument;
  status: DocumentStatus;
}

function loadDocNotifPrefs(): Record<string, DocumentReminderPref> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DOC_NOTIF_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const THEME_MODE_KEY = 'shivam_theme_mode';

function getStoredThemeMode(): PaletteMode {
  if (typeof window === 'undefined') return 'dark';
  return window.localStorage.getItem(THEME_MODE_KEY) === 'light' ? 'light' : 'dark';
}

export interface SignupInput {
  name: string;
  phone: string;
  password: string;
  role: 'admin' | 'driver';
  groupCode?: string;
  groupName?: string;
  email?: string;
}

export interface LoginInput {
  phone: string;
  password: string;
  // Optional — login no longer requires a group code (a phone number is only unique WITHIN a
  // group server-side). Only sent when completing the multi-account picker below.
  groupCode?: string;
}

// Returned by login() when the same phone + password are valid for more than one business (see
// the comment in backend/src/routes/auth.routes.ts) — no session is issued yet. The caller shows
// a one-tap picker and re-calls login() with the chosen groupCode to finish.
export interface LoginAccountChoice {
  groupCode: string;
  groupName: string;
}

export interface LoginResult {
  requiresGroupSelection?: boolean;
  accounts?: LoginAccountChoice[];
}

interface AppContextType {
  customers: Customer[];
  trips: Trip[];
  pendingTrips: Trip[];
  allTrips: Trip[];
  drivers: AppUser[];
  getDriverTrips: (driverId: string) => Trip[];
  user: AppUser | null;
  group: AppGroup | null;
  branding: Branding | null;
  authLoading: boolean;
  isLoading: boolean;
  addCustomer: (customer: Omit<Customer, 'id'> | string) => Promise<string>;
  addCustomerWithCallback: (customer: Omit<Customer, 'id'>, callback: (id: string) => void, onError?: (error: unknown) => void) => void;
  updateCustomer: (customerId: string, updates: Partial<Customer>) => Promise<void>;
  addCustomerAdvance: (customerId: string, amount: number, note?: string, date?: string) => Promise<void>;
  deleteCustomerAdvance: (customerId: string, advanceId: string) => Promise<void>;
  permanentlyDeleteCustomerAdvance: (customerId: string, advanceId: string) => Promise<void>;
  mergeCustomer: (sourceId: string, intoCustomerId: string) => Promise<void>;
  recordTripPayment: (
    tripId: string,
    input: { amount?: number; fullyPaid?: boolean; fromAdvance?: boolean; paymentMode?: string; note?: string },
  ) => Promise<void>;
  addTrip: (trip: Omit<Trip, 'id'>) => Promise<string>;
  submitDriverTrip: (trip: Omit<Trip, 'id' | 'customerId'> & { customerId?: string }) => Promise<{ queued: boolean }>;
  pendingSyncCount: number;
  isSyncingOffline: boolean;
  flushPendingTrips: () => Promise<void>;
  approveTrip: (tripId: string) => Promise<void>;
  rejectTrip: (tripId: string, reason: string) => Promise<void>;
  updateTrip: (tripId: string, updates: Partial<Trip>) => Promise<void>;
  tripEditRequests: TripEditRequest[];
  requestTripEdit: (tripId: string, message: string) => Promise<void>;
  resolveTripEditRequest: (requestId: string, status: 'resolved' | 'dismissed') => Promise<void>;
  getCustomerTrips: (customerId: string) => Trip[];
  getFilteredTrips: (date: string | null) => Trip[];
  deleteCustomer: (customerId: string) => Promise<void>;
  searchCustomers: (query: string) => CustomerWithBalance[];
  updateTripPaymentStatus: (tripId: string, isPaid: boolean, paymentMode?: string) => Promise<void>;
  login: (input: LoginInput) => Promise<LoginResult>;
  signup: (input: SignupInput) => Promise<{ groupCode: string | null }>;
  logout: () => Promise<void>;
  supportLogin: (password: string) => Promise<string>;
  supportListBusinesses: (supportToken: string) => Promise<SupportBusinessSummary[]>;
  supportAccessBusiness: (supportToken: string, groupCode: string) => Promise<void>;
  supportSetFrozen: (supportToken: string, groupCode: string, frozen: boolean) => Promise<void>;
  supportSetLimits: (
    supportToken: string,
    groupCode: string,
    limits: { maxDrivers: number | null; maxAdmins: number | null; maxBillsPerDay: number | null },
  ) => Promise<void>;
  forgotPassword: (phone: string, groupCode: string) => Promise<string>;
  verifyResetOtp: (phone: string, groupCode: string, otp: string) => Promise<void>;
  resetPassword: (phone: string, groupCode: string, otp: string, newPassword: string) => Promise<void>;
  updateMyEmail: (email: string) => Promise<void>;
  resetDriverPassword: (driverId: string, newPassword: string) => Promise<void>;
  updateDriverSalary: (driverId: string, baseSalary: number, joiningDate?: string | null) => Promise<void>;
  fetchDriverFinance: (
    driverId: string,
    month?: { year: number; month: number },
  ) => Promise<{
    transactions: DriverTransaction[];
    categories: DriverTransactionCategory[];
    salary: DriverMonthSalary;
    lifetimeSalary: DriverLifetimeSalary;
  }>;
  addDriverTransaction: (
    driverId: string,
    input: {
      categoryId?: string; newCategoryName?: string;
      amount: number; note?: string; date?: string;
      deductFromSalary: boolean; businessEffect: BusinessEffect;
    },
  ) => Promise<DriverTransaction[]>;
  updateDriverTransaction: (
    driverId: string,
    transactionId: string,
    input: {
      categoryId?: string; newCategoryName?: string;
      amount: number; note?: string; date?: string;
      deductFromSalary: boolean; businessEffect: BusinessEffect;
    },
  ) => Promise<DriverTransaction[]>;
  deleteDriverTransaction: (driverId: string, transactionId: string) => Promise<DriverTransaction[]>;
  refreshData: () => Promise<void>;
  updateBranding: (updates: Partial<Branding>) => Promise<void>;
  getNextInvoiceNumber: () => Promise<number>;
  sendBillEmail: (to: string, subject: string, text: string) => Promise<void>;
  serverUrl: string;
  saveServerUrl: (url: string) => void;
  themeMode: PaletteMode;
  toggleThemeMode: () => void;
  bills: SavedBill[];
  saveBill: (input: Omit<SavedBill, 'id' | 'groupCode' | 'createdAt' | 'createdBy' | 'customerName'>) => Promise<SavedBill>;
  checkBillGenerationLimit: (customerId: string, method: 'pdf' | 'whatsapp') => Promise<void>;
  deleteBill: (billId: string) => Promise<void>;
  permanentlyDeleteBill: (billId: string) => Promise<void>;
  restoreBackup: (customers: unknown[], trips: unknown[]) => Promise<{ customersImported: number; tripsImported: number }>;
  vehicles: Vehicle[];
  addVehicle: (
    vehicleNumber: string,
    extras?: { assignedDriverId?: string; documents?: { label: string; expiryDate: string }[] },
  ) => Promise<Vehicle>;
  updateVehicle: (
    vehicleId: string,
    updates: { vehicleNumber?: string; assignedDriverId?: string | null },
  ) => Promise<void>;
  addVehicleMaintenance: (
    vehicleId: string,
    input: { type: string; date: string; odometer?: number; cost?: number; notes?: string },
  ) => Promise<void>;
  deleteVehicleMaintenance: (vehicleId: string, maintenanceId: string) => Promise<void>;
  deleteVehicle: (vehicleId: string) => Promise<void>;
  addVehicleDocument: (
    vehicleId: string,
    input: { label: string; expiryDate: string; reminderDaysBefore?: number },
  ) => Promise<void>;
  updateVehicleDocument: (
    vehicleId: string,
    documentId: string,
    updates: { label?: string; expiryDate?: string; reminderDaysBefore?: number },
  ) => Promise<void>;
  deleteVehicleDocument: (vehicleId: string, documentId: string) => Promise<void>;
  activeDocumentReminders: ActiveDocumentReminder[];
  snoozeDocumentReminder: (documentId: string, expiryDate: string) => void;
  dismissDocumentReminder: (documentId: string, expiryDate: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

// Thrown when the server was reached but rejected the request (validation, auth, etc.).
// Carries `status` so callers can distinguish a 401 (truly expired token) from a 5xx or
// network error (server sleeping / unreachable) — only the former should force a logout.
// Any OTHER error out of apiRequest (fetch itself throwing) means the server was unreachable —
// that distinction is what lets submitDriverTrip decide "queue for later" vs "show the error now".
export class ApiError extends Error {
  // Declared as a plain field + assignment rather than a constructor parameter
  // property: `erasableSyntaxOnly` (tsconfig.app.json) rejects the shorthand.
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const storedToken = options.token !== undefined ? options.token : localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${getApiBase()}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (data as { message?: string }).message || 'Request failed',
      response.status,
    );
  }
  return data as T;
}

function approvedTrip(trip: Trip) {
  return (trip.status || 'approved') === 'approved';
}

function normalizeTripInput(tripData: Omit<Trip, 'id'>): TripInput {
  return {
    ...tripData,
    amount: Number(tripData.amount) || 0,
    advanceAmount: Number(tripData.advanceAmount || 0),
  };
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allTrips, setAllTrips]   = useState<Trip[]>([]);
  const [drivers, setDrivers]     = useState<AppUser[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [authLoading, setAuthLoading] = useState(() => !!localStorage.getItem(TOKEN_KEY) && !getCachedMe());
  const [themeMode, setThemeMode]   = useState<PaletteMode>(getStoredThemeMode);
  const [user, setUser]   = useState<AppUser | null>(() => getCachedMe()?.user ?? null);
  const [group, setGroup] = useState<AppGroup | null>(() => getCachedMe()?.group ?? null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [serverUrl, setServerUrlState] = useState<string>(getApiBase());
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => getQueueCount());
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tripEditRequests, setTripEditRequests] = useState<TripEditRequest[]>([]);
  const [docNotifPrefs, setDocNotifPrefs] = useState<Record<string, DocumentReminderPref>>(loadDocNotifPrefs);

  // ── Keep-alive: prevent Render free-tier sleep ────────────────────────
  // Pings /api/health every 4 min while the tab is visible and a token exists.
  // No state, no re-renders — just a fire-and-forget fetch on a timer.
  useKeepAlive();

  const trips = useMemo(() => allTrips.filter(approvedTrip), [allTrips]);
  const pendingTrips = useMemo(
    () => allTrips.filter(t => t.status === 'pending'),
    [allTrips],
  );

  // ── Token helpers ──────────────────────────────────────────────────────
  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ME_CACHE_KEY);
    setUser(null);
    setGroup(null);
    setCustomers([]);
    setAllTrips([]);
    setBranding(null);
    setDrivers([]);
    setBills([]);
    setVehicles([]);
    setTripEditRequests([]);
  }, []);

  // ── Data loading ───────────────────────────────────────────────────────
  const refreshData = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setIsLoading(true);
    try {
      const [customersResp, tripsResp, brandingResp, driversResp, billsResp, vehiclesResp, editRequestsResp] = await Promise.all([
        apiRequest<{ customers: Customer[] }>('/api/customers'),
        apiRequest<{ trips: Trip[] }>('/api/trips'),
        apiRequest<{ branding: Branding }>('/api/branding').catch(() => null),
        apiRequest<{ drivers: AppUser[] }>('/api/drivers').catch(() => null),
        apiRequest<{ bills: SavedBill[] }>('/api/bills').catch(() => null),
        apiRequest<{ vehicles: Vehicle[] }>('/api/vehicles').catch(() => null),
        apiRequest<{ requests: TripEditRequest[] }>('/api/trip-edit-requests').catch(() => null),
      ]);
      setCustomers(customersResp.customers);
      setAllTrips(tripsResp.trips);
      if (brandingResp) setBranding(brandingResp.branding);
      if (driversResp) setDrivers(driversResp.drivers);
      if (billsResp) setBills(billsResp.bills);
      if (vehiclesResp) setVehicles(vehiclesResp.vehicles);
      if (editRequestsResp) setTripEditRequests(editRequestsResp.requests);
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  // ── Restore session on mount ───────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setAuthLoading(false);
      return;
    }
    apiRequest<{ user: AppUser; group: AppGroup }>('/api/me')
      .then(me => {
        setUser(me.user);
        setGroup(me.group);
        setCachedMe(me.user, me.group);
      })
      .catch((err: unknown) => {
        // Only clear the session when the server explicitly rejects the token (401
        // Unauthorized) — meaning the token is genuinely expired or revoked.
        //
        // A plain network error (fetch throws, no response) or a 5xx means the
        // Render server is still waking from sleep — the token is almost certainly
        // still valid, so we keep the cached session alive and let the user continue
        // using the app. The SSE connection will catch up once the server is back.
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(ME_CACHE_KEY);
          setUser(null);
          setGroup(null);
        }
        // For any other error (server sleeping, network blip, 5xx) we leave the
        // cached user/group in state — the UI stays usable and re-validates
        // automatically when the server comes back up.
      })
      .finally(() => setAuthLoading(false));
  }, []);

  // ── Refresh data when user logs in ────────────────────────────────────
  // `user?.id`, not `user` — the SSE 'connected' handler below calls setUser() with a freshly
  // parsed object on every reconnect, which is a new reference even when nothing changed; keying
  // on the id instead means an actual login/logout/impersonation switch still refreshes, without
  // an incidental reconnect re-fetching everything all over again.
  useEffect(() => {
    if (user) refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshData]);

  // ── Document-expiry reminders (in-app notification center + native push) ──
  useEffect(() => {
    window.localStorage.setItem(DOC_NOTIF_PREFS_KEY, JSON.stringify(docNotifPrefs));
  }, [docNotifPrefs]);

  // Every vehicle document that's due-soon or expired, minus whichever ones the admin snoozed
  // (until the snooze expires) or permanently dismissed for their current expiry date. Sorted
  // soonest-to-expire (and therefore already-expired) first. This is the single source of truth
  // behind the notification bell, the sidebar badge, the Layout banner, and native scheduling —
  // one list so all four always agree.
  const activeDocumentReminders = useMemo<ActiveDocumentReminder[]>(() => {
    const now = Date.now();
    const result: ActiveDocumentReminder[] = [];
    for (const vehicle of vehicles) {
      for (const document of vehicle.documents) {
        const status = documentStatus(document);
        if (status.state === 'ok') continue;
        const pref = docNotifPrefs[document.id];
        if (pref && pref.expiryDate === document.expiryDate) {
          if (pref.status === 'dismissed') continue;
          if (pref.status === 'snoozed' && pref.until && pref.until > now) continue;
        }
        result.push({ vehicleId: vehicle.id, vehicleNumber: vehicle.vehicleNumber, document, status });
      }
    }
    return result.sort((a, b) => a.status.daysUntilExpiry - b.status.daysUntilExpiry);
  }, [vehicles, docNotifPrefs]);

  const snoozeDocumentReminder = useCallback((documentId: string, expiryDate: string) => {
    setDocNotifPrefs(prev => ({
      ...prev,
      [documentId]: { status: 'snoozed', expiryDate, until: Date.now() + DOC_REMINDER_SNOOZE_MS },
    }));
  }, []);

  const dismissDocumentReminder = useCallback((documentId: string, expiryDate: string) => {
    setDocNotifPrefs(prev => ({ ...prev, [documentId]: { status: 'dismissed', expiryDate } }));
  }, []);

  // Native device push — re-runs whenever the active-reminder list changes (login, app open, any
  // add/edit/delete of a vehicle or document, or a snooze/dismiss action), so scheduled
  // notifications never drift from what's actually active.
  useEffect(() => {
    if (user?.role !== 'admin') return;
    scheduleDocumentReminders(activeDocumentReminders.map(r => ({ vehicleNumber: r.vehicleNumber, document: r.document }))).catch(() => {});
  }, [activeDocumentReminders, user]);

  // ── Real-time updates via SSE ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const token = getToken();
    if (!token) return;
    const events = new EventSource(`${getApiBase()}/api/events?token=${encodeURIComponent(token)}`);
    const handleChange = () => refreshData();
    events.addEventListener('data-changed',   handleChange);
    events.addEventListener('trip-submitted', handleChange);
    events.addEventListener('trip-updated',   handleChange);
    // Pushed by the support console's freeze/unfreeze toggle — applies instantly to every open
    // device on this group code, admin and driver alike, without waiting for a page reload.
    events.addEventListener('account-frozen',   () => setGroup(prev => (prev ? { ...prev, frozen: true } : prev)));
    events.addEventListener('account-unfrozen', () => setGroup(prev => (prev ? { ...prev, frozen: false } : prev)));
    // Sent once right after the connection opens (including every reconnect) — used as a cheap
    // "catch up" signal: re-checking /api/me here means a freeze/unfreeze (or anything else) that
    // happened during a dropped connection (phone backgrounded, brief network loss, ...) still
    // gets picked up the moment the connection comes back, with no page reload needed.
    events.addEventListener('connected', () => {
      apiRequest<{ user: AppUser; group: AppGroup }>('/api/me').then(me => {
        setUser(me.user);
        setGroup(me.group);
        setCachedMe(me.user, me.group);
      }).catch(() => {});
    });
    // Deliberately NOT closing here — the browser's native EventSource already retries on its own
    // after a drop (network blip, phone backgrounding, ...). Calling close() in onerror, as this
    // used to, permanently kills that built-in retry, which is why a freeze/unfreeze (or any other
    // live update) would silently stop arriving until the page was manually reloaded.
    events.onerror = () => {};
    return () => events.close();
    // Deliberately `user?.id`, not `user` — the 'connected' handler above calls setUser() with a
    // freshly-parsed object on every (re)connect, which is a NEW reference even when nothing
    // actually changed. Depending on the whole `user` object here would tear down and recreate
    // this very connection every time that fires, which re-fires 'connected' immediately, which
    // calls setUser() again — a tight reconnect-storm loop that was hammering the API with
    // dozens of requests per second before this was narrowed to the one thing that should
    // actually restart the connection: switching to a different logged-in user (or logging out).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, getToken, refreshData]);

  // ── Auth actions ───────────────────────────────────────────────────────
  const login = async (input: LoginInput): Promise<LoginResult> => {
    const result = await apiRequest<
      { token: string; user: AppUser; group: AppGroup } | LoginResult
    >('/api/auth/login', { method: 'POST', body: input, token: null });

    // No token yet — same phone+password matched more than one business. Hand the list back
    // for AuthPage to show a picker; nothing to store, no session started.
    if (!('token' in result)) {
      return result;
    }

    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    setGroup(result.group);
    setCachedMe(result.user, result.group);
    return {};
  };

  const signup = async (input: SignupInput): Promise<{ groupCode: string | null }> => {
    const result = await apiRequest<{ token: string; user: AppUser; group: AppGroup }>(
      '/api/auth/signup',
      { method: 'POST', body: input, token: null },
    );
    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    setGroup(result.group);
    setCachedMe(result.user, result.group);
    return { groupCode: input.role === 'admin' ? result.group.code : null };
  };

  const logout = async (): Promise<void> => {
    clearSession();
  };

  // ── Support/master access (cross-tenant, for remote troubleshooting) ──────
  // Used only by the standalone /support console (see pages/SupportConsole.tsx) — not reachable
  // from anywhere in the normal client-facing UI. The support token itself lives in that page's
  // own state (not here), since it's a separate, short-lived credential unrelated to any one
  // business's session; these just make the three backend calls it needs.
  const supportLogin = async (password: string): Promise<string> => {
    const result = await apiRequest<{ token: string }>('/api/support/login', {
      method: 'POST', body: { password }, token: null,
    });
    return result.token;
  };

  const supportListBusinesses = async (supportToken: string): Promise<SupportBusinessSummary[]> => {
    const result = await apiRequest<{ groups: SupportBusinessSummary[] }>('/api/support/groups', {
      token: supportToken,
    });
    return result.groups;
  };

  // Logs this app instance into the chosen business as its admin — same effect as that admin
  // logging in themself, so every existing page/feature just works with no special-casing.
  const supportAccessBusiness = async (supportToken: string, groupCode: string): Promise<void> => {
    const result = await apiRequest<{ token: string; user: AppUser; group: AppGroup }>(
      '/api/support/impersonate',
      { method: 'POST', body: { groupCode }, token: supportToken },
    );
    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    setGroup(result.group);
    setCachedMe(result.user, result.group);
  };

  // Freezes/unfreezes a business from the /support console — the target business's own devices
  // hear about it via the SSE listener above; this call just needs to succeed for the support
  // console's own list to update.
  const supportSetFrozen = async (supportToken: string, groupCode: string, frozen: boolean): Promise<void> => {
    await apiRequest<{ group: AppGroup }>('/api/support/set-frozen', {
      method: 'POST', body: { groupCode, frozen }, token: supportToken,
    });
  };

  // Sets (or clears, by passing null) this business's driver/admin seat caps and daily bill
  // limit — enforced server-side at signup and bill creation, so this call is just how the
  // support console's own list picks up the new values.
  const supportSetLimits = async (
    supportToken: string,
    groupCode: string,
    limits: { maxDrivers: number | null; maxAdmins: number | null; maxBillsPerDay: number | null },
  ): Promise<void> => {
    await apiRequest<{ group: AppGroup }>('/api/support/set-limits', {
      method: 'POST', body: { groupCode, ...limits }, token: supportToken,
    });
  };

  const forgotPassword = async (phone: string, groupCode: string): Promise<string> => {
    const result = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { phone, groupCode },
      token: null,
    });
    return result.message;
  };

  const verifyResetOtp = async (phone: string, groupCode: string, otp: string): Promise<void> => {
    await apiRequest<{ ok: boolean }>('/api/auth/verify-reset-otp', {
      method: 'POST',
      body: { phone, groupCode, otp },
      token: null,
    });
  };

  const resetPassword = async (phone: string, groupCode: string, otp: string, newPassword: string): Promise<void> => {
    await apiRequest<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: { phone, groupCode, otp, newPassword },
      token: null,
    });
  };

  const updateMyEmail = async (email: string): Promise<void> => {
    const result = await apiRequest<{ user: AppUser }>('/api/me', { method: 'PATCH', body: { email } });
    setUser(result.user);
  };

  const resetDriverPassword = async (driverId: string, newPassword: string): Promise<void> => {
    await apiRequest<{ ok: boolean }>(`/api/drivers/${driverId}/reset-password`, {
      method: 'POST',
      body: { newPassword },
    });
  };

  const updateDriverSalary = async (driverId: string, baseSalary: number, joiningDate?: string | null): Promise<void> => {
    await apiRequest<{ driver: AppUser }>(`/api/drivers/${driverId}/salary`, {
      method: 'PATCH',
      body: { baseSalary, joiningDate },
    });
    await refreshData();
  };

  const fetchDriverFinance = async (
    driverId: string,
    month?: { year: number; month: number },
  ): Promise<{
    transactions: DriverTransaction[];
    categories: DriverTransactionCategory[];
    salary: DriverMonthSalary;
    lifetimeSalary: DriverLifetimeSalary;
  }> => {
    const query = month ? `?month=${month.year}-${month.month}` : '';
    return apiRequest(`/api/drivers/${driverId}/finance${query}`);
  };

  const addDriverTransaction = async (
    driverId: string,
    input: {
      categoryId?: string; newCategoryName?: string;
      amount: number; note?: string; date?: string;
      deductFromSalary: boolean; businessEffect: BusinessEffect;
    },
  ): Promise<DriverTransaction[]> => {
    const result = await apiRequest<{ transactions: DriverTransaction[] }>(`/api/drivers/${driverId}/transactions`, {
      method: 'POST',
      body: input,
    });
    return result.transactions;
  };

  const updateDriverTransaction = async (
    driverId: string,
    transactionId: string,
    input: {
      categoryId?: string; newCategoryName?: string;
      amount: number; note?: string; date?: string;
      deductFromSalary: boolean; businessEffect: BusinessEffect;
    },
  ): Promise<DriverTransaction[]> => {
    const result = await apiRequest<{ transactions: DriverTransaction[] }>(`/api/drivers/${driverId}/transactions/${transactionId}`, {
      method: 'PATCH',
      body: input,
    });
    return result.transactions;
  };

  const deleteDriverTransaction = async (driverId: string, transactionId: string): Promise<DriverTransaction[]> => {
    const result = await apiRequest<{ transactions: DriverTransaction[] }>(`/api/drivers/${driverId}/transactions/${transactionId}`, {
      method: 'DELETE',
    });
    return result.transactions;
  };

  // ── Customer actions ───────────────────────────────────────────────────
  const addCustomer = async (customerData: Omit<Customer, 'id'> | string): Promise<string> => {
    const body =
      typeof customerData === 'string'
        ? { name: customerData, phone: '', address: '' }
        : customerData;
    const response = await apiRequest<{ customer: Customer }>('/api/customers', {
      method: 'POST',
      body,
    });
    await refreshData();
    return response.customer.id;
  };

  const addCustomerWithCallback = (
    customerData: Omit<Customer, 'id'>,
    callback: (id: string) => void,
    onError?: (error: unknown) => void,
  ) => {
    addCustomer(customerData)
      .then(callback)
      .catch(err => {
        console.error('Error adding customer:', err);
        onError?.(err);
      });
  };

  const updateCustomer = async (customerId: string, updates: Partial<Customer>) => {
    await apiRequest<{ customer: Customer }>(`/api/customers/${customerId}`, {
      method: 'PATCH',
      body: updates,
    });
    await refreshData();
  };

  const deleteCustomer = async (customerId: string) => {
    await apiRequest<{ ok: boolean }>(`/api/customers/${customerId}`, { method: 'DELETE' });
    await refreshData();
  };

  const addCustomerAdvance = async (customerId: string, amount: number, note?: string, date?: string) => {
    await apiRequest<{ customer: Customer }>(`/api/customers/${customerId}/advance`, {
      method: 'POST',
      body: { amount, note, date },
    });
    await refreshData();
  };

  const deleteCustomerAdvance = async (customerId: string, advanceId: string) => {
    await apiRequest<{ customer: Customer }>(`/api/customers/${customerId}/advance/${advanceId}`, {
      method: 'DELETE',
    });
    await refreshData();
  };

  const permanentlyDeleteCustomerAdvance = async (customerId: string, advanceId: string) => {
    await apiRequest<{ customer: Customer }>(`/api/customers/${customerId}/advance/${advanceId}/permanent`, {
      method: 'DELETE',
    });
    await refreshData();
  };

  const mergeCustomer = async (sourceId: string, intoCustomerId: string) => {
    await apiRequest<{ customer: Customer }>(`/api/customers/${sourceId}/merge`, {
      method: 'POST',
      body: { intoCustomerId },
    });
    await refreshData();
  };

  // ── Trip actions ───────────────────────────────────────────────────────
  const addTrip = async (tripData: Omit<Trip, 'id'>): Promise<string> => {
    const customer = customers.find(c => c.id === tripData.customerId);
    const response = await apiRequest<{ trip: Trip }>('/api/trips', {
      method: 'POST',
      body: normalizeTripInput({
        ...tripData,
        customerName: tripData.customerName || customer?.name || '',
        customerPhone: tripData.customerPhone || customer?.phone || '',
        customerAddress: tripData.customerAddress || customer?.address || '',
      }),
    });
    await refreshData();
    return response.trip.id;
  };

  // Sends every locally-queued trip (saved when a driver submitted with no connection to the
  // server). Stops at the first item that still fails due to no connection — those stay queued
  // and we'll try the whole batch again on the next trigger (reconnect event / periodic timer /
  // next successful submission). A trip the server actively rejects (ApiError) is also left in
  // place rather than silently discarded, since the driver's data shouldn't just vanish.
  const flushPendingTrips = useCallback(async () => {
    const queue = getQueuedTrips();
    if (!queue.length) return;
    setIsSyncingOffline(true);
    let sentAny = false;
    try {
      for (const item of queue) {
        try {
          await apiRequest<{ trip: Trip }>('/api/trips', { method: 'POST', body: item.payload });
          removeQueuedTrip(item.localId);
          sentAny = true;
        } catch {
          break; // still unreachable (or rejected) — stop this round, try again later
        }
      }
    } finally {
      setPendingSyncCount(getQueueCount());
      setIsSyncingOffline(false);
    }
    if (sentAny) await refreshData();
  }, [refreshData]);

  const submitDriverTrip = async (
    tripData: Omit<Trip, 'id' | 'customerId'> & { customerId?: string },
  ): Promise<{ queued: boolean }> => {
    const body = {
      ...tripData,
      amount: Number(tripData.amount) || 0,
      advanceAmount: Number(tripData.advanceAmount || 0),
      // Generated once and carried through every attempt (this call and every offline-queue
      // retry below) — lets the server recognize a retry of a submission that actually went
      // through but whose response never reached this device, instead of creating a duplicate.
      clientRequestId: generateClientRequestId(),
    };
    try {
      await apiRequest<{ trip: Trip }>('/api/trips', { method: 'POST', body });
      await refreshData();
      flushPendingTrips(); // opportunistically clear out any older queued trips too
      return { queued: false };
    } catch (error) {
      if (error instanceof ApiError) throw error; // server reached and rejected it — surface now
      enqueueTrip(body); // no connection — save it and let background sync handle it
      setPendingSyncCount(getQueueCount());
      return { queued: true };
    }
  };

  // ── Offline queue: retry on reconnect, and keep nudging it periodically ────
  useEffect(() => {
    if (!user) return;
    flushPendingTrips();
    const handleOnline = () => flushPendingTrips();
    window.addEventListener('online', handleOnline);
    const interval = window.setInterval(() => flushPendingTrips(), 20000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.clearInterval(interval);
    };
  }, [user, flushPendingTrips]);

  const updateTrip = async (tripId: string, updates: Partial<Trip>) => {
    await apiRequest<{ trip: Trip }>(`/api/trips/${tripId}`, {
      method: 'PATCH',
      body: updates,
    });
    await refreshData();
  };

  // A driver's ask for a change to a trip that's already approved (and so can't be edited
  // directly anymore) — an admin reviews the message and applies it themself.
  const requestTripEdit = async (tripId: string, message: string) => {
    await apiRequest<{ request: TripEditRequest }>(`/api/trips/${tripId}/edit-requests`, {
      method: 'POST',
      body: { message },
    });
    await refreshData();
  };

  const resolveTripEditRequest = async (requestId: string, status: 'resolved' | 'dismissed') => {
    await apiRequest<{ request: TripEditRequest }>(`/api/trip-edit-requests/${requestId}`, {
      method: 'PATCH',
      body: { status },
    });
    await refreshData();
  };

  const approveTrip = async (tripId: string) => {
    await apiRequest<{ trip: Trip }>(`/api/trips/${tripId}/approve`, { method: 'POST' });
    await refreshData();
  };

  const rejectTrip = async (tripId: string, reason: string) => {
    await apiRequest<{ trip: Trip }>(`/api/trips/${tripId}/reject`, {
      method: 'POST',
      body: { reason },
    });
    await refreshData();
  };

  const updateTripPaymentStatus = async (tripId: string, isPaid: boolean, paymentMode?: string) => {
    await updateTrip(tripId, { isPaid, ...(paymentMode ? { paymentMode } : {}) } as Partial<Trip>);
  };

  const recordTripPayment = async (
    tripId: string,
    input: { amount?: number; fullyPaid?: boolean; fromAdvance?: boolean; paymentMode?: string; note?: string },
  ) => {
    await apiRequest<{ trip: Trip }>(`/api/trips/${tripId}/payment`, {
      method: 'POST',
      body: input,
    });
    await refreshData();
  };

  // ── Branding / bill theme ───────────────────────────────────────────────
  const updateBranding = async (updates: Partial<Branding>) => {
    const response = await apiRequest<{ branding: Branding }>('/api/branding', {
      method: 'PUT',
      body: updates,
    });
    setBranding(response.branding);
  };

  const getNextInvoiceNumber = async (): Promise<number> => {
    const response = await apiRequest<{ invoiceNumber: number }>('/api/branding/next-invoice-number', {
      method: 'POST',
    });
    return response.invoiceNumber;
  };

  // ── Saved bills ("My Bills") ─────────────────────────────────────────────
  const saveBill = async (
    input: Omit<SavedBill, 'id' | 'groupCode' | 'createdAt' | 'createdBy' | 'customerName'>,
  ): Promise<SavedBill> => {
    const response = await apiRequest<{ bill: SavedBill }>('/api/bills', {
      method: 'POST',
      body: input,
    });
    setBills(prev => [response.bill, ...prev]);
    return response.bill;
  };

  // Checked before a bill is downloaded as a PDF or shared to WhatsApp — those never otherwise
  // reach the server, so without this call they'd silently bypass the support-set daily bill
  // limit that saving to My Bills already enforces. Throws (ApiError) if the group is at its cap;
  // callers should stop before generating the document.
  const checkBillGenerationLimit = async (customerId: string, method: 'pdf' | 'whatsapp'): Promise<void> => {
    await apiRequest<{ ok: boolean }>('/api/bills/generation', {
      method: 'POST',
      body: { customerId, method },
    });
  };

  const deleteBill = async (billId: string) => {
    const response = await apiRequest<{ bill: SavedBill }>(`/api/bills/${billId}`, { method: 'DELETE' });
    setBills(prev => prev.map(b => (b.id === billId ? response.bill : b)));
  };

  const permanentlyDeleteBill = async (billId: string) => {
    await apiRequest<{ ok: boolean }>(`/api/bills/${billId}/permanent`, { method: 'DELETE' });
    setBills(prev => prev.filter(b => b.id !== billId));
  };

  // ── Restore from a downloaded backup file ───────────────────────────────
  const restoreBackup = async (customers: unknown[], trips: unknown[]) => {
    const response = await apiRequest<{ customersImported: number; tripsImported: number }>('/api/restore', {
      method: 'POST',
      body: { customers, trips },
    });
    await refreshData();
    return response;
  };

  // ── Vehicles & document-expiry reminders ────────────────────────────────
  const addVehicle = async (
    vehicleNumber: string,
    extras: { assignedDriverId?: string; documents?: { label: string; expiryDate: string }[] } = {},
  ): Promise<Vehicle> => {
    const response = await apiRequest<{ vehicle: Vehicle }>('/api/vehicles', {
      method: 'POST',
      body: { vehicleNumber, ...extras },
    });
    setVehicles(prev => [...prev, response.vehicle].sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber)));
    return response.vehicle;
  };

  const updateVehicle = async (
    vehicleId: string,
    updates: { vehicleNumber?: string; assignedDriverId?: string | null },
  ) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}`, {
      method: 'PATCH',
      body: updates,
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
  };

  const addVehicleMaintenance = async (
    vehicleId: string,
    input: { type: string; date: string; odometer?: number; cost?: number; notes?: string },
  ) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}/maintenance`, {
      method: 'POST',
      body: input,
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
  };

  const deleteVehicleMaintenance = async (vehicleId: string, maintenanceId: string) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}/maintenance/${maintenanceId}`, {
      method: 'DELETE',
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
  };

  const deleteVehicle = async (vehicleId: string) => {
    await apiRequest<{ ok: boolean }>(`/api/vehicles/${vehicleId}`, { method: 'DELETE' });
    const removedDocIds = vehicles.find(v => v.id === vehicleId)?.documents.map(d => d.id) || [];
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
    if (removedDocIds.length) {
      setDocNotifPrefs(prev => {
        const next = { ...prev };
        for (const docId of removedDocIds) delete next[docId];
        return next;
      });
    }
  };

  const addVehicleDocument = async (
    vehicleId: string,
    input: { label: string; expiryDate: string; reminderDaysBefore?: number },
  ) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}/documents`, {
      method: 'POST',
      body: input,
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
  };

  const updateVehicleDocument = async (
    vehicleId: string,
    documentId: string,
    updates: { label?: string; expiryDate?: string; reminderDaysBefore?: number },
  ) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}/documents/${documentId}`, {
      method: 'PATCH',
      body: updates,
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
  };

  const deleteVehicleDocument = async (vehicleId: string, documentId: string) => {
    const response = await apiRequest<{ vehicle: Vehicle }>(`/api/vehicles/${vehicleId}/documents/${documentId}`, {
      method: 'DELETE',
    });
    setVehicles(prev => prev.map(v => (v.id === vehicleId ? response.vehicle : v)));
    setDocNotifPrefs(prev => {
      if (!(documentId in prev)) return prev;
      const next = { ...prev };
      delete next[documentId];
      return next;
    });
  };

  // ── Notifications ───────────────────────────────────────────────────────
  const sendBillEmail = async (to: string, subject: string, text: string) => {
    await apiRequest<{ ok: boolean }>('/api/notify/email', {
      method: 'POST',
      body: { to, subject, text },
    });
  };

  // ── Server address (which machine this app talks to) ───────────────────
  const saveServerUrl = (url: string) => {
    setApiBase(url);
    setServerUrlState(getApiBase());
  };

  // ── Query helpers ──────────────────────────────────────────────────────
  const getCustomerTrips = (customerId: string): Trip[] =>
    trips.filter(t => t.customerId === customerId);

  const getDriverTrips = (driverId: string): Trip[] =>
    trips.filter(t => t.driverId === driverId);

  const getFilteredTrips = (date: string | null): Trip[] => {
    if (!date) return trips;
    return trips.filter(t => t.date.slice(0, 10) === date.slice(0, 10));
  };

  const searchCustomers = (query: string): CustomerWithBalance[] => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    return customers
      .filter(c => c.name.toLowerCase().includes(lowerQuery) || c.phone.includes(query))
      .map(customer => {
        const customerTrips = getCustomerTrips(customer.id);
        const totalAmount = customerTrips.reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const paidAmount  = customerTrips
          .filter(t => t.isPaid)
          .reduce((sum, t) => sum + Number(t.amount || 0), 0);
        return { ...customer, balance: totalAmount - paidAmount };
      });
  };

  const toggleThemeMode = () => setThemeMode(prev => {
    const next = prev === 'light' ? 'dark' : 'light';
    window.localStorage.setItem(THEME_MODE_KEY, next);
    return next;
  });

  return (
    <AppContext.Provider
      value={{
        customers, trips, pendingTrips, allTrips,
        drivers, getDriverTrips,
        user, group, branding,
        authLoading, isLoading,
        addCustomer, addCustomerWithCallback, updateCustomer,
        addCustomerAdvance, deleteCustomerAdvance, permanentlyDeleteCustomerAdvance, mergeCustomer,
        addTrip, submitDriverTrip,
        pendingSyncCount, isSyncingOffline, flushPendingTrips,
        approveTrip, rejectTrip, updateTrip, recordTripPayment,
        tripEditRequests, requestTripEdit, resolveTripEditRequest,
        getCustomerTrips, getFilteredTrips,
        searchCustomers, updateTripPaymentStatus,
        deleteCustomer,
        updateBranding, getNextInvoiceNumber, sendBillEmail,
        bills, saveBill, checkBillGenerationLimit, deleteBill, permanentlyDeleteBill, restoreBackup,
        vehicles, addVehicle, updateVehicle, deleteVehicle,
        addVehicleMaintenance, deleteVehicleMaintenance,
        addVehicleDocument, updateVehicleDocument, deleteVehicleDocument,
        activeDocumentReminders, snoozeDocumentReminder, dismissDocumentReminder,
        serverUrl, saveServerUrl,
        themeMode, toggleThemeMode,
        login, signup, logout,
        supportLogin, supportListBusinesses, supportAccessBusiness, supportSetFrozen, supportSetLimits,
        forgotPassword, verifyResetOtp, resetPassword, updateMyEmail, resetDriverPassword,
        updateDriverSalary, fetchDriverFinance,
        addDriverTransaction, updateDriverTransaction, deleteDriverTransaction,
        refreshData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useAppContext(): AppContextType {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useAppContext must be used within an AppProvider');
  return context;
}
