/**
 * @module services/contact
 * @description Contact form handler that validates input and sends emails
 * via Resend (primary) or SendGrid (fallback).
 *
 * Sends two emails per submission:
 * 1. Main email to the brand contact address with all form fields.
 * 2. Confirmation email to the user acknowledging receipt.
 */

import { BRAND, contactFormSchema, badRequest } from '@project-sites/shared';
import type { ContactForm } from '@project-sites/shared';
import type { Env } from '../types/env.js';

/* ------------------------------------------------------------------ */
/*  Email Sending (Resend primary, SendGrid fallback)                 */
/* ------------------------------------------------------------------ */

interface EmailOpts {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

async function sendViaResend(apiKey: string, opts: EmailOpts): Promise<void> {
  const body: Record<string, unknown> = {
    from: 'Project Sites <noreply@megabyte.space>',
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'contact',
        message: 'Resend API error',
        status: res.status,
        body: text.slice(0, 500),
        to: opts.to,
      }),
    );
    throw badRequest(`Failed to send email (status ${res.status}).`);
  }
}

async function sendViaSendGrid(apiKey: string, opts: EmailOpts): Promise<void> {
  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from: { email: 'noreply@megabyte.space', name: 'Project Sites' },
    subject: opts.subject,
    content: [{ type: 'text/html', value: opts.html }],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
    },
  };
  if (opts.replyTo) body.reply_to = { email: opts.replyTo };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'contact',
        message: 'SendGrid API error',
        status: res.status,
        body: text.slice(0, 500),
        to: opts.to,
      }),
    );
    throw badRequest(`Failed to send email (status ${res.status}).`);
  }
}

async function sendEmail(env: Env, opts: EmailOpts): Promise<void> {
  if (env.RESEND_API_KEY) {
    try {
      return await sendViaResend(env.RESEND_API_KEY, opts);
    } catch (err) {
      if (env.SENDGRID_API_KEY) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'contact',
            message: 'Resend failed, falling back to SendGrid',
            error: err instanceof Error ? err.message : String(err),
            to: opts.to,
          }),
        );
        return sendViaSendGrid(env.SENDGRID_API_KEY, opts);
      }
      throw err;
    }
  }

  if (env.SENDGRID_API_KEY) {
    return sendViaSendGrid(env.SENDGRID_API_KEY, opts);
  }

  throw badRequest('Email delivery is not configured. Please contact support.');
}

/* ------------------------------------------------------------------ */
/*  HTML helpers                                                       */
/* ------------------------------------------------------------------ */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildContactNotificationEmail(data: ContactForm): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:#e2e8f0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#161635;border-radius:12px;padding:40px;border:1px solid rgba(80,165,219,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://sites.megabyte.space/logo-header.png" alt="Project Sites" style="max-height:44px;max-width:260px;height:auto;" />
    </div>
    <h1 style="color:#50a5db;font-size:24px;margin:0 0 20px;">New Contact Form Submission</h1>
    <table style="width:100%;color:#94a3b8;font-size:14px;line-height:1.8;border-collapse:collapse;">
      <tr><td style="font-weight:700;color:#e2e8f0;padding:6px 16px 6px 0;vertical-align:top;">Name:</td><td style="padding:6px 0;">${escapeHtml(data.name)}</td></tr>
      <tr><td style="font-weight:700;color:#e2e8f0;padding:6px 16px 6px 0;vertical-align:top;">Email:</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(data.email)}" style="color:#50a5db;text-decoration:none;">${escapeHtml(data.email)}</a></td></tr>
      ${data.phone ? `<tr><td style="font-weight:700;color:#e2e8f0;padding:6px 16px 6px 0;vertical-align:top;">Phone:</td><td style="padding:6px 0;">${escapeHtml(data.phone)}</td></tr>` : ''}
    </table>
    <hr style="border:none;border-top:1px solid rgba(80,165,219,0.1);margin:20px 0;">
    <p style="font-weight:700;color:#e2e8f0;font-size:14px;margin:0 0 8px;">Message:</p>
    <p style="color:#94a3b8;line-height:1.7;white-space:pre-wrap;margin:0;">${escapeHtml(data.message)}</p>
  </div>
</body>
</html>`.trim();
}

function buildContactConfirmationEmail(data: ContactForm): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:#e2e8f0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#161635;border-radius:12px;padding:40px;border:1px solid rgba(80,165,219,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://sites.megabyte.space/logo-header.png" alt="Project Sites" style="max-height:44px;max-width:260px;height:auto;" />
    </div>
    <h1 style="color:#50a5db;font-size:24px;margin:0 0 16px;">Thanks for reaching out!</h1>
    <p style="color:#94a3b8;line-height:1.6;margin:0 0 12px;">Hi ${escapeHtml(data.name)},</p>
    <p style="color:#94a3b8;line-height:1.6;margin:0 0 24px;">We've received your message and will get back to you shortly. Here's a copy of what you sent:</p>
    <div style="background:rgba(80,165,219,0.05);border-radius:8px;padding:16px;border:1px solid rgba(80,165,219,0.08);">
      <p style="color:#94a3b8;line-height:1.6;white-space:pre-wrap;margin:0;font-size:13px;">${escapeHtml(data.message)}</p>
    </div>
    <p style="color:#64748b;font-size:13px;margin:24px 0 0;">&mdash; The Project Sites Team</p>
  </div>
</body>
</html>`.trim();
}

/* ------------------------------------------------------------------ */
/*  Public handler                                                     */
/* ------------------------------------------------------------------ */

/**
 * Handle a contact form submission.
 *
 * 1. Validates the input against `contactFormSchema`.
 * 2. Sends a notification email to `BRAND.CONTACT_EMAIL`.
 * 3. Sends a confirmation email to the user.
 */
export async function handleContactForm(env: Env, input: unknown): Promise<void> {
  const validated = contactFormSchema.parse(input);

  // Email 1: Notification to the team
  await sendEmail(env, {
    to: BRAND.CONTACT_EMAIL,
    subject: `Contact Form: ${validated.name}`,
    html: buildContactNotificationEmail(validated),
    replyTo: validated.email,
  });

  // Email 2: Confirmation to the user
  await sendEmail(env, {
    to: validated.email,
    subject: 'We received your message — Project Sites',
    html: buildContactConfirmationEmail(validated),
  });
}
