import { Component, inject, signal, type OnInit } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Conn { id: string; provider: string; display_name: string; status: string; connected_at: string; metadata?: Record<string, unknown>; }

const PROVIDERS = [
  { id: 'mailchimp', label: 'MailChimp', desc: 'Subscribe newsletter submissions to a Mailchimp audience list.', color: '#FFE01B' },
  { id: 'stripe',    label: 'Stripe',    desc: 'Send invoices, charge cards, process quote requests.',          color: '#635BFF' },
  { id: 'resend',    label: 'Resend',    desc: 'Send transactional emails (replies, confirmations).',           color: '#000000' },
  { id: 'hubspot',   label: 'HubSpot',   desc: 'Create/update HubSpot CRM contacts on form submit.',            color: '#FF7A59' },
];

@Component({
  selector: 'app-admin-mcp',
  standalone: true,
  imports: [FormsModule, SlicePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white m-0">MCP Connections</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          Connect external services so the AI form router + AI endpoints can call them. Tokens are encrypted at rest. OAuth uses the standard MCP authorization pattern (OAuth 2.1 + PKCE where supported).
        </p>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        @for (p of providers; track p.id) {
          <article class="card flex flex-col gap-2">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[0.9rem]"
                   [style.background]="p.color + '20'" [style.color]="p.color">{{ p.label[0] }}</div>
              <div>
                <div class="font-semibold text-white">{{ p.label }}</div>
                <div class="text-[0.7rem] text-text-secondary">{{ p.desc }}</div>
              </div>
            </div>
            @if (isConnected(p.id); as c) {
              <div class="flex items-center justify-between mt-2 text-[0.72rem]">
                <span class="text-emerald-400">● Connected · {{ c.connected_at | slice:0:10 }}</span>
                <button class="text-red-400 underline" (click)="disconnect(c)">Disconnect</button>
              </div>
            } @else if (pasteMode() === p.id) {
              <div class="mt-2 flex gap-2">
                <input type="password" class="input-field flex-1" placeholder="paste API key (e.g. re_…)" [(ngModel)]="pastedKey" />
                <button class="btn-primary" (click)="submitPaste(p.id)">Save</button>
              </div>
            } @else {
              <button class="btn-primary mt-2 self-start" (click)="connect(p.id)">Connect {{ p.label }}</button>
            }
          </article>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; font-family: ui-monospace, monospace; font-size: 0.75rem; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.5); }
    .btn-primary { padding: 0.5rem 0.95rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
  `],
})
export class AdminMcpComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  providers = PROVIDERS;
  connections = signal<Conn[]>([]);
  pasteMode = signal<string | null>(null);
  pastedKey = '';

  ngOnInit(): void { this.load(); this.handleCallback(); }
  load(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: { connections: Conn[] } }>(`/sites/${s.id}/mcp/connections`).subscribe({
      next: (r) => this.connections.set(r.data?.connections ?? []),
    });
  }
  isConnected(provider: string): Conn | null {
    return this.connections().find((c) => c.provider === provider) ?? null;
  }
  connect(provider: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    // Resend has no OAuth — show paste-key inline.
    if (provider === 'resend') { this.pasteMode.set(provider); return; }
    window.location.href = `/api/mcp/${provider}/connect?site_id=${s.id}&return_url=/admin/mcp`;
  }
  submitPaste(provider: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.post(`/api/mcp/${provider}/paste?site_id=${s.id}`, { api_key: this.pastedKey }).subscribe({
      next: () => { this.pastedKey = ''; this.pasteMode.set(null); this.toast.success(`Connected ${provider}`); this.load(); },
      error: () => this.toast.error('Failed'),
    });
  }
  disconnect(c: Conn): void {
    if (!confirm(`Disconnect ${c.provider}?`)) return;
    const s = this.state.selectedSite(); if (!s) return;
    this.api.delete(`/sites/${s.id}/mcp/connections/${c.id}`).subscribe({
      next: () => { this.toast.success('Disconnected'); this.load(); },
    });
  }
  handleCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) {
      this.toast.success(`${connected} connected`);
      history.replaceState({}, '', '/admin/mcp');
      setTimeout(() => this.load(), 200);
    }
  }
}
