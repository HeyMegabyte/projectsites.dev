/**
 * @module services/newsletter_dispatch
 *
 * @description
 * Standardized newsletter dispatch fan-out for projectsites.dev forms.
 * Given a form submission and the active newsletter integrations on a
 * site, this module fans the subscriber record out to every connected
 * provider in parallel using `Promise.all`. The dispatcher is the
 * single transport layer behind `POST /api/contact-form/:slug` and the
 * direct newsletter signup forms.
 *
 * ## Supported providers
 * | Provider   | API surface                                                    | Auth shape           |
 * | ---------- | -------------------------------------------------------------- | -------------------- |
 * | mailchimp  | POST /3.0/lists/{list_id}/members                              | Basic (anystr:key)   |
 * | sendgrid   | PUT /v3/marketing/contacts (list_ids[])                        | Bearer               |
 * | convertkit | POST /v3/forms/{form_id}/subscribe                             | api_key in body      |
 * | klaviyo    | POST /api/profile-subscription-bulk-create-jobs                | Klaviyo-API-Key      |
 * | resend     | POST /audiences/{audience_id}/contacts                         | Bearer               |
 * | webhook    | POST {webhook_url} with the full envelope                      | (caller-defined)     |
 *
 * ## Failure model (CRITICAL — design intent)
 * Per-integration errors are **always captured per-result and never
 * thrown**. The `DispatchResult[]` returned by `dispatchToIntegrations`
 * has one entry per input row, each annotated with `ok` + `error`.
 * This is deliberate: a Mailchimp outage MUST NOT block the SendGrid
 * fan-out, and a bad webhook URL on one integration MUST NOT cause
 * the user-facing form submit to fail. Callers (route handlers)
 * SHOULD log the failure results to `audit_logs` for downstream
 * reconciliation, then ack 200 to the browser regardless.
 *
 * ## Timeouts
 * Every upstream HTTP call is wrapped in `fetchWithTimeout(8s)` via
 * `AbortController`. The 8-second cap matches the Worker invocation
 * budget remaining after auth + DB I/O (~50s on paid plan, 30s
 * unstuck slack).
 *
 * ## Tagging
 * Every provider receives synthetic tags (`projectsites:{slug}` +
 * `form:{form_name}`) so subscribers can be cleanly segmented per-site
 * and per-form in the provider UI — useful when a single org runs
 * multiple sites on shared Mailchimp/SendGrid accounts.
 *
 * @example
 * ```ts
 * const integrations = await dbQuery<IntegrationRow>(
 *   db,
 *   'SELECT * FROM newsletter_integrations WHERE site_id = ? AND deleted_at IS NULL',
 *   [siteId],
 * );
 * const results = await dispatchToIntegrations({
 *   site_id: siteId,
 *   site_slug: 'vitos-mens-salon',
 *   form_name: 'newsletter',
 *   email: 'subscriber@example.com',
 *   fields: { first_name: 'Alex' },
 *   origin_url: 'https://vitos.projectsites.dev/contact',
 *   ip_address: c.req.header('cf-connecting-ip'),
 *   user_agent: c.req.header('user-agent'),
 *   submitted_at: new Date().toISOString(),
 * }, integrations.data);
 * for (const r of results.filter(r => !r.ok)) audit(c, 'newsletter.dispatch_failed', r);
 * ```
 *
 * @see {@link module:routes/api} for the `/api/contact-form/:slug` handler
 */

import type { NewsletterProvider } from '@project-sites/shared';

/** Stored integration row shape (same columns as `newsletter_integrations`). */
export interface IntegrationRow {
  id: string;
  site_id: string;
  provider: NewsletterProvider;
  api_key_encrypted: string | null;
  list_id: string | null;
  webhook_url: string | null;
  config: string | null;
}

