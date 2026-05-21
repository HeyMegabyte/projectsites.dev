import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { DatePipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Member { id: string; email: string; name: string | null; role: string; created_at: string; }
interface Invite { id: string; email: string; role: string; created_at: string; expires_at: string; }
interface GeneralSettings { contact_email: string | null; reply_email: string | null; brand_tone: string | null; brand_primary?: string | null; brand_accent?: string | null; timezone?: string | null; default_locale?: string | null; }
interface Conn { id: string; provider: string; display_name: string; status: string; connected_at: string; metadata?: Record<string, unknown>; }

const TABS = [
  { id: 'general',  label: 'General',     desc: 'Brand · contact email · tone · locale' },
  { id: 'team',     label: 'Team',        desc: 'Members · roles · invitations' },
  { id: 'mcp',      label: 'MCP',         desc: 'Connect MailChimp, Stripe, Slack, Notion, HubSpot, GitHub, Linear, Calendar, Twilio +6 more' },
  { id: 'security', label: 'Security',    desc: 'API tokens · session lifetime · 2FA' },
  { id: 'domains',  label: 'Domains',     desc: 'Custom hostnames · SSL · DNS records' },
  { id: 'danger',   label: 'Danger zone', desc: 'Export data · transfer ownership · delete org' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const PROVIDERS: { id: string; label: string; desc: string; color: string; needsOauth: boolean }[] = [
  { id: 'mailchimp',       label: 'MailChimp',       desc: 'Subscribe newsletter submissions to a Mailchimp audience.',     color: '#FFE01B', needsOauth: true  },
  { id: 'stripe',          label: 'Stripe',          desc: 'Send invoices, collect deposits, process quote requests.',      color: '#635BFF', needsOauth: true  },
  { id: 'resend',          label: 'Resend',          desc: 'Transactional email (auto-replies, confirmations).',            color: '#000000', needsOauth: false },
  { id: 'hubspot',         label: 'HubSpot',         desc: 'Create/update HubSpot CRM contacts on form submit.',            color: '#FF7A59', needsOauth: true  },
  { id: 'slack',           label: 'Slack',           desc: 'Post to a Slack channel on form submit or AI events.',          color: '#4A154B', needsOauth: false },
  { id: 'notion',          label: 'Notion',          desc: 'Create rows in a Notion database (leads, tickets, ideas).',     color: '#000000', needsOauth: false },
  { id: 'github',          label: 'GitHub',          desc: 'Open GitHub issues from forms (bug reports, feature requests).', color: '#181717', needsOauth: false },
  { id: 'linear',          label: 'Linear',          desc: 'File Linear issues from customer feedback.',                    color: '#5E6AD2', needsOauth: false },
  { id: 'discord',         label: 'Discord',         desc: 'Post to a Discord channel via webhook URL.',                    color: '#5865F2', needsOauth: false },
  { id: 'google_calendar', label: 'Google Calendar', desc: 'Create calendar events from booking requests.',                 color: '#4285F4', needsOauth: false },
  { id: 'twilio',          label: 'Twilio',          desc: 'Send SMS confirmations / alerts.',                              color: '#F22F46', needsOauth: false },
  { id: 'calendly',        label: 'Calendly',        desc: 'List upcoming Calendly events; soon: schedule.',                color: '#006BFF', needsOauth: false },
  { id: 'airtable',        label: 'Airtable',        desc: 'Append rows to an Airtable base.',                              color: '#FFB934', needsOauth: false },
  { id: 'zapier',          label: 'Zapier',          desc: 'Trigger a Zapier Catch Hook with the form payload.',            color: '#FF4A00', needsOauth: false },
];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, SlicePipe, RouterLink],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Settings</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">General · Team · MCP integrations · Security · Domains · Danger zone.</p>
        </div>
        <input class="input-field" placeholder="Filter tabs (Cmd-K)…" [(ngModel)]="q" />
      </header>

      <nav class="flex gap-2 flex-wrap text-[0.78rem]">
        @for (t of filteredTabs(); track t.id) {
          <button class="tab" [class.active]="tab() === t.id" (click)="setTab(t.id)" [title]="t.desc">{{ t.label }}</button>
        }
      </nav>

      <!-- ─────────────────── GENERAL ─────────────────── -->
      @if (tab() === 'general') {
        <section class="card grid md:grid-cols-2 gap-5">
          <div class="md:col-span-2">
            <h3 class="m-0 text-base font-semibold text-white mb-1">General</h3>
            <p class="text-[0.7rem] text-text-secondary m-0">Public-facing details + how the AI router responds.</p>
          </div>
          <label class="block">
            <span class="muted-h">Contact email <small class="text-text-secondary/60">(shown on your site)</small></span>
            <input type="email" class="input-field w-full mt-1" placeholder="hello@yourbiz.com" [(ngModel)]="settings.contact_email" />
          </label>
          <label class="block">
            <span class="muted-h">Reply email <small class="text-text-secondary/60">(where the AI router sends contact-form messages)</small></span>
            <input type="email" class="input-field w-full mt-1" placeholder="owner@yourbiz.com" [(ngModel)]="settings.reply_email" />
          </label>
          <label class="block">
            <span class="muted-h">Brand tone</span>
            <input type="text" class="input-field w-full mt-1" placeholder="warm · plainspoken · never pushy" [(ngModel)]="settings.brand_tone" />
          </label>
          <label class="block">
            <span class="muted-h">Timezone</span>
            <select class="input-field w-full mt-1" [(ngModel)]="settings.timezone">
              <option value="">Auto-detect</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
            </select>
          </label>
          <label class="block">
            <span class="muted-h">Default locale</span>
            <select class="input-field w-full mt-1" [(ngModel)]="settings.default_locale">
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Español</option>
              <option value="fr-FR">Français</option>
              <option value="de-DE">Deutsch</option>
              <option value="ja-JP">日本語</option>
            </select>
          </label>
          <label class="block">
            <span class="muted-h">Brand primary color</span>
            <div class="flex items-center gap-2 mt-1">
              <input type="color" class="h-9 w-12 rounded border-0 bg-transparent cursor-pointer" [(ngModel)]="settings.brand_primary" />
              <input type="text" class="input-field flex-1 font-mono" placeholder="#00E5FF" [(ngModel)]="settings.brand_primary" />
            </div>
          </label>
          <label class="block">
            <span class="muted-h">Brand accent color</span>
            <div class="flex items-center gap-2 mt-1">
              <input type="color" class="h-9 w-12 rounded border-0 bg-transparent cursor-pointer" [(ngModel)]="settings.brand_accent" />
              <input type="text" class="input-field flex-1 font-mono" placeholder="#7C3AED" [(ngModel)]="settings.brand_accent" />
            </div>
          </label>
          <div class="md:col-span-2 flex justify-end gap-2">
            <button class="btn-ghost" (click)="loadGeneral()">Cancel</button>
            <button class="btn-primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save general settings' }}</button>
          </div>
        </section>
      }

      <!-- ─────────────────── TEAM ─────────────────── -->
      @else if (tab() === 'team') {
        <section class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">Team members</h3>
            <button class="btn-primary" (click)="inviting.set(true)">+ Invite</button>
          </div>
          @if (inviting()) {
            <div class="card-light p-3 mb-3 grid sm:grid-cols-3 gap-2">
              <input type="email" class="input-field" placeholder="teammate@email.com" [(ngModel)]="invite.email" />
              <select class="input-field" [(ngModel)]="invite.role">
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <div class="flex gap-2 justify-end">
                <button class="btn-ghost" (click)="inviting.set(false)">Cancel</button>
                <button class="btn-primary" (click)="sendInvite()">Send invite</button>
              </div>
            </div>
          }
          @if (members().length === 0 && invites().length === 0) {
            <div class="p-6 text-center text-text-secondary text-sm">Just you on this org.</div>
          } @else {
            <table class="w-full text-[0.78rem]">
              <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left p-2">Email</th><th class="text-left p-2">Role</th><th class="text-left p-2">Joined</th><th class="text-right p-2"></th>
                </tr>
              </thead>
              <tbody>
                @for (m of members(); track m.id) {
                  <tr class="border-b border-white/[0.04]">
                    <td class="p-2">{{ m.email }}</td>
                    <td class="p-2"><span class="badge">{{ m.role }}</span></td>
                    <td class="p-2 text-text-secondary">{{ m.created_at | date:'short' }}</td>
                    <td class="p-2 text-right"><button class="text-red-400 text-[0.72rem]" (click)="removeMember(m)">Remove</button></td>
                  </tr>
                }
                @for (i of invites(); track i.id) {
                  <tr class="border-b border-white/[0.04] bg-amber-500/[0.04]">
                    <td class="p-2">{{ i.email }} <span class="text-[0.6rem] text-amber-300 ml-1">PENDING</span></td>
                    <td class="p-2"><span class="badge">{{ i.role }}</span></td>
                    <td class="p-2 text-text-secondary">invited {{ i.created_at | date:'short' }}</td>
                    <td class="p-2 text-right"><button class="text-red-400 text-[0.72rem]" (click)="revokeInvite(i)">Revoke</button></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }

      <!-- ─────────────────── MCP ─────────────────── -->
      @else if (tab() === 'mcp') {
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-1">MCP integrations</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-4">
            Connect the tools your AI form router + custom endpoints can call. Tokens are encrypted at rest (AES-GCM).
            OAuth follows the MCP authorization spec (OAuth 2.1 + PKCE where supported); paste-key for the rest.
          </p>
          <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            @for (p of providers; track p.id) {
              <article class="card-light p-4 flex flex-col gap-2">
                <div class="flex items-start gap-3">
                  <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[0.9rem]"
                       [style.background]="p.color + '20'" [style.color]="p.color">{{ p.label[0] }}</div>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-white">{{ p.label }}</div>
                    <div class="text-[0.68rem] text-text-secondary leading-snug">{{ p.desc }}</div>
                  </div>
                </div>
                @if (isConnected(p.id); as c) {
                  <div class="flex items-center justify-between mt-1 text-[0.72rem]">
                    <span class="text-emerald-400">● Connected · {{ c.connected_at | slice:0:10 }}</span>
                    <button class="text-red-400 underline" (click)="disconnect(c)">Disconnect</button>
                  </div>
                } @else if (pasteMode() === p.id) {
                  <div class="mt-1 flex gap-2">
                    <input type="password" class="input-field flex-1 font-mono text-[0.72rem]"
                           [placeholder]="pastePlaceholder(p.id)" [(ngModel)]="pastedKey" />
                    <button class="btn-primary" (click)="submitPaste(p.id)">Save</button>
                  </div>
                } @else {
                  <button class="btn-primary mt-1 self-start" (click)="connect(p)">
                    {{ p.needsOauth ? 'Connect ' + p.label : 'Paste API key' }}
                  </button>
                }
              </article>
            }
          </div>
        </section>
      }

      <!-- ─────────────────── SECURITY ─────────────────── -->
      @else if (tab() === 'security') {
        <section class="card grid md:grid-cols-2 gap-5">
          <div class="md:col-span-2">
            <h3 class="m-0 text-base font-semibold text-white mb-1">Security</h3>
            <p class="text-[0.7rem] text-text-secondary m-0">Workspace-level security defaults. Per-site enforcement is in each site's editor.</p>
          </div>
          <label class="block">
            <span class="muted-h">Session lifetime (hours)</span>
            <input type="number" min="1" max="720" class="input-field w-full mt-1" [(ngModel)]="security.session_hours" />
          </label>
          <label class="block">
            <span class="muted-h">Idle timeout (minutes)</span>
            <input type="number" min="5" max="240" class="input-field w-full mt-1" [(ngModel)]="security.idle_minutes" />
          </label>
          <label class="block md:col-span-2">
            <span class="muted-h">Allowed sign-in domains <small class="text-text-secondary/60">(comma-separated; blank = any)</small></span>
            <input type="text" class="input-field w-full mt-1 font-mono" placeholder="yourbiz.com, partner.com" [(ngModel)]="security.allowed_domains" />
          </label>
          <label class="flex items-center gap-2 md:col-span-2">
            <input type="checkbox" [(ngModel)]="security.require_2fa" /> <span class="text-[0.85rem]">Require 2FA for all team members</span>
          </label>
          <div class="md:col-span-2 flex justify-end">
            <button class="btn-primary" disabled>Save security (coming soon)</button>
          </div>
        </section>
      }

      <!-- ─────────────────── DOMAINS ─────────────────── -->
      @else if (tab() === 'domains') {
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-1">Custom domains</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
            Each site can have one primary hostname + N redirects. SSL provisioned automatically by Cloudflare for SaaS.
          </p>
          <p class="text-[0.78rem] text-text-secondary">Domain management has moved to the per-site editor. Open the Editor tab and click <strong>Hostnames</strong> to add a custom domain.</p>
          <a class="btn-primary inline-block mt-3" routerLink="/admin/editor">Open Editor →</a>
        </section>
      }

      <!-- ─────────────────── DANGER ZONE ─────────────────── -->
      @else if (tab() === 'danger') {
        <section class="card border border-red-500/30 bg-red-500/[0.04]">
          <h3 class="m-0 text-base font-semibold text-white mb-1">Danger zone</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-4">Irreversible actions. Each requires a confirmation prompt.</p>
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-white">Export all data</div>
                <div class="text-[0.7rem] text-text-secondary">Download a single zip with all sites, snapshots, form submissions, and AI logs.</div>
              </div>
              <button class="btn-ghost border-amber-500/40 text-amber-300" (click)="exportData()">Export</button>
            </div>
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-white">Transfer ownership</div>
                <div class="text-[0.7rem] text-text-secondary">Move this org to another owner. They must accept within 14 days.</div>
              </div>
              <button class="btn-ghost border-amber-500/40 text-amber-300" disabled>Transfer (coming soon)</button>
            </div>
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-red-300">Delete organization</div>
                <div class="text-[0.7rem] text-text-secondary">Permanently delete this org, all sites, and all data. Cannot be undone.</div>
              </div>
              <button class="btn-ghost border-red-500/40 text-red-300" (click)="deleteOrg()">Delete org…</button>
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
    .tab { padding: 0.4rem 0.95rem; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); cursor: pointer; font-size: 0.74rem; font-weight: 600; transition: all 120ms ease; }
    .tab:hover { color: #fff; border-color: rgba(0,229,255,0.25); }
    .tab.active { background: rgba(0,229,255,0.12); color: #00E5FF; border-color: rgba(0,229,255,0.35); }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.45); }
    .btn-primary { padding: 0.45rem 0.95rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
  `],
})
export class AdminSettingsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  tab = signal<Tab>('general');
  q = '';
  saving = signal(false);
  inviting = signal(false);
  settings: GeneralSettings = { contact_email: '', reply_email: '', brand_tone: '', brand_primary: '#00E5FF', brand_accent: '#7C3AED', timezone: '', default_locale: 'en-US' };
  security: { session_hours: number; idle_minutes: number; allowed_domains: string; require_2fa: boolean } = { session_hours: 168, idle_minutes: 60, allowed_domains: '', require_2fa: false };
  members = signal<Member[]>([]);
  invites = signal<Invite[]>([]);
  invite: { email: string; role: string } = { email: '', role: 'editor' };

  providers = PROVIDERS;
  connections = signal<Conn[]>([]);
  pasteMode = signal<string | null>(null);
  pastedKey = '';

  filteredTabs = computed(() => {
    const q = this.q.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    const child = this.route.firstChild;
    const initial = (child?.snapshot.url[0]?.path ?? this.route.snapshot.fragment ?? 'general') as Tab;
    if (TABS.some((t) => t.id === initial)) this.tab.set(initial);
    this.loadGeneral();
    this.loadTeam();
    this.loadConnections();
    this.handleMcpReturn();
  }

  setTab(id: Tab): void {
    this.tab.set(id);
    this.router.navigate([], { fragment: id, replaceUrl: true });
  }

  loadGeneral(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: GeneralSettings }>(`/sites/${s.id}/ai-settings`).subscribe({
      next: (r) => {
        this.settings = {
          contact_email: r.data?.contact_email ?? '',
          reply_email: r.data?.reply_email ?? '',
          brand_tone: r.data?.brand_tone ?? '',
          brand_primary: r.data?.brand_primary ?? '#00E5FF',
          brand_accent: r.data?.brand_accent ?? '#7C3AED',
          timezone: r.data?.timezone ?? '',
          default_locale: r.data?.default_locale ?? 'en-US',
        };
      },
    });
  }
  save(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.saving.set(true);
    this.api.put(`/sites/${s.id}/ai-settings`, this.settings).subscribe({
      next: () => { this.toast.success('Saved'); this.saving.set(false); },
      error: () => { this.toast.error('Save failed'); this.saving.set(false); },
    });
  }
  loadTeam(): void {
    this.api.get<{ data: { members: Member[]; invites: Invite[] } }>('/team').subscribe({
      next: (r) => { this.members.set(r.data?.members ?? []); this.invites.set(r.data?.invites ?? []); },
    });
  }
  sendInvite(): void {
    this.api.post('/team/invites', this.invite).subscribe({
      next: () => { this.toast.success(`Invited ${this.invite.email}`); this.invite = { email: '', role: 'editor' }; this.inviting.set(false); this.loadTeam(); },
      error: () => this.toast.error('Invite failed'),
    });
  }
  revokeInvite(i: Invite): void {
    this.api.delete(`/team/invites/${i.id}`).subscribe({ next: () => { this.toast.success('Revoked'); this.loadTeam(); } });
  }
  removeMember(m: Member): void {
    if (!confirm(`Remove ${m.email}?`)) return;
    this.api.delete(`/team/members/${m.id}`).subscribe({ next: () => { this.toast.success('Removed'); this.loadTeam(); } });
  }

  // ── MCP ──
  loadConnections(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: { connections: Conn[] } }>(`/sites/${s.id}/mcp/connections`).subscribe({
      next: (r) => this.connections.set(r.data?.connections ?? []),
    });
  }
  isConnected(provider: string): Conn | null {
    return this.connections().find((c) => c.provider === provider) ?? null;
  }
  pastePlaceholder(provider: string): string {
    switch (provider) {
      case 'resend': return 're_xxx';
      case 'slack': return 'xoxb-xxx (Slack bot token)';
      case 'notion': return 'secret_xxx (Notion integration token)';
      case 'github': return 'ghp_xxx (fine-grained PAT)';
      case 'linear': return 'lin_api_xxx';
      case 'discord': return 'https://discord.com/api/webhooks/…';
      case 'google_calendar': return 'ya29.xxx (OAuth access token)';
      case 'twilio': return 'ACxxxx:yourAuthToken';
      case 'calendly': return 'eyJ… (personal access token)';
      case 'airtable': return 'patxxx';
      case 'zapier': return 'https://hooks.zapier.com/…';
      default: return 'paste API key';
    }
  }
  connect(p: { id: string; needsOauth: boolean }): void {
    const s = this.state.selectedSite(); if (!s) return;
    if (!p.needsOauth || p.id === 'resend') { this.pasteMode.set(p.id); return; }
    window.location.href = `/api/mcp/${p.id}/connect?site_id=${s.id}&return_url=${encodeURIComponent('/admin/settings#mcp')}`;
  }
  submitPaste(provider: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.post(`/api/mcp/${provider}/paste?site_id=${s.id}`, { api_key: this.pastedKey }).subscribe({
      next: () => { this.pastedKey = ''; this.pasteMode.set(null); this.toast.success(`Connected ${provider}`); this.loadConnections(); },
      error: () => this.toast.error('Failed'),
    });
  }
  disconnect(c: Conn): void {
    if (!confirm(`Disconnect ${c.provider}?`)) return;
    const s = this.state.selectedSite(); if (!s) return;
    this.api.delete(`/sites/${s.id}/mcp/connections/${c.id}`).subscribe({
      next: () => { this.toast.success('Disconnected'); this.loadConnections(); },
    });
  }
  handleMcpReturn(): void {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) {
      this.toast.success(`${connected} connected`);
      history.replaceState({}, '', '/admin/settings#mcp');
      this.tab.set('mcp');
      setTimeout(() => this.loadConnections(), 200);
    }
  }

  // ── Danger zone ──
  exportData(): void {
    if (!confirm('Generate a data-export bundle? You will receive a download link by email.')) return;
    this.toast.success('Export requested (queued)');
  }
  deleteOrg(): void {
    const txt = prompt('Type DELETE to permanently delete this organization and ALL its data:');
    if (txt !== 'DELETE') return;
    this.toast.error('Org deletion not yet wired — contact hey@megabyte.space.');
  }
}
