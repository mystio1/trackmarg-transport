import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as groupsRepo from '../db/repositories/groups.repository.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as sessionsRepo from '../db/repositories/sessions.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { issueSession } from '../services/authSession.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { isMailConfigured, sendMail } from '../services/mailer.js';
import * as brandingRepo from '../db/repositories/branding.repository.js';
import { serializeUser, serializeGroup } from '../services/serializers.js';
import {
  isValidEmail, normalizeGroupCode, generateGroupCode, generateUserCode,
} from '../services/util.js';
import { signupLimiter, loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { Role, User, Group } from '@prisma/client';

export const authRouter = Router();

// ── SIGNUP (Admin creates/joins a group; Driver joins with an existing group code) ────────────
authRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const role: Role = body.role === 'admin' ? 'admin' : 'driver';
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim().toLowerCase();
    const requestedGroupCode = normalizeGroupCode(body.groupCode);
    const groupName = String(body.groupName || '').trim();

    if (!name || !phone) throw new HttpError(400, 'Name and phone are required');
    if (!password || password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    if (email && !isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address');

    const result = await prisma.$transaction(async (tx) => {
      let group = requestedGroupCode ? await groupsRepo.findByCode(requestedGroupCode, tx) : null;

      if (role === 'driver' && !group) {
        throw new HttpError(400, 'A valid group code from your admin is required to register as a driver');
      }

      if (role === 'admin' && !group) {
        if (!groupName) throw new HttpError(400, 'A business name is required');
        let groupCode = requestedGroupCode || generateGroupCode();
        while (await groupsRepo.existsByCode(groupCode, tx)) groupCode = generateGroupCode();
        group = await groupsRepo.create({ code: groupCode, name: groupName }, tx);
      }
      // `group` is guaranteed non-null past this point: driver requires an existing group
      // (checked above) and admin either found one or just created one.
      const resolvedGroup = group!;

      // Support-console-managed seat caps — only meaningful for someone JOINING an existing
      // group (a brand-new group's first admin can't be capped by a limit set on a group that
      // didn't exist yet). `null` means unlimited, the default until support sets one.
      if (role === 'driver' && resolvedGroup.maxDrivers != null) {
        const count = await usersRepo.countActiveByGroupAndRole(resolvedGroup.id, 'driver', tx);
        if (count >= resolvedGroup.maxDrivers) {
          throw new HttpError(403, `This group has reached its limit of ${resolvedGroup.maxDrivers} driver${resolvedGroup.maxDrivers === 1 ? '' : 's'}. Contact your admin or support.`, 'DRIVER_LIMIT_REACHED');
        }
      }
      if (role === 'admin' && requestedGroupCode && resolvedGroup.maxAdmins != null) {
        const count = await usersRepo.countActiveByGroupAndRole(resolvedGroup.id, 'admin', tx);
        if (count >= resolvedGroup.maxAdmins) {
          throw new HttpError(403, `This group has reached its limit of ${resolvedGroup.maxAdmins} admin${resolvedGroup.maxAdmins === 1 ? '' : 's'}. Contact support to increase it.`, 'ADMIN_LIMIT_REACHED');
        }
      }

      const duplicate = await usersRepo.findByGroupAndPhone(resolvedGroup.id, phone, tx);
      if (duplicate) throw new HttpError(409, 'A user with this phone already exists in this group');

      let userCode = generateUserCode(role);
      while (await usersRepo.existsByUserCode(userCode, tx)) userCode = generateUserCode(role);

      const user = await usersRepo.create(
        { groupId: resolvedGroup.id, role, name, phone, userCode, email, passwordHash: hashPassword(password) },
        tx,
      );
      await auditLogsRepo.create(tx, user, resolvedGroup.id, 'user.signup', user.id, { role: user.role });

      const token = await issueSession({ id: user.id, groupId: user.groupId, role: user.role }, tx, {
        userAgent: req.headers['user-agent'], ip: req.ip,
      });

      return { token, user, group: resolvedGroup };
    });

    res.status(201).json({
      token: result.token,
      user: serializeUser(result.user, result.group.code),
      group: serializeGroup(result.group),
    });
  } catch (err) { next(err); }
});

// ── LOGIN ────────────────────────────────────────────────────────────────
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    // Optional now — a phone number is only unique WITHIN a group (schema's
    // @@unique([groupId, phone])), so login resolves the account by phone + password alone,
    // across every group that phone appears in. `groupCode` is still accepted so the picker
    // below can complete a login it already narrowed down to one specific account.
    const groupCode = normalizeGroupCode(body.groupCode);

    if (!phone || !password) throw new HttpError(400, 'Phone and password are required');

    // Deliberately the SAME generic message in every "no match" case below — a differentiated
    // message let an attacker enumerate valid phone numbers or group codes (fixed as part of
    // this rebuild).
    const invalidCredentials = () => new HttpError(401, 'Invalid phone number or password');

    const candidates: (User & { group: Group })[] = groupCode
      ? await (async () => {
          const group = await groupsRepo.findByCode(groupCode);
          if (!group) return [];
          const user = await usersRepo.findActiveByGroupAndPhone(group.id, phone);
          return user ? [{ ...user, group }] : [];
        })()
      : await usersRepo.findAllActiveByPhone(phone);

    const matches = candidates.filter((u) => verifyPassword(password, u.passwordHash));
    if (matches.length === 0) throw invalidCredentials();

    if (matches.length > 1) {
      // Same phone AND the same password happen to be valid for more than one business — rare
      // (needs a reused test number plus a reused password), but real: this has already been
      // seen in production data. Guessing which business the user meant would be a real surprise
      // (wrong bills, wrong customers on screen), so hand back the short list instead and let the
      // client show a one-tap picker; its follow-up call includes groupCode, which takes the
      // single-match branch below. No token is issued yet.
      res.status(200).json({
        requiresGroupSelection: true,
        accounts: matches.map((u) => ({ groupCode: u.group.code, groupName: u.group.name })),
      });
      return;
    }

    const user = matches[0];
    const group = user.group;
    if (group.frozen) {
      throw new HttpError(423, 'This account has been frozen by our support console. Your data is safe — contact support for recovery.', 'ACCOUNT_FROZEN');
    }

    const token = await issueSession({ id: user.id, groupId: user.groupId, role: user.role }, prisma, {
      userAgent: req.headers['user-agent'], ip: req.ip,
    });
    res.status(200).json({ token, user: serializeUser(user, group.code), group: serializeGroup(group) });
  } catch (err) { next(err); }
});

