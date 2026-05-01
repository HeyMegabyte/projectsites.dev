import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import {
  ApiService,
  type FormSubmission,
  type NewsletterIntegration,
  type NewsletterProvider,
} from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface ProviderMeta {
  id: NewsletterProvider;
  name: string;
  icon: string;
  description: string;
  needsApiKey: boolean;
  needsListId: boolean;
  needsWebhookUrl: boolean;
  helpUrl: string;
}

const PROVIDERS: ProviderMeta[] = [
  { id: 'mailchimp',  name: 'Mailchimp',   icon: '🐵', description: 'Sync subscribers to a Mailchimp audience.',         needsApiKey: true,  needsListId: true,  needsWebhookUrl: false, helpUrl: 'https://mailchimp.com/help/about-api-keys/' },
  { id: 'webhook',    name: 'Webhook',     icon: '🔗', description: 'POST every submission to any URL you control.',     needsApiKey: false, needsListId: false, needsWebhookUrl: true,  helpUrl: 'https://projectsites.dev/docs/forms#webhook' },
  { id: 'resend',     name: 'Resend',      icon: '📨', description: 'Send transactional emails through Resend.',         needsApiKey: true,  needsListId: false, needsWebhookUrl: false, helpUrl: 'https://resend.com/docs/api-reference' },
  { id: 'sendgrid',   name: 'SendGrid',    icon: '✉️', description: 'Add subscribers to a SendGrid contact list.',        needsApiKey: true,  needsListId: true,  needsWebhookUrl: false, helpUrl: 'https://docs.sendgrid.com/api-reference' },
  { id: 'convertkit', name: 'ConvertKit',  icon: '🎯', description: 'Tag subscribers in ConvertKit (Kit) sequences.',     needsApiKey: true,  needsListId: true,  needsWebhookUrl: false, helpUrl: 'https://developers.convertkit.com/' },
  { id: 'klaviyo',    name: 'Klaviyo',     icon: '🟣', description: 'Push leads into a Klaviyo list with profile data.', needsApiKey: true,  needsListId: true,  needsWebhookUrl: false, helpUrl: 'https://developers.klaviyo.com/' },
];

