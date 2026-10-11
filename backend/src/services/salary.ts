// Month-by-month carry-forward salary math, ported from a reference fleet-management app's
// operator payroll feature (same algorithm, adapted to this project's Prisma models — User
// plays the role of "Operator", DriverTransaction plays "OperatorTransaction"). Salary is never
// stored or hand-calculated: it's computed live from the driver's baseSalary plus every
// DriverTransaction dated within the relevant range, so it can never drift out of sync with the
// transactions themselves.
import { prisma, type DbClient } from '../db/prisma.js';
import { toNumber } from './util.js';

type MonthTotals = { bonus: number; deductions: number; paid: number };

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function applyTransaction(entry: MonthTotals, tx: { businessEffect: string; deductFromSalary: boolean; amount: number }): void {
  if (tx.businessEffect === 'SALARY_PAYMENT') entry.paid += tx.amount;
  else if (tx.businessEffect === 'BONUS_INCENTIVE') entry.bonus += tx.amount;
  else if (tx.deductFromSalary) entry.deductions += tx.amount;
}

/**
 * The running balance a driver carries INTO `monthStart` — every prior calendar month (since
 * `salaryStartsFrom`) contributes baseSalary + bonus - deductions - paid, positive or negative,
 * and it all accumulates. A month with zero transactions still contributes the full baseSalary
 * as owed (nothing was paid that month) — this is what makes an unpaid month keep showing up in
 * every later month's total until it's actually settled with a SALARY_PAYMENT transaction.
 */
function carriedForwardBalance(
  baseSalary: number,
  salaryStartsFrom: Date,
  monthStart: Date,
  byMonth: Map<string, MonthTotals>,
): number {
  let cursor = new Date(salaryStartsFrom.getFullYear(), salaryStartsFrom.getMonth(), 1);
  let balance = 0;
  while (cursor < monthStart) {
    const entry = byMonth.get(monthKey(cursor)) ?? { bonus: 0, deductions: 0, paid: 0 };
    balance += baseSalary + entry.bonus - entry.deductions - entry.paid;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return balance;
}

export interface MonthSalary {
  baseSalary: number;
  bonus: number;
  deductions: number;
  alreadyPaid: number;
  carriedForward: number;
  payable: number;
}

/**
 * Final Salary Payable = Base Salary + Bonuses/Incentives - Deductible Transactions
 *                         - Salary Already Paid + whatever was left over (unpaid or overpaid)
 *                           from every earlier month.
 *
 * Nothing here is summed twice: a transaction contributes to exactly one of bonus/deduction/paid
 * based on its own businessEffect/deductFromSalary fields. The carry-forward balance is always
 * recomputed from the driver's full transaction history, never persisted, so it can never drift
 * out of sync with the transactions themselves.
 */
export async function computeSalaryForMonth(
  groupId: string,
  driverId: string,
  year: number,
  month: number,
  client: DbClient = prisma,
): Promise<MonthSalary> {
  const driver = await client.user.findFirstOrThrow({ where: { id: driverId, groupId } });

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const salaryStartsFrom = driver.joiningDate ?? driver.createdAt;
  const rangeStart = new Date(
    Math.min(new Date(salaryStartsFrom.getFullYear(), salaryStartsFrom.getMonth(), 1).getTime(), start.getTime()),
  );

  const allTransactions = await client.driverTransaction.findMany({
    where: { driverId, groupId, date: { gte: rangeStart, lt: end } },
    orderBy: { date: 'asc' },
  });

  const byMonth = new Map<string, MonthTotals>();
  for (const tx of allTransactions) {
    const key = monthKey(tx.date);
    const entry = byMonth.get(key) ?? { bonus: 0, deductions: 0, paid: 0 };
    applyTransaction(entry, { businessEffect: tx.businessEffect, deductFromSalary: tx.deductFromSalary, amount: toNumber(tx.amount) });
    byMonth.set(key, entry);
  }

  const baseSalary = toNumber(driver.baseSalary);
  const carriedForward = carriedForwardBalance(baseSalary, salaryStartsFrom, start, byMonth);
  const thisMonth = byMonth.get(monthKey(start)) ?? { bonus: 0, deductions: 0, paid: 0 };
  const payable = Math.round((baseSalary + thisMonth.bonus - thisMonth.deductions - thisMonth.paid + carriedForward) * 100) / 100;

  return {
    baseSalary,
    bonus: Math.round(thisMonth.bonus * 100) / 100,
    deductions: Math.round(thisMonth.deductions * 100) / 100,
    alreadyPaid: Math.round(thisMonth.paid * 100) / 100,
    carriedForward: Math.round(carriedForward * 100) / 100,
    payable,
  };
}

/** Same date, `n` months later — clamped to the last day of the target month when the start day
 * doesn't exist there (joined the 31st -> lands on Feb 28/29, not March 3). Calendar-day
 * arithmetic only, no time-of-day. */
function addMonthsClamped(date: Date, n: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), daysInTargetMonth));
  return target;
}