// ── FORGOT PASSWORD (admin only) ────────────────────────────────────────
// Always responds with the same generic message regardless of whether the account/email
// actually matched, so this can't be used to probe which phone numbers have accounts.
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const genericResponse = { message: 'If that account has a recovery email on file, a reset code has been sent to it.' };
    if (!phone || !groupCode) throw new HttpError(400, 'Phone and group code are required');

    const group = await groupsRepo.findByCode(groupCode);
    const user = group ? await usersRepo.findActiveAdminByGroupAndPhone(group.id, phone) : null;
    if (group && user && user.email && isMailConfigured()) {
      const otp = String(crypto.randomInt(100000, 1000000));
      await usersRepo.setResetOtp(user.id, {
        resetOtpHash: hashPassword(otp),
        resetOtpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        resetOtpAttempts: 0,
      });
      try {
        const branding = await brandingRepo.get(group.id);
        await sendMail({
          to: user.email,
          subject: 'Your password reset code',
          text: `Your password reset code is ${otp}. It expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
          fromName: branding.companyName || 'Transport Manager',
        });
      } catch (error) {
        const { logger } = await import('../services/logger.js');
        logger.error({ err: error }, 'failed to send password reset email');
      }
    }
    res.status(200).json(genericResponse);
  } catch (err) { next(err); }
});

// Shared by /verify-reset-otp and /reset-password so a wrong guess in either place counts the
// same way against the 5-attempt cap.
function checkResetOtp(user: User | null, otp: string): 'ok' | 'expired' | 'too-many' | 'wrong' {
  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt || user.resetOtpExpiresAt.getTime() < Date.now()) {
    return 'expired';
  }
  if ((user.resetOtpAttempts || 0) >= 5) return 'too-many';
  if (!verifyPassword(otp, user.resetOtpHash)) return 'wrong';
  return 'ok';
}

authRouter.post('/verify-reset-otp', resetPasswordLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const otp = String(body.otp || '').trim();
    const invalidOrExpired = 'That code is invalid or has expired. Request a new one.';
    if (!phone || !groupCode || !otp) throw new HttpError(400, 'Phone, group code and reset code are required');

    const group = await groupsRepo.findByCode(groupCode);
    const user = group ? await usersRepo.findActiveAdminByGroupAndPhone(group.id, phone) : null;
    const result = checkResetOtp(user, otp);
    if (result === 'too-many') {
      await usersRepo.clearResetOtp(user!.id);
      throw new HttpError(400, 'Too many incorrect attempts. Please request a new code.');
    }
    if (result === 'wrong') {
      await usersRepo.incrementResetOtpAttempts(user!.id, user!.resetOtpAttempts || 0);
      throw new HttpError(400, invalidOrExpired);
    }
    if (result === 'expired') throw new HttpError(400, invalidOrExpired);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

authRouter.post('/reset-password', resetPasswordLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const otp = String(body.otp || '').trim();
    const newPassword = String(body.newPassword || '');
    const invalidOrExpired = 'That code is invalid or has expired. Request a new one.';

    if (!phone || !groupCode || !otp) throw new HttpError(400, 'Phone, group code and reset code are required');
    if (newPassword.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

    const group = await groupsRepo.findByCode(groupCode);
    const user = group ? await usersRepo.findActiveAdminByGroupAndPhone(group.id, phone) : null;
    const result = checkResetOtp(user, otp);
    if (result === 'too-many') {
      await usersRepo.clearResetOtp(user!.id);
      throw new HttpError(400, 'Too many incorrect attempts. Please request a new code.');
    }
    if (result === 'wrong') {
      await usersRepo.incrementResetOtpAttempts(user!.id, user!.resetOtpAttempts || 0);
      throw new HttpError(400, invalidOrExpired);
    }
    if (result === 'expired') throw new HttpError(400, invalidOrExpired);

    // Revoking every existing session as part of the same transaction as the password change
    // closes the gap the original app had: previously there was no way to invalidate a stolen
    // token short of restarting the server (which invalidated EVERY session, for everyone).
    await prisma.$transaction(async (tx) => {
      await usersRepo.updatePasswordHash(user!.id, hashPassword(newPassword), tx);
      await usersRepo.clearResetOtp(user!.id, tx);
      await auditLogsRepo.create(tx, user!, user!.groupId, 'user.password.reset', user!.id);
      await sessionsRepo.revokeAllForUser(user!.id, tx);
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
