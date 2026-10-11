import { Router } from 'express';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import * as driverTransactionsRepo from '../db/repositories/driverTransactions.repository.js';
import { computeSalaryForMonth, getLifetimeSalarySummary } from '../services/salary.js';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../services/passwords.js';
import { serializeUser, serializeDriverTransaction, serializeDriverTransactionCategory } from '../services/serializers.js';
import { toNumber, now } from '../services/util.js';
import { broadcast } from '../services/sse.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';

export const driversRouter = Router();

// Matches the reference payroll feature's businessEffect enum exactly — SALARY_PAYMENT and
// BONUS_INCENTIVE are load-bearing for the salary calculation (see services/salary.ts), the
// rest are classification only.
const BUSINESS_EFFECTS = ['ADVANCE_RECOVERABLE', 'BUSINESS_EXPENSE', 'SALARY_PAYMENT', 'BONUS_INCENTIVE', 'OTHER'] as const;

driversRouter.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const drivers = await usersRepo.listDriversByGroup(req.auth!.groupId);
    res.status(200).json({ drivers: drivers.map((d) => serializeUser(d, req.auth!.groupCode)) });
  } catch (err) { next(err); }
});

// Drivers have no recovery email on file, so if one forgets their password the admin sets a new
// one directly here and passes it along to them (call/WhatsApp) — no email/SMS needed.
driversRouter.post('/:id/reset-password', requireRole('admin'), async (req, res, next) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    const driver = await usersRepo.findActiveDriverByIdAndGroup(String(req.params.id), req.auth!.groupId);
    if (!driver) throw new HttpError(404, 'Driver not found');

    // Same reasoning as the self-service reset-password route: revoking every session this
    // driver currently holds keeps an already-logged-in device from staying signed in under a
    // password the admin just changed out from under them.
    await prisma.$transaction(async (tx) => {
      await usersRepo.updatePasswordHash(driver.id, hashPassword(newPassword), tx);
      await auditLogsRepo.create(tx, req.auth!.user, req.auth!.groupId, 'driver.password.reset', driver.id);
      await sessionsRepo.revokeAllForUser(driver.id, tx);
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// Set a driver's fixed base salary and joining date (when salary starts accruing from) —
// shown on the Driver Details > Overview/Salary tabs.
driversRouter.patch('/:id/salary', requireRole('admin'), async (req, res, next) => {
  try {
    const baseSalary = toNumber(req.body?.baseSalary);
    if (baseSalary < 0) throw new HttpError(400, 'Base salary cannot be negative');
    const joiningDateRaw = req.body?.joiningDate;
    const joiningDate = joiningDateRaw ? new Date(String(joiningDateRaw)) : null;
    if (joiningDate && Number.isNaN(joiningDate.getTime())) throw new HttpError(400, 'Invalid joining date');

    const driver = await usersRepo.findActiveDriverByIdAndGroup(String(req.params.id), req.auth!.groupId);
    if (!driver) throw new HttpError(404, 'Driver not found');

    const updated = await usersRepo.updateSalarySettings(driver.id, { baseSalary, joiningDate });
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'driver.salary.update', driver.id, { baseSalary, joiningDate });
    const serialized = serializeUser(updated, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'driver.edit', driver: serialized });
    res.status(200).json({ driver: serialized });
  } catch (err) { next(err); }
});

// Everything the Driver Details page's Overview/Money/Salary tabs need in one call: this
// driver's full transaction history, the business's category catalog, the requested month's
// carry-forward salary breakdown, and the lifetime (since-joining) accrual summary.
driversRouter.get('/:id/finance', requireRole('admin'), async (req, res, next) => {
  try {
    const driver = await usersRepo.findActiveDriverByIdAndGroup(String(req.params.id), req.auth!.groupId);
    if (!driver) throw new HttpError(404, 'Driver not found');

    const today = new Date();
    const monthParam = String(req.query.month || '');
    const [monthYear, monthIndex] = monthParam ? monthParam.split('-').map(Number) : [today.getFullYear(), today.getMonth() + 1];
    const salaryYear = monthYear ?? today.getFullYear();
    const salaryMonth = (monthIndex ?? today.getMonth() + 1) - 1;

    const [transactions, categories, salary, lifetimeSalary] = await Promise.all([
      driverTransactionsRepo.listTransactions(driver.id, req.auth!.groupId),
      driverTransactionsRepo.listCategories(req.auth!.groupId),
      computeSalaryForMonth(req.auth!.groupId, driver.id, salaryYear, salaryMonth),
      getLifetimeSalarySummary(req.auth!.groupId, driver.id),
    ]);

    res.status(200).json({
      transactions: transactions.map(serializeDriverTransaction),
      categories: categories.map(serializeDriverTransactionCategory),
      salary,
      lifetimeSalary,
    });
  } catch (err) { next(err); }
});

function parseTransactionBody(body: Record<string, unknown>) {
  const categoryId = body.categoryId ? String(body.categoryId) : undefined;
  const newCategoryName = body.newCategoryName ? String(body.newCategoryName) : undefined;
  if (!categoryId && !newCategoryName) throw new HttpError(400, 'Category is required');

  const amount = toNumber(body.amount);
  if (amount <= 0) throw new HttpError(400, 'Amount must be greater than zero');

  const dateRaw = String(body.date || '').trim();
  const date = new Date(dateRaw || now());
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid date');

  const businessEffect = String(body.businessEffect || 'ADVANCE_RECOVERABLE');
  if (!BUSINESS_EFFECTS.includes(businessEffect as (typeof BUSINESS_EFFECTS)[number])) {
    throw new HttpError(400, 'Invalid business effect');
  }

  return {
    categoryId, newCategoryName,
    amount, date,
    note: String(body.note || '').trim(),
    deductFromSalary: body.deductFromSalary !== false,
    businessEffect,
  };
}

// Record a money transaction against a driver — a fine, deduction, advance, bonus, salary
// payment, or any admin-defined category.
driversRouter.post('/:id/transactions', requireRole('admin'), async (req, res, next) => {
  try {
    const input = parseTransactionBody(req.body ?? {});
    const list = await driverTransactionsRepo.createTransaction(String(req.params.id), req.auth!.groupId, input);
    if (!list) throw new HttpError(404, 'Driver not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'driver.transaction.add', String(req.params.id), {
      amount: input.amount, note: input.note, date: input.date, businessEffect: input.businessEffect,
    });
    const transactions = list.map(serializeDriverTransaction);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'driver.transaction.add', driverId: String(req.params.id) });
    res.status(200).json({ transactions });
  } catch (err) { next(err); }
});

