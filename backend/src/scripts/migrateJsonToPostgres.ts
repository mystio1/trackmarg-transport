// One-time data migration: backend/data/db.json (the legacy single-document store, whether it
// was ever backed by that local file directly or by MongoDB — see the removed legacyDb.ts) into
// Postgres via Prisma. Run with: npx tsx backend/src/scripts/migrateJsonToPostgres.ts <path-to-db.json>
//
// Split into a pure transform (buildMigrationPlan — no I/O, no Prisma; unit-tested in
// migrateJsonToPostgres.test.ts) and an I/O-driving loader (runMigration + main), so the tricky
// part (remapping old string ids, dropping fields that shouldn't survive, nulling out dangling
// references) is verifiable without a live database.
import fs from 'node:fs';
import path from 'node:path';
import type { DbClient } from '../db/prisma.js';

// ── Legacy shapes (deliberately loose — this is reading years-old, hand-evolved JSON) ─────────
interface LegacyGroup {
  code: string;
  name: string;
  createdAt?: string;
  branding?: Record<string, unknown> & { bankAccounts?: Record<string, unknown>[] };
}
interface LegacyUser {
  id: string; groupCode: string; role: 'admin' | 'driver'; name: string; phone: string;
  userCode?: string; email?: string; passwordHash: string; active?: boolean;
  createdAt?: string; updatedAt?: string;
  // resetOtpHash/resetOtpExpiresAt/resetOtpAttempts intentionally NOT in this type — they're
  // transient, mid-flow state that shouldn't survive a data migration (a code emailed under the
  // old system is meaningless after cutover; a leftover hash is just dead weight, not a security
  // issue, but there's no reason to carry it over either).
}
interface LegacyAdvanceEntry {
  id: string; amount: number; note?: string; date: string; createdAt?: string;
  deleted?: boolean; deletedAt?: string; usedInBillNo?: string;
}
interface LegacyCustomer {
  id: string; groupCode: string; name: string; phone?: string; address?: string; email?: string;
  gstNumber?: string; advanceBalance?: number; advanceHistory?: LegacyAdvanceEntry[];
  createdAt?: string; updatedAt?: string;
}
interface LegacyTrip {
  id: string; groupCode: string; customerId?: string; customerName?: string;
  customerPhone?: string; customerAddress?: string; driverId?: string; driverName?: string;
  driverCode?: string; date?: string; pickupLocation?: string; dropLocation?: string;
  amount?: number; advanceAmount?: number; isPaid?: boolean; paidAmount?: number;
  paymentMode?: string; paymentNote?: string; paidAt?: string; vehicleType?: string; vehicleNumber?: string;
  materialType?: string; status?: string; rejectionReason?: string; submittedAt?: string;
  updatedAt?: string; approvedAt?: string; approvedBy?: string;
}
interface LegacyVehicleDocument {
  id: string; label: string; expiryDate: string; reminderDaysBefore?: number;
  createdAt?: string; updatedAt?: string;
}
interface LegacyVehicle {
  id: string; groupCode: string; vehicleNumber: string; documents?: LegacyVehicleDocument[];
  createdAt?: string; updatedAt?: string;
}
interface LegacyTripEditRequest {
  id: string; groupCode: string; tripId: string; driverId: string; driverName?: string;
  message: string; status?: string; createdAt?: string; resolvedAt?: string;
}
interface LegacyBillTripLine {
  tripId?: string; date?: string; pickupLocation?: string; dropLocation?: string;
  amount?: number; paidAmount?: number;
}
interface LegacyBill {
  id: string; groupCode: string; customerId?: string; customerName?: string; billNo?: string;
  billDate?: string; isGstBill?: boolean; gstPercent?: number; discount?: number;
  subTotal?: number; received?: number; gstAmount?: number; grandTotal?: number;
  advanceApplied?: number; netPayable?: number; amountInWords?: string;
  trips?: LegacyBillTripLine[]; customerPhone?: string; customerAddress?: string;
  customerGst?: string; bankName?: string; bankBranch?: string; accountNumber?: string;
  ifscCode?: string; createdAt?: string; createdBy?: string; deleted?: boolean; deletedAt?: string;
}
interface LegacyAuditLog {
  id: string; groupCode: string; userId?: string; userName?: string; action: string;
  entityId?: string; details?: Record<string, unknown>; createdAt?: string;
}
export interface LegacyDb {
  groups: LegacyGroup[];
  users: LegacyUser[];
  customers: LegacyCustomer[];
  trips: LegacyTrip[];
  bills: LegacyBill[];
  auditLogs: LegacyAuditLog[];
  // Both added after this migration script was first written — optional so it can still run
  // against an older JSON snapshot taken before either feature existed.
  vehicles?: LegacyVehicle[];
  tripEditRequests?: LegacyTripEditRequest[];
}

