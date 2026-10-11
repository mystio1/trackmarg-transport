import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as brandingRepo from '../db/repositories/branding.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { isMailConfigured, sendMail } from '../services/mailer.js';
import { isValidEmail } from '../services/util.js';
import { requireRole } from '../middleware/auth.js';
import { emailLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../middleware/errorHandler.js';

export const notifyRouter = Router();

// Admin-only: this relays through the business's own configured sender, so an unrestricted
// endpoint would let any authenticated driver send arbitrary email as the company.
notifyRouter.post('/email', requireRole('admin'), emailLimiter, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim() || 'Transport Manager';
    const text = String(body.text || '');
    if (!isValidEmail(to)) throw new HttpError(400, 'A valid recipient email is required');
    if (!isMailConfigured()) {
      throw new HttpError(400, 'Email is not configured on this server. Set SENDGRID_API_KEY and SENDER_EMAIL in the .env file, then restart the server.');
    }
    try {
      const branding = await brandingRepo.get(req.auth!.groupId);
      await sendMail({ to, subject, text, fromName: branding.companyName || 'Transport Manager' });
      await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'email.sent', to, { subject });
      res.status(200).json({ ok: true });
    } catch (error) {
      throw new HttpError(502, `Could not send email: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  } catch (err) { next(err); }
});
