import crypto from 'node:crypto';

export interface BankAccount {
  id: string;
  label: string;
  bankName: string;
  bankBranch: string;
  accountNumber: string;
  ifscCode: string;
}

export interface Branding {
  companyName: string;
  tagline: string;
  proprietorName: string;
  phone1: string;
  phone2: string;
  address: string;
  gstNumber: string;
  footerNote: string;
  primaryColor: string;
  accentColor: string;
  logoDataUrl: string;
  signatureDataUrl: string;
  headerLeftImageDataUrl: string;
  headerRightImageDataUrl: string;
  upiQrImageDataUrl: string;
  upiQrShowOn: 'both' | 'gst' | 'non-gst';
  bankName: string;
  bankBranch: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccounts: BankAccount[];
  publicServerUrl: string;
  nextInvoiceNumber: number;
}

export const DEFAULT_BRANDING: Branding = {
  companyName: 'Transport Manager',
  tagline: 'Transport & Logistics Solutions',
  proprietorName: '',
  phone1: '',
  phone2: '',
  address: '',
  gstNumber: '',
  footerNote: 'Thank you for your business!',
  primaryColor: '#0B2B5E',
  accentColor: '#F0B90B',
  logoDataUrl: '',
  signatureDataUrl: '',
  headerLeftImageDataUrl: '',
  headerRightImageDataUrl: '',
  upiQrImageDataUrl: '',
  upiQrShowOn: 'both',
  bankName: '',
  bankBranch: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankAccounts: [],
  publicServerUrl: '',
  nextInvoiceNumber: 1,
};

// Fields a driver's own UI needs (cosmetic) — bank details, phone numbers, address and GST are
// admin-only, since billing pages are admin-only routes and there's no reason a driver account
// should be able to pull them via a direct API call either.
export const DRIVER_VISIBLE_BRANDING_FIELDS: (keyof Branding)[] = [
  'companyName', 'tagline', 'primaryColor', 'accentColor', 'logoDataUrl', 'footerNote',
];

export function getBranding(group: { branding?: Partial<Branding> } | null | undefined): Branding {
  return { ...DEFAULT_BRANDING, ...(group?.branding || {}) };
}

export function sanitizeBankAccounts(value: unknown): BankAccount[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((account: Record<string, unknown>) => ({
    id: String(account?.id || '').trim() || `bank-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    label: String(account?.label || '').trim(),
    bankName: String(account?.bankName || '').trim(),
    bankBranch: String(account?.bankBranch || '').trim(),
    accountNumber: String(account?.accountNumber || '').trim(),
    ifscCode: String(account?.ifscCode || '').trim(),
  })).filter(account => account.label || account.bankName || account.accountNumber);
}
