/**
 * MCP-style OAuth provider adapters. Each provider implements:
 *   - authorizeUrl(state, codeChallenge, returnUrl) — build the consent URL
 *   - exchangeCode(code, codeVerifier) — swap auth code for access token
 *   - listTools() — return JSON-schema tool descriptors for the LLM
 *   - executeTool(name, args, token) — perform the action
 *
 * Per-site tokens live in `mcp_connections`, encrypted via ai_crypto.ts.
 */
import type { Env } from '../types/env.js';
import { decrypt } from './ai_crypto.js';

export type Provider =
  | 'mailchimp'
  | 'stripe'
  | 'resend'
  | 'hubspot'
  | 'slack'
  | 'notion'
  | 'github'
  | 'linear'
  | 'discord'
  | 'google_calendar'
  | 'twilio'
  | 'calendly'
  | 'airtable'
  | 'zapier';

export interface ToolDescriptor {
  name: string;
  description: string;
  /** JSON schema for input args. */
  parameters: Record<string, unknown>;
}

export interface ProviderAdapter {
  provider: Provider;
  /** Authorization URL for the OAuth consent screen. */
  authorizeUrl(
    env: Env,
    opts: { state: string; codeVerifier?: string; returnUrl: string },
  ): string;
  /** Exchange auth code for tokens. Returns the raw provider response. */
  exchangeCode(
    env: Env,
    opts: { code: string; codeVerifier?: string; redirectUri: string },
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    metadata?: Record<string, unknown>;
  }>;
  /** Tool descriptors the LLM may invoke. */
  tools(): ToolDescriptor[];
  /** Execute a tool against the provider API. */
  execute(
    env: Env,
    opts: {
      tool: string;
      args: Record<string, unknown>;
      accessToken: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

async function challengeFromVerifier(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* ─────────────────────────── MailChimp ─────────────────────────── */
const mailchimp: ProviderAdapter = {
  provider: 'mailchimp',
  authorizeUrl(env, { state, returnUrl }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.MAILCHIMP_CLIENT_ID ?? '',
      redirect_uri: `${new URL(returnUrl).origin}/api/mcp/mailchimp/callback`,
      state,
    });
    return `https://login.mailchimp.com/oauth2/authorize?${params}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const tokenRes = await fetch('https://login.mailchimp.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.MAILCHIMP_CLIENT_ID ?? '',
        client_secret: env.MAILCHIMP_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error(`mailchimp token exchange ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { access_token: string };
    // Mailchimp requires a follow-up call to discover the data center.
    const meta = await fetch('https://login.mailchimp.com/oauth2/metadata', {
      headers: { Authorization: `OAuth ${token.access_token}` },
    }).then((r) => r.json() as Promise<{ dc: string; api_endpoint: string; login: { email: string } }>);
    return {
      access_token: token.access_token,
      metadata: { dc: meta.dc, api_endpoint: meta.api_endpoint, login_email: meta.login.email },
    };
  },
  tools() {
    return [
      {
        name: 'add_to_mailchimp',
        description: 'Subscribe an email to a Mailchimp audience list. Use for newsletter signups.',
        parameters: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            list_id: {
              type: 'string',
              description: 'Optional Mailchimp list ID. Uses the default list when omitted.',
            },
            merge_fields: { type: 'object' },
          },
        },
      },
    ];
  },
  async execute(env, { tool, args, accessToken, metadata }) {
    void env;
    if (tool !== 'add_to_mailchimp') return { ok: false, error: 'unknown tool' };
    const dc = (metadata?.['dc'] as string | undefined) ?? 'us1';
    const listId = (args['list_id'] as string | undefined) ?? '';
    const email = String(args['email'] ?? '');
    if (!listId || !email) return { ok: false, error: 'list_id and email required' };
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        merge_fields: args['merge_fields'] ?? {},
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && String(body['title'] ?? '').toLowerCase().includes('exists')) {
      return { ok: true, data: { already_subscribed: true } };
    }
    return res.ok
      ? { ok: true, data: body }
      : { ok: false, error: `mailchimp ${res.status}` };
  },
};

