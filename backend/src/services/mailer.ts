import { config } from '../env.js';

interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
}

// True once the credentials needed to actually send mail are configured — callers must handle
// `false` (email features degrade gracefully rather than crashing when unset).
export function isMailConfigured(): boolean {
  return Boolean(config.sendgridApiKey && config.senderEmail);
}

// Sends over SendGrid's HTTPS API rather than raw SMTP — Render's free tier blocks outbound SMTP
// (ports 465/587) entirely, so nodemailer/Gmail SMTP hung indefinitely there. HTTPS (443) isn't
// blocked on any Render tier. `senderEmail` must be verified as a Single Sender in SendGrid (or
// belong to a domain verified there), or SendGrid rejects the send.
export async function sendMail({ to, subject, text, fromName }: SendMailInput): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error('Email is not configured on this server. Set SENDGRID_API_KEY and SENDER_EMAIL, then restart the server.');
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.sendgridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.senderEmail, name: fromName || 'Transport Manager' },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid rejected the email (${response.status}): ${body.slice(0, 300)}`);
  }
}
