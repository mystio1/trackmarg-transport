import type { User, Group, Role } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export function findByGroupAndPhone(
  groupId: string,
  phone: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findUnique({ where: { groupId_phone: { groupId, phone } } });
}

export function findActiveByGroupAndPhone(
  groupId: string,
  phone: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findFirst({ where: { groupId, phone, active: true } });
}

// Login no longer takes a group code, but phone is only unique WITHIN a group
// (@@unique([groupId, phone]) in schema.prisma) — the same number can legitimately belong to
// different accounts in different businesses. This is how the login route finds every candidate
// account for a phone so it can check the submitted password against each of them.
export function findAllActiveByPhone(
  phone: string,
  client: DbClient = prisma,
): Promise<(User & { group: Group })[]> {
  return client.user.findMany({ where: { phone, active: true }, include: { group: true } });
}

export function findActiveAdminByGroupAndPhone(
  groupId: string,
  phone: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findFirst({ where: { groupId, phone, role: 'admin', active: true } });
}

// Used by the /support console's impersonate step — picks whichever active admin account exists
// for the business, since support isn't targeting one specific admin, just "get into this
// business as its admin".
export function findFirstActiveAdminByGroup(groupId: string, client: DbClient = prisma): Promise<User | null> {
  return client.user.findFirst({ where: { groupId, role: 'admin', active: true }, orderBy: { createdAt: 'asc' } });
}

export function findById(id: string, client: DbClient = prisma): Promise<User | null> {
  return client.user.findUnique({ where: { id } });
}

export function findActiveById(id: string, client: DbClient = prisma): Promise<User | null> {
  return client.user.findFirst({ where: { id, active: true } });
}

// Used by requireAuth — bundles the group's `code` alongside the user in one query so route
// handlers can stamp the legacy-shaped `groupCode` field onto their JSON responses without a
// second lookup. Scoped to `groupId` (not just `id`) as defense-in-depth: a token's claimed
// groupId is re-checked against the row actually found, matching the original server.mjs's
// `u.id === payload.userId && u.groupCode === payload.groupCode` double-check.
export function findActiveByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<(User & { group: { code: string; frozen: boolean } }) | null> {
  return client.user.findFirst({
    where: { id, groupId, active: true },
    include: { group: { select: { code: true, frozen: true } } },
  });
}

export function existsByUserCode(userCode: string, client: DbClient = prisma): Promise<boolean> {
  return client.user.count({ where: { userCode } }).then((count) => count > 0);
}

// Active-only — a deactivated account no longer occupies a seat against the group's cap, so
// re-adding a replacement driver/admin after removing one doesn't get incorrectly blocked.
export function countActiveByGroupAndRole(groupId: string, role: Role, client: DbClient = prisma): Promise<number> {
  return client.user.count({ where: { groupId, role, active: true } });
}

export function listDriversByGroup(groupId: string, client: DbClient = prisma): Promise<User[]> {
  return client.user.findMany({
    where: { groupId, role: 'driver' },
    orderBy: { name: 'asc' },
  });
}

export function findActiveDriverByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<User | null> {
  return client.user.findFirst({ where: { id, groupId, role: 'driver' } });
}

export function create(
  data: {
    groupId: string; role: Role; name: string; phone: string; userCode: string;
    email: string; passwordHash: string;
  },
  client: DbClient = prisma,
): Promise<User> {
  return client.user.create({ data });
}

export function updateEmail(id: string, email: string, client: DbClient = prisma): Promise<User> {
  return client.user.update({ where: { id }, data: { email } });
}

export function updateSalarySettings(
  id: string,
  data: { baseSalary: number; joiningDate: Date | null },
  client: DbClient = prisma,
): Promise<User> {
  return client.user.update({ where: { id }, data });
}

export function updatePasswordHash(id: string, passwordHash: string, client: DbClient = prisma): Promise<User> {
  return client.user.update({ where: { id }, data: { passwordHash } });
}

export function setResetOtp(
  id: string,
  data: { resetOtpHash: string; resetOtpExpiresAt: Date; resetOtpAttempts: number },
  client: DbClient = prisma,
): Promise<User> {
  return client.user.update({ where: { id }, data });
}

export function clearResetOtp(id: string, client: DbClient = prisma): Promise<User> {
  return client.user.update({
    where: { id },
    data: { resetOtpHash: null, resetOtpExpiresAt: null, resetOtpAttempts: 0 },
  });
}

export function incrementResetOtpAttempts(id: string, current: number, client: DbClient = prisma): Promise<User> {
  return client.user.update({ where: { id }, data: { resetOtpAttempts: current + 1 } });
}
