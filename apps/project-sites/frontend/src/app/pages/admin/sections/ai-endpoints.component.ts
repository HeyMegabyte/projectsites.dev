import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Endpoint {
  id: string;
  endpoint_slug: string;
  display_name: string;
  description: string | null;
  kind: 'prompt' | 'worker';
  method: 'GET' | 'POST' | 'BOTH';
  worker_language: string | null;
  wfp_script_name: string | null;
  enabled: number;
  created_at: string;
}
interface Language { id: string; label: string; helper: string; }

@Component({
  selector: 'app-admin-ai-endpoints',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">AI Endpoints</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Build your own backend. Every endpoint lives at <code class="font-mono text-primary text-[0.78rem]">/api/ai/{{state.selectedSite()?.slug}}/&#123;slug&#125;</code>.
            Either write a <strong>prompt</strong> (the AI handles each request) or upload <strong>real code</strong> (JS/TS/Python/Rust-Wasm via Cloudflare Workers for Platforms).
          </p>
        </div>
        <button class="btn-primary" (click)="newEndpoint()">+ New endpoint</button>
      </header>

      @if (!wfpConfigured()) {
        <div class="card bg-amber-500/[0.06] border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">Workers for Platforms not provisioned.</strong>
          You can ship <em>prompt</em>-kind endpoints today. Code-kind requires Workers for Platforms ($25/mo on your Cloudflare account) — set <code class="font-mono">WFP_NAMESPACE_NAME</code>, <code class="font-mono">CF_ACCOUNT_ID</code>, <code class="font-mono">CF_API_TOKEN</code> + a <code class="font-mono">[[dispatch_namespaces]]</code> binding to enable.
        </div>
      }

      <section class="card p-0 overflow-hidden">
        @if (loading()) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (endpoints().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">
            No endpoints yet. Click <strong>+ New endpoint</strong> above to build one.
          </div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-3">Slug</th>
                <th class="text-left p-3">Name</th>
                <th class="text-left p-3">Kind</th>
                <th class="text-left p-3">Method</th>
                <th class="text-left p-3">Created</th>
                <th class="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              @for (e of endpoints(); track e.id) {
                <tr class="border-b border-white/[0.04] hover:bg-white/[0.03]">
                  <td class="p-3 font-mono text-[0.72rem] text-primary">{{ e.endpoint_slug }}</td>
                  <td class="p-3">{{ e.display_name }}</td>
                  <td class="p-3"><span class="badge">{{ e.kind === 'worker' ? (e.worker_language || 'worker') : 'prompt' }}</span></td>
                  <td class="p-3 text-[0.7rem]">{{ e.method }}</td>
                  <td class="p-3 text-text-secondary">{{ e.created_at | date:'short' }}</td>
                  <td class="p-3 text-right">
                    <button class="text-primary text-[0.7rem] mr-3" (click)="edit(e)">Edit</button>
                    <a class="text-text-secondary text-[0.7rem] mr-3" [href]="endpointUrl(e)" target="_blank" rel="noopener">Open ↗</a>
                    <button class="text-red-400 text-[0.7rem]" (click)="remove(e)">Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (editing(); as ed) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">{{ ed.id ? 'Edit endpoint' : 'New endpoint' }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="editing.set(null)">×</button>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <label class="block">
              <span class="muted-h">Slug</span>
              <input class="input-field w-full mt-1 font-mono" placeholder="quote-request" [(ngModel)]="ed.endpoint_slug" [disabled]="!!ed.id" />
            </label>
            <label class="block">
              <span class="muted-h">Display name</span>
              <input class="input-field w-full mt-1" placeholder="Quote request handler" [(ngModel)]="ed.display_name" />
            </label>
            <label class="block">
              <span class="muted-h">Method</span>
              <select class="input-field w-full mt-1" [(ngModel)]="ed.method">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="BOTH">GET + POST</option>
              </select>
            </label>
            <label class="block">
              <span class="muted-h">Kind</span>
              <select class="input-field w-full mt-1" [(ngModel)]="ed.kind">
                <option value="prompt">AI Prompt (default — no code)</option>
                <option value="worker" [disabled]="!wfpConfigured()">User Worker code (Workers for Platforms)</option>
              </select>
            </label>
          </div>
          <label class="block mt-3">
            <span class="muted-h">Description</span>
            <input class="input-field w-full mt-1" [(ngModel)]="ed.description" />
          </label>

          @if (ed.kind === 'prompt') {
            <label class="block mt-3">
              <span class="muted-h">AI prompt — describes what this endpoint should do with the request</span>
              <textarea class="input-field w-full mt-1 font-mono text-[0.72rem]" rows="10"
                        placeholder="You are the quote-request endpoint. Read the JSON body, validate that name + email + scope_of_work are present, then call create_stripe_invoice if Stripe MCP is connected — otherwise call send_email to notify the owner. Return ok."
                        [(ngModel)]="ed.prompt_template"></textarea>
            </label>
          } @else {
            <label class="block mt-3">
              <span class="muted-h">Language</span>
              <select class="input-field w-full mt-1" [(ngModel)]="ed.worker_language" (change)="hydrateLanguage(ed)">
                @for (l of languages(); track l.id) {
                  <option [value]="l.id">{{ l.label }}</option>
                }
              </select>
            </label>
            <label class="block mt-3">
              <span class="muted-h">Code — uploaded to Workers for Platforms as <code class="font-mono">{{ ed.endpoint_slug || 'slug' }}</code></span>
              <textarea class="input-field w-full mt-1 font-mono text-[0.7rem]" rows="14"
                        [placeholder]="ed.kind === 'worker' ? (currentLangHelper(ed) || '') : ''"
                        [(ngModel)]="ed.worker_code"></textarea>
            </label>
          }
          <div class="flex justify-end gap-2 mt-3">
            <button class="btn-ghost" (click)="editing.set(null)">Cancel</button>
            <button class="btn-primary" [disabled]="saving()" (click)="save(ed)">{{ saving() ? 'Saving…' : (ed.id ? 'Save' : 'Create') }}</button>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.5); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.5rem 1rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
  `],
})
export class AdminAiEndpointsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  endpoints = signal<Endpoint[]>([]);
  loading = signal(false);
  saving = signal(false);
  wfpConfigured = signal(false);
  languages = signal<Language[]>([]);
  editing = signal<(Partial<Endpoint> & { prompt_template?: string; worker_code?: string }) | null>(null);

  ngOnInit(): void { this.reload(); }
  reload(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.loading.set(true);
    this.api.get<{ data: Endpoint[]; wfp_configured: boolean; supported_languages: Language[] }>(
      `/sites/${s.id}/ai-endpoints`,
    ).subscribe({
      next: (r) => {
        this.endpoints.set(r.data ?? []);
        this.wfpConfigured.set(!!r.wfp_configured);
        this.languages.set(r.supported_languages ?? []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
  newEndpoint(): void {
    this.editing.set({ kind: 'prompt', method: 'POST', endpoint_slug: '', display_name: '', description: '', prompt_template: '', worker_code: '', worker_language: 'javascript' });
  }
  edit(e: Endpoint): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: Endpoint & { prompt_template: string; worker_code: string } }>(
      `/sites/${s.id}/ai-endpoints/${e.id}`,
    ).subscribe({
      next: (r) => this.editing.set({ ...r.data }),
      error: () => this.editing.set({ ...e }),
    });
  }
  hydrateLanguage(ed: { worker_language?: string | null; worker_code?: string }): void {
    const lang = this.languages().find((l) => l.id === ed.worker_language);
    if (lang && !ed.worker_code?.trim()) ed.worker_code = lang.helper;
  }
  currentLangHelper(ed: { worker_language?: string | null }): string | null {
    return this.languages().find((l) => l.id === ed.worker_language)?.helper ?? null;
  }
  save(ed: Partial<Endpoint> & { prompt_template?: string; worker_code?: string }): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.saving.set(true);
    const payload = {
      endpoint_slug: ed.endpoint_slug,
      display_name: ed.display_name,
      description: ed.description,
      kind: ed.kind,
      method: ed.method,
      prompt_template: ed.prompt_template,
      worker_language: ed.worker_language,
      worker_code: ed.worker_code,
    };
    const obs = ed.id
      ? this.api.put(`/sites/${s.id}/ai-endpoints/${ed.id}`, payload)
      : this.api.post(`/sites/${s.id}/ai-endpoints`, payload);
    obs.subscribe({
      next: () => { this.toast.success('Saved'); this.saving.set(false); this.editing.set(null); this.reload(); },
      error: (err) => { this.toast.error(err?.error?.error?.message || 'Save failed'); this.saving.set(false); },
    });
  }
  remove(e: Endpoint): void {
    if (!confirm(`Delete endpoint "${e.endpoint_slug}"? This cannot be undone.`)) return;
    const s = this.state.selectedSite(); if (!s) return;
    this.api.delete(`/sites/${s.id}/ai-endpoints/${e.id}`).subscribe({
      next: () => { this.toast.success('Deleted'); this.reload(); },
    });
  }
  endpointUrl(e: Endpoint): string {
    return `https://projectsites.dev/api/ai/${this.state.selectedSite()?.slug}/${e.endpoint_slug}`;
  }
}