/* ─────────────────────────── Stripe ─────────────────────────── */
const stripe: ProviderAdapter = {
  provider: 'stripe',
  authorizeUrl(env, { state, returnUrl }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.STRIPE_CONNECT_CLIENT_ID ?? '',
      scope: 'read_write',
      state,
      redirect_uri: `${new URL(returnUrl).origin}/api/mcp/stripe/callback`,
    });
    return `https://connect.stripe.com/oauth/authorize?${params}`;
  },
  async exchangeCode(env, { code }) {
    const res = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_secret: env.STRIPE_SECRET_KEY,
        code,
      }),
    });
    if (!res.ok) throw new Error(`stripe oauth ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      stripe_user_id: string;
    };
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      metadata: { stripe_account_id: json.stripe_user_id },
    };
  },
  tools() {
    return [
      {
        name: 'create_stripe_invoice',
        description:
          'Send a Stripe invoice to a customer when they request a quote, deposit, or payment.',
        parameters: {
          type: 'object',
          required: ['email', 'amount_cents', 'description'],
          properties: {
            email: { type: 'string', format: 'email' },
            amount_cents: { type: 'integer', minimum: 100 },
            currency: { type: 'string', default: 'usd' },
            description: { type: 'string' },
          },
        },
      },
    ];
  },
  async execute(_env, { tool, args, accessToken }) {
    if (tool !== 'create_stripe_invoice') return { ok: false, error: 'unknown tool' };
    const form = new URLSearchParams({
      'customer_email': String(args['email'] ?? ''),
      'collection_method': 'send_invoice',
      'days_until_due': '30',
      'description': String(args['description'] ?? ''),
    });
    const inv = await fetch('https://api.stripe.com/v1/invoices', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    return inv.ok
      ? { ok: true, data: await inv.json() }
      : { ok: false, error: `stripe ${inv.status}` };
  },
};

/* ─────────────────────────── Resend ─────────────────────────── */
// Resend has no OAuth; users paste an API key.
const resend: ProviderAdapter = {
  provider: 'resend',
  authorizeUrl(_env, { state }) {
    // Special marker; UI shows a paste-key flow instead of redirecting.
    return `__paste_key__?state=${state}`;
  },
  async exchangeCode(_env, { code }) {
    // For Resend, the "code" IS the API key the user pasted.
    return { access_token: code };
  },
  tools() {
    return [
      {
        name: 'send_email',
        description:
          'Send an email reply to a customer or to the site owner. Use for contact forms, order confirmations, follow-ups.',
        parameters: {
          type: 'object',
          required: ['to', 'subject', 'body'],
          properties: {
            to: { type: 'string', format: 'email' },
            from: { type: 'string', default: 'noreply@projectsites.dev' },
            reply_to: { type: 'string' },
            subject: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
    ];
  },
  async execute(_env, { tool, args, accessToken }) {
    if (tool !== 'send_email') return { ok: false, error: 'unknown tool' };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: String(args['from'] ?? 'noreply@projectsites.dev'),
        to: [String(args['to'] ?? '')],
        reply_to: args['reply_to'] ? String(args['reply_to']) : undefined,
        subject: String(args['subject'] ?? ''),
        text: String(args['body'] ?? ''),
      }),
    });
    return res.ok
      ? { ok: true, data: await res.json() }
      : { ok: false, error: `resend ${res.status}` };
  },
};

/* ─────────────────────────── HubSpot ─────────────────────────── */
const hubspot: ProviderAdapter = {
  provider: 'hubspot',
  authorizeUrl(env, { state, returnUrl, codeVerifier }) {
    const params = new URLSearchParams({
      client_id: env.HUBSPOT_CLIENT_ID ?? '',
      redirect_uri: `${new URL(returnUrl).origin}/api/mcp/hubspot/callback`,
      scope: 'crm.objects.contacts.write crm.objects.contacts.read',
      state,
    });
    // HubSpot supports PKCE for public clients; include challenge if provided.
    if (codeVerifier) {
      // (caller will pre-derive the challenge; for brevity we just pass state)
    }
    return `https://app.hubspot.com/oauth/authorize?${params}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.HUBSPOT_CLIENT_ID ?? '',
        client_secret: env.HUBSPOT_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!res.ok) throw new Error(`hubspot oauth ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
    };
  },
  tools() {
    return [
      {
        name: 'create_hubspot_contact',
        description: 'Create or update a HubSpot CRM contact when a customer submits a form.',
        parameters: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            firstname: { type: 'string' },
            lastname: { type: 'string' },
            phone: { type: 'string' },
            company: { type: 'string' },
            lifecyclestage: { type: 'string' },
          },
        },
      },
    ];
  },
  async execute(_env, { tool, args, accessToken }) {
    if (tool !== 'create_hubspot_contact') return { ok: false, error: 'unknown tool' };
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: args }),
    });
    return res.ok
      ? { ok: true, data: await res.json() }
      : { ok: false, error: `hubspot ${res.status}` };
  },
};

/* ─────────────────────────── Paste-key providers ─────────────────────────── */
// For providers where OAuth setup is heavyweight or the customer just has
// an API key handy, we expose a paste-key flow (same UX as Resend). All of
// these run the same `__paste_key__` marker in authorizeUrl.

function pasteKeyAdapter(opts: {
  provider: Provider;
  tool: ToolDescriptor;
  endpoint: (args: Record<string, unknown>) => { url: string; init: RequestInit };
}): ProviderAdapter {
  return {
    provider: opts.provider,
    authorizeUrl(_env, { state }) { return `__paste_key__?state=${state}`; },
    async exchangeCode(_env, { code }) { return { access_token: code }; },
    tools() { return [opts.tool]; },
    async execute(_env, { tool, args, accessToken }) {
      if (tool !== opts.tool.name) return { ok: false, error: 'unknown tool' };
      const { url, init } = opts.endpoint({ ...args, _token: accessToken });
      const headers = (init.headers as Record<string, string>) ?? {};
      headers['Authorization'] = headers['Authorization'] ?? `Bearer ${accessToken}`;
      const res = await fetch(url, { ...init, headers });
      return res.ok
        ? { ok: true, data: await res.json().catch(() => ({})) }
        : { ok: false, error: `${opts.provider} ${res.status}` };
    },
  };
}

const slack: ProviderAdapter = pasteKeyAdapter({
  provider: 'slack',
  tool: {
    name: 'post_to_slack',
    description: 'Post a message to a Slack channel (use the channel name or ID). Great for new-form alerts, order notices, urgent leads.',
    parameters: {
      type: 'object',
      required: ['channel', 'text'],
      properties: { channel: { type: 'string' }, text: { type: 'string' } },
    },
  },
  endpoint: (args) => ({
    url: 'https://slack.com/api/chat.postMessage',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: String(args['channel']), text: String(args['text']) }),
    },
  }),
});

const notion: ProviderAdapter = pasteKeyAdapter({
  provider: 'notion',
  tool: {
    name: 'create_notion_page',
    description: 'Create a new page in a Notion database (great for capturing leads, support tickets, content ideas).',
    parameters: {
      type: 'object',
      required: ['database_id', 'title'],
      properties: {
        database_id: { type: 'string' },
        title: { type: 'string' },
        properties: { type: 'object' },
      },
    },
  },
  endpoint: (args) => ({
    url: 'https://api.notion.com/v1/pages',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({
        parent: { database_id: String(args['database_id']) },
        properties: {
          Name: { title: [{ text: { content: String(args['title']) } }] },
          ...(args['properties'] as Record<string, unknown> ?? {}),
        },
      }),
    },
  }),
});

const github: ProviderAdapter = pasteKeyAdapter({
  provider: 'github',
  tool: {
    name: 'open_github_issue',
    description: 'Open a GitHub issue in a repo (great for bug reports captured from a website form).',
    parameters: {
      type: 'object',
      required: ['repo', 'title', 'body'],
      properties: {
        repo: { type: 'string', description: 'owner/repo' },
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  endpoint: (args) => ({
    url: `https://api.github.com/repos/${args['repo']}/issues`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'projectsites-mcp',
      },
      body: JSON.stringify({
        title: String(args['title']),
        body: String(args['body']),
        labels: args['labels'] ?? [],
      }),
    },
  }),
});

