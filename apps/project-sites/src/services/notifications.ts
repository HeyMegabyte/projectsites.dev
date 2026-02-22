/**
 * @module services/notifications
 * @description Transactional email notifications for domain verification and site builds.
 *
 * Uses Resend (primary) or SendGrid (fallback) to deliver notifications.
 */

import type { Env } from '../types/env.js';

interface EmailOpts {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via configured provider (Resend → SendGrid fallback).
 */
async function sendEmail(env: Env, opts: EmailOpts): Promise<void> {
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Project Sites <noreply@megabyte.space>',
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend error ${res.status}: ${text}`);
    }
    return;
  }

  if (env.SENDGRID_API_KEY) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: { email: 'noreply@megabyte.space', name: 'Project Sites' },
        subject: opts.subject,
        content: [{ type: 'text/html', value: opts.html }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SendGrid error ${res.status}: ${text}`);
    }
    return;
  }

  console.warn(JSON.stringify({ level: 'warn', service: 'notifications', message: 'No email provider configured' }));
}

/**
 * Email wrapper for HTML template.
 */
function emailWrap(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a1a;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:rgba(15,15,42,0.95);border:1px solid rgba(100,255,218,0.08);border-radius:16px;max-width:520px;width:100%;">
<tr><td style="padding:32px 28px;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:24px;font-weight:800;color:#50a5db;letter-spacing:-0.5px;">Project Sites</span>
</div>
${content}
<div style="margin-top:28px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
<span style="font-size:12px;color:rgba(148,163,184,0.5);">Powered by Megabyte Labs &middot; sites.megabyte.space</span>
</div>
</td></tr></table>
</td></tr></table></body></html>`;
}

/**
 * Send domain verification success notification.
 */
export async function notifyDomainVerified(
  env: Env,
  opts: {
    email: string;
    hostname: string;
    primaryDomain: string | null;
    defaultDomain: string;
    siteName: string;
  },
): Promise<void> {
  const html = emailWrap(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;width:48px;height:48px;background:#22c55e;border-radius:50%;line-height:48px;text-align:center;">
        <span style="font-size:22px;color:#fff;">&#10003;</span>
      </span>
    </div>
    <h2 style="color:#e2e8f0;font-size:20px;font-weight:700;text-align:center;margin:0 0 8px;">Domain Connected!</h2>
    <p style="color:#94a3b8;font-size:14px;text-align:center;line-height:1.6;margin:0 0 20px;">
      Congratulations! Your domain <strong style="color:#22c55e;">${opts.hostname}</strong> is now connected to
      <strong style="color:#e2e8f0;">${opts.siteName}</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.2);border-radius:10px;margin-bottom:16px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Your Domains</div>
        <div style="margin-bottom:6px;font-size:13px;">
          <span style="color:#22c55e;">&#9679;</span>
          <span style="color:#e2e8f0;font-weight:600;"> ${opts.primaryDomain || opts.hostname}</span>
          <span style="color:#50a5db;font-size:11px;margin-left:4px;">PRIMARY</span>
        </div>
        <div style="font-size:13px;">
          <span style="color:#94a3b8;">&#9679;</span>
          <span style="color:#94a3b8;"> ${opts.defaultDomain}</span>
          <span style="color:#64748b;font-size:11px;margin-left:4px;">DEFAULT</span>
        </div>
      </td></tr>
    </table>
    <p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">
      <strong style="color:#94a3b8;">How it works:</strong> Your <strong>Primary</strong> domain is the main URL visitors see.
      All other domains (including your free default subdomain) redirect to it. You can manage which domain is primary from your dashboard.
    </p>
  `);

  await sendEmail(env, {
    to: opts.email,
    subject: `Domain connected: ${opts.hostname}`,
    html,
  }).catch((err) => {
    console.warn(JSON.stringify({ level: 'warn', service: 'notifications', message: 'Failed to send domain verified email', error: String(err) }));
  });
}

/**
 * Send site build completion notification.
 */
export async function notifySiteBuilt(
  env: Env,
  opts: {
    email: string;
    siteName: string;
    slug: string;
    siteUrl: string;
    version: string;
    pagesGenerated?: number;
  },
): Promise<void> {
  const html = emailWrap(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#50a5db,#7c3aed);border-radius:50%;line-height:48px;text-align:center;">
        <span style="font-size:22px;color:#fff;">&#9889;</span>
      </span>
    </div>
    <h2 style="color:#e2e8f0;font-size:20px;font-weight:700;text-align:center;margin:0 0 8px;">Your Site Is Live!</h2>
    <p style="color:#94a3b8;font-size:14px;text-align:center;line-height:1.6;margin:0 0 20px;">
      <strong style="color:#e2e8f0;">${opts.siteName}</strong> has been built and published successfully.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr><td style="padding:14px 16px;background:rgba(0,0,0,0.2);border-radius:10px;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Build Details</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:4px;">URL: <a href="${opts.siteUrl}" style="color:#50a5db;text-decoration:none;font-weight:600;">${opts.siteUrl}</a></div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:4px;">Version: <span style="color:#e2e8f0;font-family:monospace;">${opts.version}</span></div>
        ${opts.pagesGenerated ? `<div style="font-size:13px;color:#94a3b8;">Pages: <span style="color:#e2e8f0;">${opts.pagesGenerated} generated</span></div>` : ''}
      </td></tr>
    </table>
    <div style="text-align:center;">
      <a href="${opts.siteUrl}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#50a5db,#7c3aed);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">Visit Your Site</a>
    </div>
  `);

  await sendEmail(env, {
    to: opts.email,
    subject: `Site published: ${opts.siteName}`,
    html,
  }).catch((err) => {
    console.warn(JSON.stringify({ level: 'warn', service: 'notifications', message: 'Failed to send site built email', error: String(err) }));
  });
}
