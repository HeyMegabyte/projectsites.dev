import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';

interface Row {
  id: string; submission_id: string | null; trace_kind: string; endpoint_slug: string | null;
  model: string; status: string; latency_ms: number | null; tokens_input: number | null;
  tokens_output: number | null; credits_debited: number | null;
  tool_name: string | null; tool_status: string | null;
  output_preview: string | null; error_message: string | null; created_at: string;
}
interface Detail extends Row {
  prompt_template: string | null; input_json: string;
  output_text: string | null; output_json: string | null;
  tool_args_json: string | null; tool_result_json: string | null;
}

@Component({
  selector: 'app-admin-ai-logs',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">AI Logs</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every AI invocation — form router, custom endpoints, chat turns. Click any row for full prompt + input + output + tool execution trace.
          </p>
        </div>
        <div class="flex gap-2 items-center">
          <select class="input-field text-[0.72rem]" [(ngModel)]="filter" (change)="reload()">
            <option value="">All kinds</option>
            <option value="form">Forms</option>
            <option value="endpoint">Endpoints</option>
            <option value="chat">Chat</option>
          </select>
          <button class="btn-ghost" (click)="reload()">Refresh</button>
        </div>
      </header>

      <div class="grid grid-cols-4 gap-3">
        <div class="card"><div class="muted-h">Calls</div><div class="text-2xl font-bold text-white">{{ rows().length }}</div></div>
        <div class="card"><div class="muted-h">Avg latency</div><div class="text-2xl font-bold text-white">{{ avgLatency() }}ms</div></div>
        <div class="card"><div class="muted-h">Errors</div><div class="text-2xl font-bold" [class.text-red-400]="errors() > 0" [class.text-white]="errors() === 0">{{ errors() }}</div></div>
        <div class="card"><div class="muted-h">Credits used</div><div class="text-2xl font-bold text-white">{{ totalCredits() }}</div></div>
      </div>

      <section class="card p-0 overflow-hidden">
        @if (loading()) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (rows().length === 0) {
          <div class="p-10 text-center text-text-secondary text-sm">No AI traces yet.</div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-3">When</th>
                <th class="text-left p-3">Kind</th>
                <th class="text-left p-3">Endpoint / Submission</th>
                <th class="text-left p-3">Status</th>
                <th class="text-left p-3">Tool</th>
                <th class="text-right p-3">ms</th>
                <th class="text-right p-3">Credits</th>
                <th class="text-left p-3">Preview</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer" (click)="open(r.id)">
                  <td class="p-3 text-text-secondary">{{ r.created_at | date:'short' }}</td>
                  <td class="p-3"><span class="badge">{{ r.trace_kind }}</span></td>
                  <td class="p-3 font-mono text-[0.72rem]">{{ r.endpoint_slug || (r.submission_id?.slice(0,8) ?? '—') }}</td>
                  <td class="p-3">
                    <span class="font-bold text-[0.62rem] uppercase"
                          [class.text-emerald-400]="r.status === 'ok'"
                          [class.text-red-400]="r.status === 'error'"
                          [class.text-amber-400]="r.status !== 'ok' && r.status !== 'error'">{{ r.status }}</span>
                  </td>
                  <td class="p-3 text-[0.7rem]">
                    @if (r.tool_name) {
                      <span class="font-mono text-primary">{{ r.tool_name }}</span>
                      <span class="text-text-secondary"> · {{ r.tool_status }}</span>
                    } @else { — }
                  </td>
                  <td class="p-3 text-right text-text-secondary">{{ r.latency_ms }}</td>
                  <td class="p-3 text-right text-text-secondary">{{ r.credits_debited || 0 }}</td>
                  <td class="p-3 text-text-secondary/80 truncate max-w-[260px]" [title]="r.error_message || r.output_preview">
                    {{ r.error_message || r.output_preview || '—' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (detail(); as d) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">Trace {{ d.id.substring(0, 8) }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="detail.set(null)">×</button>
          </div>
          <div class="space-y-3 text-[0.7rem]">
            <div><div class="muted-h">System prompt</div><pre class="trace">{{ d.prompt_template }}</pre></div>
            <div><div class="muted-h">Input</div><pre class="trace">{{ d.input_json }}</pre></div>
            <div><div class="muted-h">Output</div>
              @if (d.error_message) {
                <div class="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3">{{ d.error_message }}</div>
              } @else {
                <pre class="trace">{{ d.output_text }}</pre>
              }
            </div>
            @if (d.tool_name) {
              <div><div class="muted-h">Tool executed — {{ d.tool_name }} · {{ d.tool_status }}</div>
                <pre class="trace">{{ d.tool_args_json }}</pre>
                <pre class="trace">{{ d.tool_result_json }}</pre>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.4rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; }
    .btn-ghost { padding: 0.4rem 0.9rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }
    .trace { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 0.6rem; white-space: pre-wrap; word-break: break-word; max-height: 14rem; overflow: auto; font-size: 0.68rem; }
  `],
})
export class AdminAiLogsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  rows = signal<Row[]>([]);
  detail = signal<Detail | null>(null);
  loading = signal(false);
  filter = '';
  avgLatency = computed(() => { const list = this.rows(); if (!list.length) return 0; return Math.round(list.reduce((a,r) => a + (r.latency_ms ?? 0), 0) / list.length); });
  errors = computed(() => this.rows().filter((r) => r.status === 'error').length);
  totalCredits = computed(() => this.rows().reduce((a,r) => a + (r.credits_debited ?? 0), 0));

  ngOnInit(): void { this.reload(); }
  reload(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.loading.set(true);
    const params = this.filter ? { kind: this.filter } : undefined;
    this.api.get<{ data: Row[] }>(`/sites/${s.id}/ai-logs`, params).subscribe({
      next: (r) => { this.rows.set(r.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
  open(id: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: Detail }>(`/sites/${s.id}/ai-logs/${id}`).subscribe({
      next: (r) => this.detail.set(r.data),
    });
  }
}