// ── Migration plan (already Prisma-shaped, ready to insert in this exact order) ───────────────
export interface MigrationPlan {
  groups: { id: string; code: string; name: string; createdAt: Date; nextInvoiceNumber: number; branding: Record<string, unknown> | null; bankAccounts: Record<string, unknown>[] }[];
  users: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  advanceEntries: Record<string, unknown>[];
  trips: Record<string, unknown>[];
  bills: Record<string, unknown>[];
  billTripLines: { billId: string; tripId: string | null; date: Date | null; pickupLocation: string; dropLocation: string; amount: number; paidAmount: number }[];
  auditLogs: Record<string, unknown>[];
  vehicles: { id: string; groupId: string; vehicleNumber: string; createdAt: Date; updatedAt: Date; documents: Record<string, unknown>[] }[];
  tripEditRequests: Record<string, unknown>[];
  warnings: string[];
}

function toDate(value: string | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Pure — no I/O, no Prisma. Takes the parsed legacy JSON document and returns exactly what needs
// to be inserted, in FK-safe order, with every cross-reference already resolved or nulled out.
export function buildMigrationPlan(db: LegacyDb): MigrationPlan {
  const warnings: string[] = [];
  const groupIdByCode = new Map<string, string>();
  const customerIdSet = new Set<string>(); // legacy ids that will actually exist post-migration
  const tripIdSet = new Set<string>();
  const userIdSet = new Set<string>();

  const groups = db.groups.map((g) => {
    const newId = `group-${g.code}`; // deterministic, human-traceable, and re-runnable (idempotent id)
    groupIdByCode.set(g.code, newId);
    // `nextInvoiceNumber` lived inside the legacy branding blob; the Prisma schema moved it onto
    // Group itself (see groups.repository.ts) — the Branding model has no such column, so leaving
    // it in here would make Prisma reject the whole branding.create() as an unknown argument.
    const { bankAccounts, nextInvoiceNumber, ...branding } = g.branding || {};
    return {
      id: newId,
      code: g.code,
      name: g.name || 'Transport Manager',
      createdAt: toDate(g.createdAt),
      nextInvoiceNumber: Number.isFinite(Number(nextInvoiceNumber)) && Number(nextInvoiceNumber) > 0
        ? Number(nextInvoiceNumber) : 1,
      branding: Object.keys(branding).length ? branding : null,
      bankAccounts: Array.isArray(bankAccounts) ? bankAccounts : [],
    };
  });

  const users = db.users.map((u) => {
    userIdSet.add(u.id);
    const groupId = groupIdByCode.get(u.groupCode);
    if (!groupId) warnings.push(`User ${u.id}: unknown groupCode "${u.groupCode}" — skipped`);
    return groupId ? {
      id: u.id, groupId, role: u.role, name: u.name, phone: u.phone,
      userCode: u.userCode || null, email: u.email || '', passwordHash: u.passwordHash,
      active: u.active !== false,
      createdAt: toDate(u.createdAt), updatedAt: toDate(u.updatedAt, toDate(u.createdAt)),
    } : null;
  }).filter((u): u is NonNullable<typeof u> => u !== null);

  const customers = db.customers.map((c) => {
    const groupId = groupIdByCode.get(c.groupCode);
    if (!groupId) { warnings.push(`Customer ${c.id}: unknown groupCode "${c.groupCode}" — skipped`); return null; }
    customerIdSet.add(c.id);
    return {
      id: c.id, groupId, name: c.name || 'Unnamed Customer', phone: c.phone || '',
      address: c.address || '', email: c.email || '', gstNumber: c.gstNumber || '',
      advanceBalance: toNum(c.advanceBalance),
      createdAt: toDate(c.createdAt), updatedAt: toDate(c.updatedAt, toDate(c.createdAt)),
    };
  }).filter((c): c is NonNullable<typeof c> => c !== null);

  const advanceEntries = db.customers.flatMap((c) => {
    if (!customerIdSet.has(c.id) || !Array.isArray(c.advanceHistory)) return [];
    const groupId = groupIdByCode.get(c.groupCode)!;
    return c.advanceHistory.map((e) => ({
      id: e.id, customerId: c.id, groupId, amount: toNum(e.amount), note: e.note || '',
      date: toDate(e.date), createdAt: toDate(e.createdAt, toDate(e.date)),
      deleted: Boolean(e.deleted), deletedAt: e.deletedAt ? toDate(e.deletedAt) : null,
      usedInBillNo: e.usedInBillNo || null,
      // usedInBillId is deliberately left unset — the legacy data only ever recorded the bill's
      // human-facing billNo (a free-text field, not a stable id), so there's no reliable id to
      // resolve it to. usedInBillNo alone is what the UI has ever displayed.
    }));
  });

  const trips = db.trips.map((t) => {
    const groupId = groupIdByCode.get(t.groupCode);
    if (!groupId) { warnings.push(`Trip ${t.id}: unknown groupCode "${t.groupCode}" — skipped`); return null; }
    tripIdSet.add(t.id);
    const customerId = t.customerId && customerIdSet.has(t.customerId) ? t.customerId : null;
    if (t.customerId && !customerId) warnings.push(`Trip ${t.id}: customerId "${t.customerId}" not found — nulled out`);
    const driverId = t.driverId && userIdSet.has(t.driverId) ? t.driverId : null;
    const approvedById = t.approvedBy && userIdSet.has(t.approvedBy) ? t.approvedBy : null;
    return {
      id: t.id, groupId, customerId,
      customerName: t.customerName || '', customerPhone: t.customerPhone || '', customerAddress: t.customerAddress || '',
      driverId, driverName: t.driverName || '', driverCode: t.driverCode || '',
      date: toDate(t.date), pickupLocation: t.pickupLocation || '', dropLocation: t.dropLocation || '',
      amount: toNum(t.amount), advanceAmount: toNum(t.advanceAmount), isPaid: Boolean(t.isPaid),
      paidAmount: toNum(t.paidAmount), paymentMode: t.paymentMode || '', paymentNote: t.paymentNote || '',
      paidAt: t.paidAt ? toDate(t.paidAt) : null,
      vehicleType: t.vehicleType || '', vehicleNumber: t.vehicleNumber || '', materialType: t.materialType || '',
      status: (t.status as 'pending' | 'approved' | 'rejected') || 'approved',
      rejectionReason: t.rejectionReason || '',
      submittedAt: toDate(t.submittedAt), updatedAt: toDate(t.updatedAt, toDate(t.submittedAt)),
      approvedAt: t.approvedAt ? toDate(t.approvedAt) : null,
      approvedById,
      clientRequestId: null, // offline-idempotency is a new concept; nothing to backfill
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  const bills: MigrationPlan['bills'] = [];
  const billTripLines: MigrationPlan['billTripLines'] = [];
  for (const b of db.bills) {
    const groupId = groupIdByCode.get(b.groupCode);
    if (!groupId) { warnings.push(`Bill ${b.id}: unknown groupCode "${b.groupCode}" — skipped`); continue; }
    const customerId = b.customerId && customerIdSet.has(b.customerId) ? b.customerId : null;
    bills.push({
      id: b.id, groupId, customerId, customerName: b.customerName || '',
      billNo: b.billNo || '', billDate: toDate(b.billDate), isGstBill: Boolean(b.isGstBill),
      gstPercent: toNum(b.gstPercent), discount: toNum(b.discount), subTotal: toNum(b.subTotal),
      received: toNum(b.received), gstAmount: toNum(b.gstAmount), grandTotal: toNum(b.grandTotal),
      advanceApplied: toNum(b.advanceApplied), netPayable: toNum(b.netPayable),
      amountInWords: b.amountInWords || '', customerPhone: b.customerPhone || '',
      customerAddress: b.customerAddress || '', customerGst: b.customerGst || '',
      bankName: b.bankName || '', bankBranch: b.bankBranch || '', accountNumber: b.accountNumber || '',
      ifscCode: b.ifscCode || '', createdAt: toDate(b.createdAt), createdBy: b.createdBy || '',
      deleted: Boolean(b.deleted), deletedAt: b.deletedAt ? toDate(b.deletedAt) : null,
    });
    for (const line of b.trips || []) {
      billTripLines.push({
        billId: b.id,
        tripId: line.tripId && tripIdSet.has(line.tripId) ? line.tripId : null,
        date: line.date ? toDate(line.date) : null,
        pickupLocation: line.pickupLocation || '', dropLocation: line.dropLocation || '',
        amount: toNum(line.amount), paidAmount: toNum(line.paidAmount),
      });
    }
  }

  const auditLogs = db.auditLogs.map((a) => {
    const groupId = groupIdByCode.get(a.groupCode);
    if (!groupId) return null; // audit history for an unmigratable group isn't worth a warning
    return {
      id: a.id, groupId, userId: a.userId && userIdSet.has(a.userId) ? a.userId : null,
      userName: a.userName || '', action: a.action, entityId: a.entityId || '',
      details: a.details || {}, createdAt: toDate(a.createdAt),
    };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  const vehicles = (db.vehicles || []).map((v) => {
    const groupId = groupIdByCode.get(v.groupCode);
    if (!groupId) { warnings.push(`Vehicle ${v.id}: unknown groupCode "${v.groupCode}" — skipped`); return null; }
    return {
      id: v.id, groupId, vehicleNumber: v.vehicleNumber || '',
      createdAt: toDate(v.createdAt), updatedAt: toDate(v.updatedAt, toDate(v.createdAt)),
      documents: (v.documents || []).map((d) => ({
        id: d.id, label: d.label || '', expiryDate: toDate(d.expiryDate),
        reminderDaysBefore: Number.isFinite(d.reminderDaysBefore) ? Number(d.reminderDaysBefore) : 7,
        createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt, toDate(d.createdAt)),
      })),
    };
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  const tripEditRequests = (db.tripEditRequests || []).map((r) => {
    const groupId = groupIdByCode.get(r.groupCode);
    if (!groupId) { warnings.push(`Trip edit request ${r.id}: unknown groupCode "${r.groupCode}" — skipped`); return null; }
    if (!tripIdSet.has(r.tripId)) { warnings.push(`Trip edit request ${r.id}: tripId "${r.tripId}" not found — skipped`); return null; }
    if (!userIdSet.has(r.driverId)) { warnings.push(`Trip edit request ${r.id}: driverId "${r.driverId}" not found — skipped`); return null; }
    return {
      id: r.id, groupId, tripId: r.tripId, driverId: r.driverId, driverName: r.driverName || '',
      message: r.message || '', status: (r.status as 'pending' | 'resolved' | 'dismissed') || 'pending',
      createdAt: toDate(r.createdAt), resolvedAt: r.resolvedAt ? toDate(r.resolvedAt) : null,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    groups, users, customers, advanceEntries, trips, bills, billTripLines, auditLogs,
    vehicles, tripEditRequests, warnings,
  };
}

// Inserts a plan in strict FK order inside one transaction — either all of it lands or none of
// it does. Call with `prisma.$transaction((tx) => runMigration(plan, tx))`.
export async function runMigration(plan: MigrationPlan, tx: DbClient): Promise<void> {
  for (const g of plan.groups) {
    await tx.group.create({
      data: {
        id: g.id, code: g.code, name: g.name, createdAt: g.createdAt,
        nextInvoiceNumber: g.nextInvoiceNumber,
        branding: { create: (g.branding as Record<string, string>) || {} },
        bankAccounts: {
          create: g.bankAccounts.map((a, i) => ({
            label: String(a.label || ''), bankName: String(a.bankName || ''),
            bankBranch: String(a.bankBranch || ''), accountNumber: String(a.accountNumber || ''),
            ifscCode: String(a.ifscCode || ''), sortOrder: i,
          })),
        },
      },
    });
  }
  for (const u of plan.users) await tx.user.create({ data: u as Prisma_UserCreate });
  for (const c of plan.customers) await tx.customer.create({ data: c as Prisma_CustomerCreate });
  for (const e of plan.advanceEntries) await tx.advanceEntry.create({ data: e as Prisma_AdvanceEntryCreate });
  for (const t of plan.trips) await tx.trip.create({ data: t as Prisma_TripCreate });
  for (const b of plan.bills) await tx.bill.create({ data: b as Prisma_BillCreate });
  for (const l of plan.billTripLines) await tx.billTripLine.create({ data: l });
  for (const a of plan.auditLogs) await tx.auditLog.create({ data: a as Prisma_AuditLogCreate });
  for (const v of plan.vehicles) {
    await tx.vehicle.create({
      data: {
        id: v.id, groupId: v.groupId, vehicleNumber: v.vehicleNumber,
        createdAt: v.createdAt, updatedAt: v.updatedAt,
        documents: { create: v.documents as Prisma_VehicleDocumentCreate[] },
      },
    });
  }
  // Must run after trips + users are inserted above — every request references both.
  for (const r of plan.tripEditRequests) await tx.tripEditRequest.create({ data: r as Prisma_TripEditRequestCreate });
}

// Loose aliases — the plan's rows are already validated/shaped by buildMigrationPlan; re-deriving
// Prisma's exact input types here would just duplicate that work for no added safety.
type Prisma_UserCreate = Parameters<DbClient['user']['create']>[0]['data'];
type Prisma_CustomerCreate = Parameters<DbClient['customer']['create']>[0]['data'];
type Prisma_AdvanceEntryCreate = Parameters<DbClient['advanceEntry']['create']>[0]['data'];
type Prisma_TripCreate = Parameters<DbClient['trip']['create']>[0]['data'];
type Prisma_BillCreate = Parameters<DbClient['bill']['create']>[0]['data'];
type Prisma_AuditLogCreate = Parameters<DbClient['auditLog']['create']>[0]['data'];
type Prisma_VehicleDocumentCreate = Parameters<DbClient['vehicleDocument']['create']>[0]['data'];
type Prisma_TripEditRequestCreate = Parameters<DbClient['tripEditRequest']['create']>[0]['data'];

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error('Usage: npx tsx backend/src/scripts/migrateJsonToPostgres.ts <path-to-db.json>');
    process.exit(1);
  }
  const resolved = path.resolve(sourcePath);
  console.log(`Reading ${resolved}...`);
  const db = JSON.parse(fs.readFileSync(resolved, 'utf8')) as LegacyDb;

  // Belt-and-suspenders: a timestamped copy next to the source, independent of whatever backup
  // process may or may not already be running, taken BEFORE this script writes anything anywhere.
  const backupPath = `${resolved}.pre-migration-${Date.now()}.bak.json`;
  fs.copyFileSync(resolved, backupPath);
  console.log(`Backup written to ${backupPath}`);

  const plan = buildMigrationPlan(db);
  if (plan.warnings.length) {
    console.warn(`\n${plan.warnings.length} warning(s):`);
    for (const w of plan.warnings) console.warn(`  - ${w}`);
  }
  console.log(`\nPlan: ${plan.groups.length} groups, ${plan.users.length} users, ${plan.customers.length} customers, ` +
    `${plan.advanceEntries.length} advance entries, ${plan.trips.length} trips, ${plan.bills.length} bills, ` +
    `${plan.billTripLines.length} bill trip lines, ${plan.auditLogs.length} audit logs, ` +
    `${plan.vehicles.length} vehicles, ${plan.tripEditRequests.length} trip edit requests.`);

  const { prisma } = await import('../db/prisma.js');
  await prisma.$transaction((tx) => runMigration(plan, tx), { timeout: 5 * 60 * 1000 });

  const counts = await prisma.$transaction([
    prisma.group.count(), prisma.user.count(), prisma.customer.count(), prisma.advanceEntry.count(),
    prisma.trip.count(), prisma.bill.count(), prisma.billTripLine.count(), prisma.auditLog.count(),
    prisma.vehicle.count(), prisma.tripEditRequest.count(),
  ]);
  console.log('\nPost-migration row counts (Postgres):', {
    groups: counts[0], users: counts[1], customers: counts[2], advanceEntries: counts[3],
    trips: counts[4], bills: counts[5], billTripLines: counts[6], auditLogs: counts[7],
    vehicles: counts[8], tripEditRequests: counts[9],
  });
  console.log('\nDone.');
  await prisma.$disconnect();
}

// Only runs when invoked directly (`tsx migrateJsonToPostgres.ts ...`), not when imported by the
// test file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