driversRouter.patch('/:id/transactions/:transactionId', requireRole('admin'), async (req, res, next) => {
  try {
    const input = parseTransactionBody(req.body ?? {});
    const result = await driverTransactionsRepo.updateTransaction(String(req.params.id), req.auth!.groupId, String(req.params.transactionId), input);
    if (result === 'not-found') throw new HttpError(404, 'Transaction not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'driver.transaction.edit', String(req.params.id), {
      transactionId: req.params.transactionId, amount: input.amount, businessEffect: input.businessEffect,
    });
    const transactions = result.map(serializeDriverTransaction);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'driver.transaction.edit', driverId: String(req.params.id) });
    res.status(200).json({ transactions });
  } catch (err) { next(err); }
});

// Hard delete — no undo. Deleting a transaction immediately changes the live salary
// calculation, matching the reference payroll feature this was ported from.
driversRouter.delete('/:id/transactions/:transactionId', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await driverTransactionsRepo.deleteTransaction(String(req.params.id), req.auth!.groupId, String(req.params.transactionId));
    if (result === 'not-found') throw new HttpError(404, 'Transaction not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'driver.transaction.delete', String(req.params.id), { transactionId: req.params.transactionId });
    const transactions = result.map(serializeDriverTransaction);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'driver.transaction.delete', driverId: String(req.params.id) });
    res.status(200).json({ transactions });
  } catch (err) { next(err); }
});
