/**
 * @module services/contact
 *
 * @description
 * Contact-form submission handler for the Project Sites marketing
 * surface. Validates input with the shared `contactFormSchema`,
 * delivers a notification email to `BRAND.CONTACT_EMAIL`, and sends
 * a styled confirmation back to the submitter.
 *
 * ## Provider routing
 *
 * Email delivery uses a two-provider routing model. Resend is the
 * primary provider; SendGrid is the fallback. If `RESEND_API_KEY` is
 * present, Resend is tried first; on Resend failure (any non-2xx
 * response), the handler transparently falls back to SendGrid if
 * `SENDGRID_API_KEY` is configured. If neither is present, the
 * handler throws `badRequest('Email delivery is not configured.')`
 * which the error middleware surfaces as a 400 with a friendly
 * message — better than a generic 500.
 *
 * ## Side effects (per submission)
 *
 * - 1 Resend `POST /emails` (or SendGrid `POST /v3/mail/send`) to
 *   notify the team
 * - 1 same to confirm receipt to the user
 * - Worst case 4 outbound HTTPS calls when Resend fails both times
 *   and falls back to SendGrid for both messages — well within the
 *   Worker subrequest budget.
 *
 * ## Security
 *
 * All user-supplied strings are run through {@link escapeHtml} before
 * being embedded in the HTML email body. The `from:` address is fixed
 * (`noreply@megabyte.space`) so spoofing is impossible from the form.
 * `reply_to` is set to the submitter's email so replies route back to
 * them directly.
 *
 * @example
 * ```ts
 * await handleContactForm(c.env, await c.req.json());
 * return c.json({ ok: true });
 * ```
 *
 * @see {@link module:services/notifications}
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

/**
 * Send an email via Resend's `POST /emails` endpoint.
 *
 * @param apiKey - Resend API key (`re_*` format).
 * @param opts - Email envelope. `to` is a single recipient (Resend
 *   accepts arrays but this handler always sends to one address per
 *   call). `replyTo` is optional — omit for the user-confirmation
 *   email, set for the team-notification email so replies route to
 *   the submitter.
 *
 * @remarks
 * `from:` is fixed at `Project Sites <noreply@megabyte.space>` —
 * the megabyte.space domain MUST be verified in the Resend dashboard
 * or delivery fails with a 422.
 *
 * Failure path: any non-2xx response is logged with status + first
 * 500 chars of the response body (helps debug Resend's structured
 * errors) and re-thrown as `badRequest`. Caller in {@link sendEmail}
 * catches and tries SendGrid.
 *
 * @throws {AppError} `badRequest` on any non-2xx HTTP response.
 */
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

/**
 * Send an email via SendGrid's `POST /v3/mail/send` endpoint.
 *
 * @param apiKey - SendGrid API key (`SG.*` format).
 * @param opts - Email envelope; same shape as {@link sendViaResend}.
 *
 * @remarks
 * `tracking_settings` disables click/open/subscription tracking — we
 * deliver transactional confirmations, not marketing email, so
 * tracking would be inappropriate and would also mangle URLs in the
 * body. `from:` is fixed at `Project Sites <noreply@megabyte.space>`
 * (same as Resend) — must be a verified sender in the SendGrid
 * dashboard.
 *
 * Failure path: identical to Resend — log + throw `badRequest`. There
 * is no third fallback; if SendGrid also fails the handler propagates
 * the error up to the route layer.
 *
 * @throws {AppError} `badRequest` on any non-2xx HTTP response.
 */
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

/**
 * Provider-routing dispatcher. Selects Resend (primary) or SendGrid
 * (fallback) based on which API keys are configured in `env`.
 *
 * @param env - Worker bindings; checks `RESEND_API_KEY` and
 *   `SENDGRID_API_KEY` (both optional).
 * @param opts - Email envelope; passed verbatim to the chosen provider.
 *
 * @remarks
 * Routing matrix:
 * - Both keys present: Resend first, fall back to SendGrid on
 *   Resend failure
 * - Only Resend: Resend, no fallback (re-throws on failure)
 * - Only SendGrid: SendGrid only
 * - Neither: throws `badRequest('Email delivery is not configured')`
 *
 * Fallback is best-effort: the warn log captures Resend failure
 * details before SendGrid is tried, so post-incident analysis can
 * separate "Resend down" from "both providers down".
 *
 * @throws {AppError} `badRequest` if no provider is configured OR if
 *   the only configured provider returns a non-2xx response.
 */
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