/** Submission envelope passed to dispatch + sent to webhook providers verbatim. */
export interface DispatchSubmission {
  site_id: string;
  site_slug: string;
  form_name: string;
  email: string | undefined;
  fields: Record<string, unknown>;
  origin_url: string | undefined;
  ip_address: string | undefined;
  user_agent: string | undefined;
  submitted_at: string;
}

/** Result of dispatching to one integration. */
export interface DispatchResult {
  integration_id: string;
  provider: NewsletterProvider;
  ok: boolean;
  error: string | null;
}

const TIMEOUT_MS = 8000;

/**
 * Fan out a single submission to every active integration in parallel.
 *
 * @param submission - The submission envelope. `email` is required for
 *   all providers EXCEPT `webhook` (which receives the raw envelope
 *   regardless of email presence). Other fields populate provider-
 *   specific metadata (first/last name, source tags, IP, UA).
 * @param integrations - The full set of active integrations for this
 *   site, typically loaded via
 *   `SELECT * FROM newsletter_integrations WHERE site_id = ? AND deleted_at IS NULL`.
 *   Pass `[]` to short-circuit; this function returns `[]` without
 *   making any HTTP calls.
 * @returns One `DispatchResult` per input row, in input order, each
 *   with `ok: boolean` and `error: string | null`. The array is
 *   never partial.
 *
 * @remarks
 * - Concurrency: every integration is invoked via `Promise.all`. There
 *   is no upper-bound on parallelism — a site with 10 integrations
 *   fires 10 concurrent HTTP requests. This is fine in practice
 *   because sites rarely have more than 2–3 connected providers.
 * - Order preservation: results match input order — callers can
 *   correlate by index without inspecting `integration_id`.
 * - Never throws — every per-provider error is caught and surfaced
 *   in the `error` field. The only way this function can reject is
 *   if `Promise.all` itself can't be constructed (impossible in
 *   normal operation).
 *
 * @throws Never — failures are encoded in the result array.
 */
export async function dispatchToIntegrations(
  submission: DispatchSubmission,
  integrations: IntegrationRow[],
): Promise<DispatchResult[]> {
  if (integrations.length === 0) return [];
  return Promise.all(integrations.map((row) => dispatchOne(submission, row)));
}

async function dispatchOne(submission: DispatchSubmission, row: IntegrationRow): Promise<DispatchResult> {
  const base: Pick<DispatchResult, 'integration_id' | 'provider'> = {
    integration_id: row.id,
    provider: row.provider,
  };
  try {
    switch (row.provider) {
      case 'mailchimp':
        await dispatchMailchimp(submission, row);
        break;
      case 'sendgrid':
        await dispatchSendgrid(submission, row);
        break;
      case 'convertkit':
        await dispatchConvertkit(submission, row);
        break;
      case 'klaviyo':
        await dispatchKlaviyo(submission, row);
        break;
      case 'resend':
        await dispatchResend(submission, row);
        break;
      case 'webhook':
        await dispatchWebhook(submission, row);
        break;
    }
    return { ...base, ok: true, error: null };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function requireEmail(s: DispatchSubmission): string {
  if (!s.email) throw new Error('Provider requires an email field on the submission');
  return s.email;
}

function requireApiKey(row: IntegrationRow): string {
  if (!row.api_key_encrypted) throw new Error('Integration is missing api_key');
  return row.api_key_encrypted;
}

function requireList(row: IntegrationRow): string {
  if (!row.list_id) throw new Error('Integration is missing list_id');
  return row.list_id;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Upstream ${res.status}: ${body.slice(0, 240)}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ── Mailchimp ────────────────────────────────────────────────
// API key format: <hex>-<dc>, e.g. abc123-us21. Datacenter goes in the host.
async function dispatchMailchimp(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  const apiKey = requireApiKey(row);
  const list = requireList(row);
  const email = requireEmail(s);
  const dc = apiKey.split('-')[1];
  if (!dc) throw new Error('Mailchimp API key missing datacenter suffix (expected key-us21)');
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${list}/members`;
  await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: email,
      status: 'subscribed',
      merge_fields: collectMergeFields(s.fields),
      tags: [`projectsites:${s.site_slug}`, `form:${s.form_name}`],
    }),
  });
}

// ── SendGrid Marketing Contacts ──────────────────────────────
async function dispatchSendgrid(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  const apiKey = requireApiKey(row);
  const email = requireEmail(s);
  const lists = row.list_id ? [row.list_id] : [];
  await fetchWithTimeout('https://api.sendgrid.com/v3/marketing/contacts', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      list_ids: lists,
      contacts: [
        {
          email,
          first_name: pickName(s.fields, 'first'),
          last_name: pickName(s.fields, 'last'),
        },
      ],
    }),
  });
}

// ── ConvertKit ───────────────────────────────────────────────
async function dispatchConvertkit(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  const apiKey = requireApiKey(row);
  const email = requireEmail(s);
  const cfg = parseConfig(row.config);
  const formId = String(cfg['form_id'] ?? row.list_id ?? '');
  if (!formId) throw new Error('ConvertKit requires config.form_id (or list_id) to be set');
  await fetchWithTimeout(`https://api.convertkit.com/v3/forms/${formId}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      email,
      first_name: pickName(s.fields, 'first'),
      fields: { source: `projectsites:${s.site_slug}:${s.form_name}` },
    }),
  });
}

