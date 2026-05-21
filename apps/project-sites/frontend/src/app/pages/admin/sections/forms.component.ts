import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Submission {
  id: string;
  form_name: string;
  email: string | null;
  fields: Record<string, unknown>;
  status: string;
  origin_url: string | null;
  ip_address: string | null;
  created_at: string;
}
interface AiLog {
  id: string;
  trace_kind: string;
  status: string;
  model: string;
  latency_ms: number | null;
  output_text: string | null;
  tool_name: string | null;
  tool_status: string | null;
  error_message: string | null;
  created_at: string;
}
interface Settings {
  form_router_prompt: string | null;
  form_router_prompt_default: string;
  reply_email: string | null;
}

@Component({
  selector: 'app-admin-forms',
  standalone: true,
  imports: [FormsModule, DatePipe, JsonPipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Forms</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            One prompt routes every form submission to the right action — MailChimp signup, Stripe invoice, email reply, HubSpot contact — using your connected MCPs.
          </p>
        </div>
        <button class="btn-ghost" (click)="reload()" [disabled]="loading()">{{ loading() ? '…' : 'Refresh' }}</button>
      </header>

      <!-- Single AI router prompt -->
      <section class="card border border-primary/30">
        <div class="flex items-center justify-between mb-2">
          <h3 class="m-0 text-base font-semibold text-white">Form Router Prompt</h3>
          <span class="text-[0.55rem] uppercase font-bold py-px px-2 rounded bg-primary/15 text-primary">single prompt · all forms</span>
        </div>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          The AI returns a JSON tool call: <code class="font-mono text-primary text-[0.7rem]">add_to_mailchimp</code> ·
          <code class="font-mono text-primary text-[0.7rem]">send_email</code> ·
          <code class="font-mono text-primary text-[0.7rem]">create_stripe_invoice</code> ·
          <code class="font-mono text-primary text-[0.7rem]">create_hubspot_contact</code> ·
          <code class="font-mono text-primary text-[0.7rem]">noop</code> — the worker executes it server-side via the connected MCP.
        </p>
        <label class="block">
          <span class="text-[0.7rem] uppercase tracking-wider text-text-secondary/70 font-bold">Routing prompt (edit to add new form types)</span>
          <textarea class="input-field w-full mt-1 font-mono text-[0.72rem]" rows="14"
                    [placeholder]="settings.form_router_prompt_default"
                    [(ngModel)]="settings.form_router_prompt"></textarea>
          <button type="button" class="text-[0.65rem] text-primary mt-1 underline"
                  (click)="settings.form_router_prompt = settings.form_router_prompt_default">Reset to default</button>
        </label>
        <label class="block mt-3">
          <span class="text-[0.7rem] uppercase tracking-wider text-text-secondary/70 font-bold">Fallback reply email (used when no Resend MCP)</span>
          <input type="email" class="input-field w-full mt-1" placeholder="owner@yourbiz.com" [(ngModel)]="settings.reply_email" />
        </label>
        <div class="flex justify-between items-center mt-3">
          <a routerLink="/admin/mcp" class="text-[0.72rem] text-primary underline">Manage MCP connections →</a>
          <button class="btn-primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save router' }}</button>
        </div>
      </section>

      <!-- Submissions table -->
      <section class="card p-0 overflow-hidden">
        <div class="flex items-center justify-between p-4">
          <h3 class="m-0 text-base font-semibold text-white">Submissions</h3>
          <span class="text-[0.7rem] text-text-secondary">{{ submissions().length }} total</span>
        </div>
        @if (loading()) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (submissions().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">
            No submissions yet. Drop the snippet on your site (see <a routerLink="/admin/ai-endpoints" class="text-primary underline">AI Endpoints</a> for app.js install).
          </div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-3 font-semibold">When</th>
                <th class="text-left p-3 font-semibold">Form</th>
                <th class="text-left p-3 font-semibold">Email</th>
                <th class="text-left p-3 font-semibold">Origin</th>
                <th class="text-right p-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              @for (s of submissions(); track s.id) {
                <tr class="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                    (click)="open(s)">
                  <td class="p-3 text-text-secondary">{{ s.created_at | date:'short' }}</td>
                  <td class="p-3 font-mono text-[0.72rem]">{{ s.form_name }}</td>
                  <td class="p-3">{{ s.email || '—' }}</td>
                  <td class="p-3 text-text-secondary/70 truncate max-w-[240px]" [title]="s.origin_url">{{ s.origin_url || '—' }}</td>
                  <td class="p-3 text-right text-primary text-[0.7rem] font-semibold">Open ›</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (selected(); as s) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">{{ s.form_name }} · {{ s.created_at | date:'medium' }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="selected.set(null)">×</button>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <h4 class="muted-h">Fields</h4>
              <pre class="bg-black/30 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72">{{ s.fields | json }}</pre>
            </div>
            <div>
              <h4 class="muted-h">AI Trace</h4>
              @if (logs().length === 0) {
                <p class="text-text-secondary/70 italic text-[0.78rem]">No AI trace yet — the router may still be running or credits exhausted.</p>
              } @else {
                @for (l of logs(); track l.id) {
                  <div class="bg-black/30 border border-white/5 rounded-lg p-3 mb-2 text-[0.7rem]">
                    <div class="flex justify-between text-[0.6rem] mb-1">
                      <span class="font-mono opacity-70">{{ l.model }}</span>
                      <span class="font-bold uppercase" [class.text-emerald-400]="l.status === 'ok'" [class.text-red-400]="l.status === 'error'">{{ l.status }} · {{ l.latency_ms }}ms</span>
                    </div>
                    @if (l.tool_name) {
                      <div class="text-primary font-mono mb-1">{{ l.tool_name }} · {{ l.tool_status }}</div>
                    }
                    @if (l.error_message) {
                      <div class="text-red-300">{{ l.error_message }}</div>
                    } @else {
                      <pre class="whitespace-pre-wrap break-words">{{ l.output_text }}</pre>
                    }
                  </div>
                }
              }
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.5); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: #00E5FF; color: #060610; font-weight: 600; border: 0; cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.4rem 0.9rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin: 0 0 0.4rem; }
  `],
})
export class AdminFormsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  submissions = signal<Submission[]>([]);
  loading = signal(false);
  selected = signal<Submission | null>(null);
  logs = signal<AiLog[]>([]);
  saving = signal(false);
  settings: Settings = { form_router_prompt: '', form_router_prompt_default: '', reply_email: '' };

  ngOnInit(): void { this.reload(); this.loadSettings(); }

  reload(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loading.set(true);
    this.api.get<{ data: Submission[] }>(`/sites/${site.id}/form-submissions`).subscribe({
      next: (r) => { this.submissions.set(r.data ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toast.error('Failed to load submissions'); },
    });
  }
  open(s: Submission): void {
    this.selected.set(s);
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.get<{ data: { ai_logs: AiLog[] } }>(`/sites/${site.id}/form-submissions/${s.id}`).subscribe({
      next: (r) => this.logs.set(r.data?.ai_logs ?? []),
      error: () => this.logs.set([]),
    });
  }
  loadSettings(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.get<{ data: Settings }>(`/sites/${site.id}/ai-settings`).subscribe({
      next: (r) => {
        this.settings = {
          form_router_prompt: r.data?.form_router_prompt ?? '',
          form_router_prompt_default: r.data?.form_router_prompt_default ?? '',
          reply_email: r.data?.reply_email ?? '',
        };
      },
    });
  }
  save(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api.put(`/sites/${site.id}/ai-settings`, {
      form_router_prompt: this.settings.form_router_prompt,
      reply_email: this.settings.reply_email,
    }).subscribe({
      next: () => { this.toast.success('Saved'); this.saving.set(false); this.loadSettings(); },
      error: () => { this.toast.error('Save failed'); this.saving.set(false); },
    });
  }
}