@Component({
  selector: 'app-admin-email',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      @if (!state.selectedSite()) {
        <div class="flex flex-col items-center justify-center text-center py-20 px-5 text-text-secondary gap-3">
          <h3 class="text-white font-semibold text-base m-0">No site selected</h3>
          <p class="text-[0.9rem] max-w-[400px] m-0">Choose a site from the sidebar to manage its e-mail integrations and form submissions.</p>
        </div>
      } @else {
        <header class="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 class="text-xl font-bold text-white m-0 mb-1">E-mail &amp; Forms</h1>
            <p class="text-[0.85rem] text-text-secondary m-0 max-w-[640px]">
              Connect a newsletter provider, then drop the projectsites.dev script into any site to capture
              submissions through one standardized API.
            </p>
          </div>
          <div class="flex gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
            @for (t of tabs; track t.id) {
              <button class="tab-btn" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
            }
          </div>
        </header>

        @if (tab() === 'integrations') {
          <section class="grid grid-cols-3 gap-3 mb-7 max-lg:grid-cols-2 max-md:grid-cols-1">
            @for (provider of providers; track provider.id) {
              <article class="provider-card" [class.connected]="isConnected(provider.id)">
                <header class="flex items-center gap-3 mb-2">
                  <span class="text-2xl">{{ provider.icon }}</span>
                  <div class="flex-1 min-w-0">
                    <h3 class="text-[0.95rem] font-semibold text-white m-0">{{ provider.name }}</h3>
                    @if (isConnected(provider.id)) {
                      <span class="text-[0.65rem] text-green-400 uppercase tracking-wider">Connected</span>
                    } @else {
                      <span class="text-[0.65rem] text-text-secondary/60 uppercase tracking-wider">Not connected</span>
                    }
                  </div>
                </header>
                <p class="text-[0.78rem] text-text-secondary m-0 mb-3 leading-relaxed">{{ provider.description }}</p>
                <div class="flex items-center gap-2 flex-wrap">
                  @if (isConnected(provider.id)) {
                    <button class="btn-ghost text-xs cursor-pointer" (click)="toggleActive(provider.id)">
                      {{ getIntegration(provider.id)?.active ? 'Pause' : 'Resume' }}
                    </button>
                    <button class="btn-ghost text-xs cursor-pointer text-red-400" (click)="disconnect(provider.id)">Disconnect</button>
                  } @else {
                    <button class="btn-accent text-xs cursor-pointer" (click)="openConnect(provider)">Connect</button>
                  }
                  <a class="text-[0.7rem] text-primary/60 hover:text-primary ml-auto" [href]="provider.helpUrl" target="_blank" rel="noopener">Docs &rarr;</a>
                </div>
              </article>
            }
          </section>

          <section class="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
            <header class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 class="text-sm font-semibold text-white m-0">Drop-in script</h2>
                <p class="text-[0.75rem] text-text-secondary m-0">Paste this once. Every <code class="text-primary/80">&lt;form data-projectsites-form&gt;</code> on the site auto-submits to your dashboard and any active integration.</p>
              </div>
              <button class="btn-ghost text-xs cursor-pointer" (click)="copySnippet()">Copy snippet</button>
            </header>
            <pre class="bg-black/40 border border-white/[0.04] rounded-lg p-3 text-[0.72rem] text-primary/80 overflow-x-auto m-0 leading-relaxed">{{ snippet() }}</pre>
            <p class="text-[0.7rem] text-text-secondary/70 mt-3 m-0">
              POST any payload directly to <code class="text-primary/80">https://projectsites.dev/api/v1/forms/submit</code> with header <code class="text-primary/80">X-Site-Slug: {{ state.selectedSite()?.slug }}</code> for server-side integrations.
            </p>
          </section>
        } @else {
          <section class="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
            <header class="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
              <div>
                <h2 class="text-sm font-semibold text-white m-0">Form submissions</h2>
                <p class="text-[0.72rem] text-text-secondary m-0">{{ submissions().length }} captured from this site</p>
              </div>
              <button class="btn-ghost text-xs cursor-pointer" (click)="refreshSubmissions()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Refresh
              </button>
            </header>

            @if (loadingSubmissions()) {
              <div class="flex items-center justify-center py-12 text-text-secondary text-sm">
                <div class="loading-spinner mr-3"></div> Loading submissions...
              </div>
            } @else if (submissions().length === 0) {
              <div class="flex flex-col items-center justify-center py-16 px-5 text-center text-text-secondary gap-2">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" class="opacity-40"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <h3 class="text-white text-sm font-semibold m-0">No submissions yet</h3>
                <p class="text-[0.78rem] m-0 max-w-[380px]">Embed the snippet above on this site. Submissions will land here in real time.</p>
              </div>
            } @else {
              <div class="grid grid-cols-[1fr_280px] max-lg:grid-cols-1">
                <div class="border-r border-white/[0.04] max-lg:border-r-0 max-lg:border-b max-h-[600px] overflow-y-auto sidebar-scrollbar">
                  @for (s of submissions(); track s.id) {
                    <button class="submission-row" [class.selected]="selectedId() === s.id" (click)="selectedId.set(s.id)">
                      <div class="flex items-center justify-between gap-2 mb-1">
                        <span class="text-[0.78rem] font-semibold text-white truncate">{{ s.email || s.form_name || 'Anonymous' }}</span>
                        <span class="text-[0.65rem] text-text-secondary/60 flex-shrink-0">{{ state.formatRelativeTime(s.created_at) }}</span>
                      </div>
                      <div class="text-[0.7rem] text-text-secondary truncate">{{ describePayload(s) }}</div>
                      @if (s.forwarded_to?.length) {
                        <div class="flex items-center gap-1 mt-1.5 flex-wrap">
                          @for (provider of s.forwarded_to ?? []; track provider) {
                            <span class="forwarded-pill">{{ provider }}</span>
                          }
                        </div>
                      }
                    </button>
                  }
                </div>
                <aside class="p-4 max-h-[600px] overflow-y-auto sidebar-scrollbar">
                  @if (selectedSubmission(); as detail) {
                    <h3 class="text-sm font-semibold text-white m-0 mb-1">{{ detail.email || detail.form_name || 'Submission' }}</h3>
                    <div class="text-[0.7rem] text-text-secondary mb-3">{{ formatTimestamp(detail.created_at) }}</div>
                    @if (detail.origin_url) {
                      <div class="mb-2"><span class="detail-label">Origin</span><a class="text-[0.75rem] text-primary/80 break-all" [href]="detail.origin_url" target="_blank" rel="noopener">{{ detail.origin_url }}</a></div>
                    }
                    @if (detail.ip_address) {
                      <div class="mb-2"><span class="detail-label">IP</span><span class="text-[0.75rem] font-mono text-white/80">{{ detail.ip_address }}</span></div>
                    }
                    <div class="mb-2">
                      <span class="detail-label">Payload</span>
                      <pre class="bg-black/40 border border-white/[0.04] rounded-lg p-3 text-[0.7rem] text-primary/80 overflow-x-auto m-0 leading-relaxed">{{ formatPayload(detail) }}</pre>
                    </div>
                  } @else {
                    <div class="text-[0.78rem] text-text-secondary/60 text-center py-10">Select a submission to view details</div>
                  }
                </aside>
              </div>
            }
          </section>
        }

        @if (connectingProvider(); as provider) {
          <div class="modal-backdrop" (click)="cancelConnect()">
            <div class="modal-card" (click)="$event.stopPropagation()">
              <h3 class="text-base font-semibold text-white m-0 mb-1">Connect {{ provider.name }}</h3>
              <p class="text-[0.78rem] text-text-secondary mb-4">{{ provider.description }}</p>
              <form (submit)="$event.preventDefault(); submitConnect(provider)" class="flex flex-col gap-3">
                @if (provider.needsApiKey) {
                  <label class="form-field">
                    <span class="form-label">API key</span>
                    <input type="password" autocomplete="off" required [(ngModel)]="apiKey" name="apiKey" placeholder="paste from provider dashboard" />
                  </label>
                }
                @if (provider.needsListId) {
                  <label class="form-field">
                    <span class="form-label">List / audience ID</span>
                    <input type="text" required [(ngModel)]="listId" name="listId" placeholder="e.g. abc123" />
                  </label>
                }
                @if (provider.needsWebhookUrl) {
                  <label class="form-field">
                    <span class="form-label">Webhook URL</span>
                    <input type="url" required [(ngModel)]="webhookUrl" name="webhookUrl" placeholder="https://example.com/hook" />
                  </label>
                }
                <div class="flex justify-end gap-2 mt-2">
                  <button type="button" class="btn-ghost text-sm cursor-pointer" (click)="cancelConnect()">Cancel</button>
                  <button type="submit" class="btn-accent text-sm cursor-pointer" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Connect' }}</button>
                </div>
              </form>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .tab-btn {
      padding: 6px 14px;
      font-size: 0.78rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.55);
      background: transparent;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.18s;
    }
    .tab-btn:hover { color: rgba(255, 255, 255, 0.85); }
    .tab-btn.active {
      color: #00E5FF;
      background: rgba(0, 229, 255, 0.08);
    }
    .provider-card {
      padding: 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
    }
    .provider-card:hover {
      border-color: rgba(0, 229, 255, 0.18);
      transform: translateY(-1px);
    }
    .provider-card.connected {
      border-color: rgba(34, 197, 94, 0.25);
      background: rgba(34, 197, 94, 0.03);
    }
    .submission-row {
      width: 100%;
      text-align: left;
      padding: 12px 16px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      cursor: pointer;
      transition: background 0.15s;
    }
    .submission-row:hover { background: rgba(0, 229, 255, 0.03); }
    .submission-row.selected { background: rgba(0, 229, 255, 0.06); }
    .forwarded-pill {
      display: inline-flex;
      padding: 1px 6px;
      font-size: 0.6rem;
      color: rgba(124, 58, 237, 0.95);
      background: rgba(124, 58, 237, 0.12);
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .detail-label {
      display: block;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255, 255, 255, 0.45);
      margin-bottom: 4px;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      padding: 16px;
    }
    .modal-card {
      width: min(440px, 100%);
      background: #0a0a1a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 20px;
    }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    .form-label { font-size: 0.72rem; font-weight: 600; color: rgba(255, 255, 255, 0.65); }
    .form-field input {
      padding: 10px 12px;
      font-size: 0.85rem;
      color: white;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-field input:focus { border-color: rgba(0, 229, 255, 0.4); }
  `],
})
export class AdminEmailComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly tabs = [
    { id: 'integrations' as const, label: 'Integrations' },
    { id: 'submissions' as const, label: 'Submissions' },
  ];
  readonly providers = PROVIDERS;

  tab = signal<'integrations' | 'submissions'>('integrations');
  integrations = signal<NewsletterIntegration[]>([]);
  submissions = signal<FormSubmission[]>([]);
  loadingSubmissions = signal(false);
  selectedId = signal<string | null>(null);
  connectingProvider = signal<ProviderMeta | null>(null);
  saving = signal(false);

  apiKey = '';
  listId = '';
  webhookUrl = '';

  selectedSubmission = computed<FormSubmission | null>(() => {
    const id = this.selectedId();
    return id ? this.submissions().find(s => s.id === id) ?? null : null;
  });

  snippet = computed(() => {
    const slug = this.state.selectedSite()?.slug ?? 'YOUR_SLUG';
    return `<script src="https://projectsites.dev/forms.js" data-slug="${slug}" defer></script>
<form data-projectsites-form="newsletter">
  <input type="email" name="email" required />
  <button type="submit">Subscribe</button>
</form>`;
  });

  ngOnInit(): void {
    this.refreshIntegrations();
    this.refreshSubmissions();
  }

  isConnected(id: NewsletterProvider): boolean {
    return this.integrations().some(i => i.provider === id);
  }

  getIntegration(id: NewsletterProvider): NewsletterIntegration | undefined {
    return this.integrations().find(i => i.provider === id);
  }

  openConnect(provider: ProviderMeta): void {
    this.apiKey = '';
    this.listId = '';
    this.webhookUrl = '';
    this.connectingProvider.set(provider);
  }

  cancelConnect(): void {
    this.connectingProvider.set(null);
  }

  submitConnect(provider: ProviderMeta): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api.createIntegration(site.id, {
      provider: provider.id,
      api_key: this.apiKey,
      list_id: this.listId || undefined,
      webhook_url: this.webhookUrl || undefined,
    }).subscribe({
      next: (res) => {
        this.integrations.update(list => [...list.filter(i => i.provider !== provider.id), res.data]);
        this.toast.success(`${provider.name} connected`);
        this.connectingProvider.set(null);
        this.saving.set(false);
      },
      error: () => { this.saving.set(false); },
    });
  }

  toggleActive(providerId: NewsletterProvider): void {
    const site = this.state.selectedSite();
    const integration = this.getIntegration(providerId);
    if (!site || !integration) return;
    this.api.updateIntegration(site.id, integration.id, { active: !integration.active }).subscribe({
      next: (res) => {
        this.integrations.update(list => list.map(i => i.id === integration.id ? res.data : i));
        this.toast.success(res.data.active ? 'Integration resumed' : 'Integration paused');
      },
    });
  }

  disconnect(providerId: NewsletterProvider): void {
    const site = this.state.selectedSite();
    const integration = this.getIntegration(providerId);
    if (!site || !integration) return;
    if (!confirm(`Disconnect ${integration.provider}?`)) return;
    this.api.deleteIntegration(site.id, integration.id).subscribe({
      next: () => {
        this.integrations.update(list => list.filter(i => i.id !== integration.id));
        this.toast.success('Integration removed');
      },
    });
  }

  refreshIntegrations(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.listIntegrations(site.id).subscribe({
      next: (res) => this.integrations.set(res.data || []),
      error: () => {},
    });
  }

  refreshSubmissions(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loadingSubmissions.set(true);
    this.api.listFormSubmissions(site.id).subscribe({
      next: (res) => {
        this.submissions.set(res.data || []);
        this.loadingSubmissions.set(false);
        if (!this.selectedId() && res.data?.length) {
          this.selectedId.set(res.data[0].id);
        }
      },
      error: () => { this.loadingSubmissions.set(false); },
    });
  }

  describePayload(s: FormSubmission): string {
    const fields = Object.entries(s.payload || {}).filter(([k]) => k !== 'email');
    if (!fields.length) return s.form_name || 'New submission';
    const [firstKey, firstVal] = fields[0];
    return `${firstKey}: ${String(firstVal).slice(0, 80)}`;
  }

  formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  formatPayload(s: FormSubmission): string {
    return JSON.stringify(s.payload, null, 2);
  }

  copySnippet(): void {
    navigator.clipboard.writeText(this.snippet()).then(() => {
      this.toast.success('Snippet copied');
    });
  }
}