// ── Klaviyo ──────────────────────────────────────────────────
async function dispatchKlaviyo(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  const apiKey = requireApiKey(row);
  const list = requireList(row);
  const email = requireEmail(s);
  await fetchWithTimeout('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      'Content-Type': 'application/json',
      revision: '2024-10-15',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: `projectsites:${s.site_slug}:${s.form_name}`,
          profiles: {
            data: [
              {
                type: 'profile',
                attributes: {
                  email,
                  subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
                },
              },
            ],
          },
        },
        relationships: { list: { data: { type: 'list', id: list } } },
      },
    }),
  });
}

// ── Resend Audiences ─────────────────────────────────────────
async function dispatchResend(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  const apiKey = requireApiKey(row);
  const audience = requireList(row);
  const email = requireEmail(s);
  await fetchWithTimeout(`https://api.resend.com/audiences/${audience}/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: pickName(s.fields, 'first'),
      last_name: pickName(s.fields, 'last'),
      unsubscribed: false,
    }),
  });
}

// ── Generic Webhook ──────────────────────────────────────────
async function dispatchWebhook(s: DispatchSubmission, row: IntegrationRow): Promise<void> {
  if (!row.webhook_url) throw new Error('Webhook integration missing webhook_url');
  await fetchWithTimeout(row.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'projectsites.dev/forms',
      'X-Projectsites-Event': 'form.submission',
    },
    body: JSON.stringify({
      event: 'form.submission',
      site_id: s.site_id,
      site_slug: s.site_slug,
      form_name: s.form_name,
      email: s.email,
      fields: s.fields,
      origin_url: s.origin_url,
      submitted_at: s.submitted_at,
    }),
  });
}

// ── helpers ──────────────────────────────────────────────────

function collectMergeFields(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const first = pickName(fields, 'first');
  const last = pickName(fields, 'last');
  if (first) out['FNAME'] = first;
  if (last) out['LNAME'] = last;
  return out;
}

function pickName(fields: Record<string, unknown>, kind: 'first' | 'last'): string | undefined {
  const candidates = kind === 'first'
    ? ['first_name', 'firstName', 'firstname', 'fname', 'first']
    : ['last_name', 'lastName', 'lastname', 'lname', 'last'];
  for (const k of candidates) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // try splitting a combined "name" field
  const name = fields['name'];
  if (typeof name === 'string' && name.includes(' ')) {
    const parts = name.trim().split(/\s+/);
    return kind === 'first' ? parts[0] : parts.slice(1).join(' ');
  }
  return undefined;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
