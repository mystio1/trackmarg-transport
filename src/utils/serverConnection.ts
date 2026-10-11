// Where the app talks to the backend, and where the logged-in session token lives — shared by
// AppContext (the normal client login flow) and the /support console (which writes a real
// session token here too, after impersonating a business's admin, so the rest of the app treats
// it exactly like a normal login with no special-casing needed).
export const TOKEN_KEY = 'shivam_session_token';
export const SERVER_URL_KEY = 'shivam_server_url';

// import.meta.env.VITE_API_URL is a BUILD-TIME replacement — it gets baked into every build the
// same way, including `npm run dev`, so a plain `VITE_API_URL || ...` fallback made local dev
// against the Vite server always default to production no matter which port served the page
// (the port-number check below it never even ran). import.meta.env.DEV is true only for `vite`/
// `npm run dev` and false for every actual build (`vite build` — used for the production web
// bundle, `npm run start`'s local server, and the Capacitor mobile app), so gating on it instead
// keeps local dev pointed at the local backend while leaving those other targets unaffected.
const BUILT_IN_DEFAULT_BASE = import.meta.env.DEV
  ? 'http://localhost:4000'
  : (import.meta.env.VITE_API_URL || '');

// The server address a driver/admin's phone talks to is resolved at RUNTIME (not baked into
// the build) so the same installed app can be pointed at whichever server the admin runs —
// e.g. a Cloudflare Tunnel URL shared via the join screen. Falls back to the build-time default.
export function getApiBase(): string {
  if (typeof window === 'undefined') return BUILT_IN_DEFAULT_BASE;
  const stored = window.localStorage.getItem(SERVER_URL_KEY);
  return (stored && stored.trim()) || BUILT_IN_DEFAULT_BASE;
}

export function setApiBase(url: string) {
  if (typeof window === 'undefined') return;
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) window.localStorage.setItem(SERVER_URL_KEY, trimmed);
  else window.localStorage.removeItem(SERVER_URL_KEY);
}