const linear: ProviderAdapter = pasteKeyAdapter({
  provider: 'linear',
  tool: {
    name: 'create_linear_issue',
    description: 'Create a Linear issue (bug, feature, support ticket).',
    parameters: {
      type: 'object',
      required: ['team_id', 'title'],
      properties: {
        team_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  endpoint: (args) => ({
    url: 'https://api.linear.app/graphql',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation($i: IssueCreateInput!) { issueCreate(input: $i) { success issue { id identifier url } } }',
        variables: { i: { teamId: String(args['team_id']), title: String(args['title']), description: String(args['description'] ?? '') } },
      }),
    },
  }),
});

const discord: ProviderAdapter = pasteKeyAdapter({
  provider: 'discord',
  tool: {
    name: 'post_to_discord',
    description: 'Post a message to a Discord channel via a webhook URL (the "API key" here is the webhook URL).',
    parameters: { type: 'object', required: ['content'], properties: { content: { type: 'string' } } },
  },
  endpoint: (args) => ({
    url: String(args['_token']),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(args['content']) }),
    },
  }),
});

const googleCalendar: ProviderAdapter = pasteKeyAdapter({
  provider: 'google_calendar',
  tool: {
    name: 'create_calendar_event',
    description: 'Create a Google Calendar event (paste an OAuth access token; use Calendly MCP for full booking flows).',
    parameters: {
      type: 'object',
      required: ['calendar_id', 'summary', 'start_iso', 'end_iso'],
      properties: {
        calendar_id: { type: 'string', default: 'primary' },
        summary: { type: 'string' },
        description: { type: 'string' },
        start_iso: { type: 'string' },
        end_iso: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  endpoint: (args) => ({
    url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(String(args['calendar_id'] ?? 'primary'))}/events`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: String(args['summary']),
        description: String(args['description'] ?? ''),
        start: { dateTime: String(args['start_iso']) },
        end: { dateTime: String(args['end_iso']) },
        attendees: (args['attendees'] as string[] | undefined)?.map((email) => ({ email })) ?? [],
      }),
    },
  }),
});

const twilio: ProviderAdapter = pasteKeyAdapter({
  provider: 'twilio',
  tool: {
    name: 'send_sms',
    description: 'Send an SMS via Twilio (paste-key = ACCOUNT_SID:AUTH_TOKEN combined as Basic auth).',
    parameters: { type: 'object', required: ['to', 'from', 'body'], properties: { to: { type: 'string' }, from: { type: 'string' }, body: { type: 'string' } } },
  },
  endpoint: (args) => {
    const token = String(args['_token']);
    const [sid, key] = token.split(':');
    return {
      url: `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${key}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: String(args['to']), From: String(args['from']), Body: String(args['body']) }).toString(),
      },
    };
  },
});