/**
 * HTML-entity-escape a user-supplied string for safe embedding in an
 * email body.
 *
 * @param str - Untrusted string from the contact form (name, email,
 *   phone, message).
 * @returns Same string with `&`, `<`, `>`, `"` replaced by their
 *   named HTML entities.
 *
 * @remarks
 * Single quotes are not escaped because the email template never
 * embeds user input inside a single-quoted attribute. Double quotes
 * ARE escaped because `email` is embedded inside `href="..."` and a
 * single double-quote there would break the markup.
 *
 * Pure function — no I/O, no allocations beyond the returned string.
 *
 * @throws Never — string operations only.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the HTML body of the team-notification email.
 *
 * @param data - Validated contact-form payload (already passed through
 *   `contactFormSchema.parse`).
 * @returns Inline-styled HTML email body. All fields are
 *   {@link escapeHtml}-escaped. Includes a `mailto:` link on the
 *   submitter's email so the recipient can reply in one click.
 *
 * @remarks
 * Email styling uses inline `style="..."` attributes (no `<style>`
 * block) because most email clients strip or sandbox `<style>`.
 * Color palette matches the marketing-site dark theme (`#161635`
 * background, `#50a5db` accent) so inbound contact emails feel
 * branded. `phone` row is rendered only when present in the payload.
 *
 * @throws Never — pure string composition.
 */
function buildContactNotificationEmail(data: ContactForm): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:#e2e8f0;padding:8px 4px;">
  <div style="max-width:640px;margin:0 auto;background:#161635;border-radius:12px;padding:32px 28px;border:1px solid rgba(80,165,219,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://projectsites.dev/logo-header.png" alt="Project Sites" style="max-height:44px;max-width:260px;height:auto;" />
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

/**
 * Build the HTML body of the user-confirmation email (auto-reply).
 *
 * @param data - Validated contact-form payload.
 * @returns Inline-styled HTML email body addressed to `data.name`,
 *   echoing back `data.message` so the submitter has a record of
 *   what they sent.
 *
 * @remarks
 * Same styling system as {@link buildContactNotificationEmail}.
 * Signed off with "— The Project Sites Team". No CTAs, no marketing
 * — this is a transactional acknowledgement, full stop.
 *
 * @throws Never — pure string composition.
 */
function buildContactConfirmationEmail(data: ContactForm): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:#e2e8f0;padding:8px 4px;">
  <div style="max-width:640px;margin:0 auto;background:#161635;border-radius:12px;padding:32px 28px;border:1px solid rgba(80,165,219,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://projectsites.dev/logo-header.png" alt="Project Sites" style="max-height:44px;max-width:260px;height:auto;" />
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
 * Handle a contact form submission end-to-end: validate, notify the
 * team, confirm to the submitter.
 *
 * @param env - Worker bindings; at least one of `RESEND_API_KEY` or
 *   `SENDGRID_API_KEY` MUST be configured or this throws.
 * @param input - Raw JSON body from the request — typically
 *   `await c.req.json()`. Validated against `contactFormSchema`
 *   (name, email, optional phone, message).
 *
 * @remarks
 * Sequence of operations:
 *
 * 1. `contactFormSchema.parse(input)` — throws `ZodError` on invalid
 *    input; the global error middleware maps `ZodError` to a 400
 *    with human-readable field errors.
 * 2. Send notification email to `BRAND.CONTACT_EMAIL` (defined in
 *    `@project-sites/shared` constants) with `replyTo` set to the
 *    submitter's email so replies route back to them.
 * 3. Send confirmation email to the submitter; no `replyTo` because
 *    inbound replies to this auto-reply have nowhere useful to go.
 *
 * Both emails are sent sequentially (not in parallel) so a
 * notification failure prevents a confirmation from being sent — we
 * don't want to acknowledge receipt if the team won't actually get
 * the message. If notification succeeds but confirmation fails, the
 * caller still receives a 500 but the team has the inquiry, which is
 * the priority ordering.
 *
 * @throws {ZodError} On invalid input shape.
 * @throws {AppError} `badRequest('Email delivery is not configured.')`
 *   when neither provider key is set, OR provider HTTP error from
 *   {@link sendEmail}.
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