export interface AccrualBreakdown {
  fullCycles: number;
  fullCyclesAmount: number;
  cycleStart: string;
  cycleEnd: string;
  cycleDays: number;
  elapsedDays: number;
  dailyRate: number;
  partialAmount: number;
  total: number;
}

/**
 * Base salary earned from `joinDate` through `asOf`, accrued day by day instead of by whole
 * calendar months: each complete join-date anniversary cycle (e.g. 7 Jun -> 7 Jul) counts as one
 * full baseSalary; a cycle that hasn't finished yet is prorated by the days elapsed into it over
 * that specific cycle's own length (28-31 days, whichever months it spans), not a flat 30. Every
 * intermediate figure is returned, not just the total, so the Overview tab's "How This Was
 * Calculated" dialog can show exactly how the number was reached instead of restating the total.
 */
function accrueBaseSalary(joinDate: Date, asOf: Date, baseSalary: number): AccrualBreakdown {
  const join = new Date(joinDate.getFullYear(), joinDate.getMonth(), joinDate.getDate());
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (today <= join) {
    return {
      fullCycles: 0, fullCyclesAmount: 0, cycleStart: join.toISOString(), cycleEnd: join.toISOString(),
      cycleDays: 0, elapsedDays: 0, dailyRate: 0, partialAmount: 0, total: 0,
    };
  }

  let fullCycles = 0;
  let cycleStart = join;
  let cycleEnd = addMonthsClamped(join, 1);
  while (cycleEnd <= today) {
    fullCycles++;
    cycleStart = cycleEnd;
    cycleEnd = addMonthsClamped(join, fullCycles + 1);
  }

  const cycleDays = Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000);
  const elapsedDays = Math.round((today.getTime() - cycleStart.getTime()) / 86_400_000);
  const dailyRate = cycleDays > 0 ? baseSalary / cycleDays : 0;
  const fullCyclesAmount = fullCycles * baseSalary;
  const partialAmount = dailyRate * elapsedDays;

  return {
    fullCycles, fullCyclesAmount, cycleStart: cycleStart.toISOString(), cycleEnd: cycleEnd.toISOString(),
    cycleDays, elapsedDays, dailyRate, partialAmount, total: fullCyclesAmount + partialAmount,
  };
}

export interface LifetimeSalary {
  joiningDate: string;
  asOf: string;
  baseSalary: number;
  accrual: AccrualBreakdown;
  bonus: number;
  deductions: number;
  totalPayable: number;
  totalPaid: number;
  remaining: number;
}

/**
 * Lifetime totals from the driver's joining date through today — what the Overview tab shows:
 * Total Payable (base salary accrued day-by-day, plus every bonus, minus every deduction), Given
 * (every SALARY_PAYMENT ever recorded), and Remaining (positive still owed, negative overpaid).
 */
export async function getLifetimeSalarySummary(groupId: string, driverId: string, client: DbClient = prisma): Promise<LifetimeSalary> {
  const driver = await client.user.findFirstOrThrow({ where: { id: driverId, groupId } });

  const now = new Date();
  const salaryStartsFrom = driver.joiningDate ?? driver.createdAt;
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const transactions = await client.driverTransaction.findMany({
    where: { driverId, groupId, date: { gte: salaryStartsFrom, lt: rangeEnd } },
  });

  const totals: MonthTotals = { bonus: 0, deductions: 0, paid: 0 };
  for (const tx of transactions) {
    applyTransaction(totals, { businessEffect: tx.businessEffect, deductFromSalary: tx.deductFromSalary, amount: toNumber(tx.amount) });
  }

  const baseSalary = toNumber(driver.baseSalary);
  const accrual = accrueBaseSalary(salaryStartsFrom, now, baseSalary);
  const totalPayable = accrual.total + totals.bonus - totals.deductions;

  return {
    joiningDate: salaryStartsFrom.toISOString(),
    asOf: now.toISOString(),
    baseSalary,
    accrual,
    bonus: Math.round(totals.bonus * 100) / 100,
    deductions: Math.round(totals.deductions * 100) / 100,
    totalPayable: Math.round(totalPayable * 100) / 100,
    totalPaid: Math.round(totals.paid * 100) / 100,
    remaining: Math.round((totalPayable - totals.paid) * 100) / 100,
  };
}