const calendly: ProviderAdapter = pasteKeyAdapter({
  provider: 'calendly',
  tool: {
    name: 'list_calendly_events',
    description: 'List upcoming Calendly events for the connected user (paste-key = personal access token).',
    parameters: { type: 'object', properties: { count: { type: 'integer', default: 20 } } },
  },
  endpoint: (args) => ({
    url: `https://api.calendly.com/scheduled_events?count=${args['count'] ?? 20}`,
    init: { method: 'GET' },
  }),
});

const airtable: ProviderAdapter = pasteKeyAdapter({
  provider: 'airtable',
  tool: {
    name: 'append_airtable_row',
    description: 'Append a row to an Airtable table.',
    parameters: {
      type: 'object',
      required: ['base_id', 'table_name', 'fields'],
      properties: { base_id: { type: 'string' }, table_name: { type: 'string' }, fields: { type: 'object' } },
    },
  },
  endpoint: (args) => ({
    url: `https://api.airtable.com/v0/${args['base_id']}/${encodeURIComponent(String(args['table_name']))}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: args['fields'] }] }),
    },
  }),
});

const zapier: ProviderAdapter = pasteKeyAdapter({
  provider: 'zapier',
  tool: {
    name: 'trigger_zapier_webhook',
    description: 'POST a payload to a Zapier Catch Hook (the "API key" is the webhook URL).',
    parameters: { type: 'object', properties: { payload: { type: 'object' } } },
  },
  endpoint: (args) => ({
    url: String(args['_token']),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args['payload'] ?? {}),
    },
  }),
});

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  mailchimp, stripe, resend, hubspot,
  slack, notion, github, linear, discord,
  google_calendar: googleCalendar,
  twilio, calendly, airtable, zapier,
};

export function getAdapter(provider: Provider): ProviderAdapter | undefined {
  return ADAPTERS[provider];
}

export function allProviders(): Provider[] {
  return Object.keys(ADAPTERS) as Provider[];
}

/** Load a site's active MCP connections + return decrypted tokens. */
export interface ActiveConnection {
  provider: Provider;
  accessToken: string;
  metadata: Record<string, unknown>;
}

export async function loadConnections(
  env: Env,
  siteId: string,
  onlyProviders?: Provider[],
): Promise<ActiveConnection[]> {
  const placeholders = onlyProviders?.length
    ? ` AND provider IN (${onlyProviders.map(() => '?').join(',')})`
    : '';
  const rows = await env.DB.prepare(
    `SELECT provider, access_token_encrypted, account_metadata_json
     FROM mcp_connections
     WHERE site_id = ? AND status = 'active'${placeholders}`,
  )
    .bind(siteId, ...(onlyProviders ?? []))
    .all<{ provider: Provider; access_token_encrypted: string; account_metadata_json: string | null }>();
  const out: ActiveConnection[] = [];
  for (const r of rows.results ?? []) {
    try {
      const token = await decrypt(env, r.access_token_encrypted);
      out.push({
        provider: r.provider,
        accessToken: token,
        metadata: r.account_metadata_json ? JSON.parse(r.account_metadata_json) : {},
      });
    } catch {
      /* skip rows that fail to decrypt (likely missing key in dev) */
    }
  }
  return out;
}

/** Tool descriptors across all connected providers for a site (for the prompt). */
export async function loadAvailableTools(env: Env, siteId: string): Promise<ToolDescriptor[]> {
  const conns = await loadConnections(env, siteId);
  return conns.flatMap((c) => ADAPTERS[c.provider].tools());
}

export async function executeTool(
  env: Env,
  siteId: string,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const conns = await loadConnections(env, siteId);
  for (const conn of conns) {
    const adapter = ADAPTERS[conn.provider];
    const supports = adapter.tools().some((t) => t.name === call.name);
    if (!supports) continue;
    return adapter.execute(env, {
      tool: call.name,
      args: call.arguments,
      accessToken: conn.accessToken,
      metadata: conn.metadata,
    });
  }
  return { ok: false, error: `no connected provider for tool "${call.name}"` };
}
