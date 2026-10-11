import type { DriverTransaction, DriverTransactionCategory } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

// Starter category list seeded once per group, the first time its driver-finance data is ever
// read — mirrors the reference payroll feature's seedDefaultCategories, just done lazily instead
// of at group-creation time so no backfill script is needed for groups that already existed.
export const DEFAULT_TRANSACTION_CATEGORIES = [
  'Salary Advance', 'Personal Advance', 'Food', 'Vegetables', 'Fuel',
  'Medical', 'Loan', 'Bonus', 'Incentive', 'Extra Work Payment', 'Other',
];

function findDriver(driverId: string, groupId: string, client: DbClient) {
  return client.user.findFirst({ where: { id: driverId, groupId, role: 'driver' } });
}

export async function listCategories(groupId: string, client: DbClient = prisma): Promise<DriverTransactionCategory[]> {
  const existing = await client.driverTransactionCategory.findMany({ where: { groupId }, orderBy: { name: 'asc' } });
  if (existing.length > 0) return existing;
  try {
    await client.driverTransactionCategory.createMany({
      data: DEFAULT_TRANSACTION_CATEGORIES.map((name) => ({ groupId, name, isDefault: true })),
    });
  } catch (err) {
    // Another concurrent request seeded it first — fine, just read what's there.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
  return client.driverTransactionCategory.findMany({ where: { groupId }, orderBy: { name: 'asc' } });
}

// A category typed via "+ Add Custom Category" is created once and reused on any later
// transaction (add or edit) that picks the same name.
async function resolveCategoryId(
  groupId: string,
  categoryId: string | undefined,
  newCategoryName: string | undefined,
  client: DbClient,
): Promise<string | null> {
  if (categoryId) return categoryId;
  const trimmed = newCategoryName?.trim();
  if (!trimmed) return null;

  const existing = await client.driverTransactionCategory.findFirst({ where: { groupId, name: trimmed } });
  if (existing) return existing.id;
  try {
    const created = await client.driverTransactionCategory.create({ data: { groupId, name: trimmed } });
    return created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const race = await client.driverTransactionCategory.findFirst({ where: { groupId, name: trimmed } });
      if (race) return race.id;
    }
    throw err;
  }
}

export function listTransactions(driverId: string, groupId: string, client: DbClient = prisma): Promise<(DriverTransaction & { category: { name: string } | null })[]> {
  return client.driverTransaction.findMany({
    where: { driverId, groupId },
    orderBy: { date: 'desc' },
    include: { category: { select: { name: true } } },
  });
}

export interface TransactionInput {
  categoryId?: string;
  newCategoryName?: string;
  amount: number;
  note: string;
  date: Date;
  deductFromSalary: boolean;
  businessEffect: string;
}

/** Every transaction *is* the business financial record — no separate expense row to keep in
 * sync (see the DriverTransaction schema comment). */
export async function createTransaction(
  driverId: string,
  groupId: string,
  input: TransactionInput,
  client: DbClient = prisma,
) {
  const driver = await findDriver(driverId, groupId, client);
  if (!driver) return null;
  const categoryId = await resolveCategoryId(groupId, input.categoryId, input.newCategoryName, client);
  await client.driverTransaction.create({
    data: {
      driverId, groupId, categoryId,
      amount: input.amount, note: input.note, date: input.date,
      deductFromSalary: input.deductFromSalary, businessEffect: input.businessEffect,
    },
  });
  return listTransactions(driverId, groupId, client);
}

export async function updateTransaction(
  driverId: string,
  groupId: string,
  transactionId: string,
  input: TransactionInput,
  client: DbClient = prisma,
) {
  const entry = await client.driverTransaction.findFirst({ where: { id: transactionId, driverId, groupId } });
  if (!entry) return 'not-found' as const;
  const categoryId = await resolveCategoryId(groupId, input.categoryId, input.newCategoryName, client);
  await client.driverTransaction.update({
    where: { id: transactionId },
    data: {
      categoryId,
      amount: input.amount, note: input.note, date: input.date,
      deductFromSalary: input.deductFromSalary, businessEffect: input.businessEffect,
    },
  });
  return listTransactions(driverId, groupId, client);
}

/** Hard delete — this feature has no soft-delete/undo, matching the reference payroll feature it
 * was ported from: deleting a transaction immediately changes the live salary calculation. */
export async function deleteTransaction(driverId: string, groupId: string, transactionId: string, client: DbClient = prisma) {
  const entry = await client.driverTransaction.findFirst({ where: { id: transactionId, driverId, groupId } });
  if (!entry) return 'not-found' as const;
  await client.driverTransaction.delete({ where: { id: transactionId } });
  return listTransactions(driverId, groupId, client);
}
