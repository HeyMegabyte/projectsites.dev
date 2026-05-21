import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Bundle { credits: number; usd: number; price_id: string; }
interface CreditState { balance: number; bundles: Record<string, Bundle>; ledger: { delta: number; reason: string; stripe_session_id: string | null; created_at: string }[]; }
interface Alert { id: string; name: string; threshold_credits: number; alert_kind: string; notify_email: string; enabled: number; last_triggered_at: string | null; }
interface CostRow { site_id: string; slug: string; business_name: string | null; ai_calls: number; ai_credits: number; estimated_cost_micro_usd: number; bandwidth_bytes: number; storage_bytes: number; }

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [FormsModule, DatePipe, CurrencyPipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white m-0">Billing &amp; Plan</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          AI Credits power form routing, chat, and your custom AI endpoints. Per-site cost breakdown + spend alerts below.
        </p>
      </div>

      <section class="card border border-primary/30">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">AI Credits</h3>
          <span class="text-[0.7rem] text-text-secondary">1 credit ≈ 1 AI call</span>
        </div>
        <div class="text-4xl font-bold text-white mb-1">{{ credits()?.balance ?? 0 }}</div>
        <div class="text-[0.78rem] text-text-secondary mb-4">credits remaining</div>

        <div class="grid sm:grid-cols-3 gap-3">
          @for (key of bundleKeys; track key) {
            <button class="card-light text-left p-4 cursor-pointer hover:border-primary/50 transition-colors block w-full" (click)="topup(key)" [disabled]="buying() === key">
              <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary/70 font-bold">{{ key }}</div>
              <div class="text-2xl font-bold text-white mt-1">{{ credits()?.bundles?.[key]?.credits }}</div>
              <div class="text-[0.78rem] text-text-secondary">credits · &dollar;{{ credits()?.bundles?.[key]?.usd }}</div>
              <div class="text-[0.66rem] text-primary mt-2">{{ buying() === key ? 'Opening checkout…' : 'Buy →' }}</div>
            </button>
          }
        </div>

        @if (credits()?.ledger?.length) {
          <details class="mt-4">
            <summary class="cursor-pointer text-[0.74rem] text-text-secondary">Recent activity</summary>
            <ul class="mt-2 space-y-1 text-[0.7rem] list-none p-0">
              @for (l of credits()!.ledger.slice(0, 20); track l.created_at) {
                <li class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-text-secondary">{{ l.created_at | date:'short' }} · {{ l.reason }}</span>
                  <span [class.text-emerald-400]="l.delta > 0" [class.text-red-400]="l.delta < 0">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
                </li>
              }
            </ul>
          </details>
        }
      </section>

      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Per-site cost breakdown</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Rolling 30-day window. AI credits convert to estimated USD at $0.04/credit.</p>
        @if (siteCosts().length === 0) {
          <div class="p-6 text-center text-text-secondary text-sm">No usage in the last 30 days.</div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-2">Site</th>
                <th class="text-right p-2">AI calls</th>
                <th class="text-right p-2">Credits</th>
                <th class="text-right p-2">Bandwidth</th>
                <th class="text-right p-2">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              @for (r of siteCosts(); track r.site_id) {
                <tr class="border-b border-white/[0.04]">
                  <td class="p-2">
                    <div class="font-semibold text-white">{{ r.business_name || r.slug }}</div>
                    <div class="text-text-secondary text-[0.66rem] font-mono">{{ r.slug }}</div>
                  </td>
                  <td class="p-2 text-right">{{ r.ai_calls }}</td>
                  <td class="p-2 text-right">{{ r.ai_credits }}</td>
                  <td class="p-2 text-right text-text-secondary">{{ bytes(r.bandwidth_bytes) }}</td>
                  <td class="p-2 text-right font-mono">{{ (r.estimated_cost_micro_usd / 1000000) | currency:'USD' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">Spend alerts</h3>
          <button class="btn-primary" (click)="newAlert()">+ New alert</button>
        </div>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Get emailed when your balance drops below a threshold or daily burn spikes.</p>

        @if (creating()) {
          <div class="card-light p-3 mb-3">
            <div class="grid md:grid-cols-4 gap-2">
              <input class="input-field" placeholder="Alert name" [(ngModel)]="draft.name" />
              <select class="input-field" [(ngModel)]="draft.alert_kind">
                <option value="balance_low">Balance dropped below</option>
                <option value="daily_burn">Daily burn exceeded</option>
              </select>
              <input type="number" class="input-field" placeholder="threshold (credits)" [(ngModel)]="draft.threshold_credits" />
              <input type="email" class="input-field" placeholder="notify email" [(ngModel)]="draft.notify_email" />
            </div>
            <div class="flex justify-end gap-2 mt-2">
              <button class="btn-ghost" (click)="creating.set(false)">Cancel</button>
              <button class="btn-primary" (click)="saveAlert()">Create</button>
            </div>
          </div>
        }

        @if (alerts().length === 0 && !creating()) {
          <div class="p-6 text-center text-text-secondary text-sm">No alerts yet.</div>
        } @else {
          @for (a of alerts(); track a.id) {
            <div class="flex items-center justify-between py-2 border-b border-white/[0.04] text-[0.78rem]">
              <div>
                <div class="font-semibold text-white">{{ a.name }}</div>
                <div class="text-text-secondary text-[0.7rem]">{{ a.alert_kind === 'balance_low' ? 'When balance <' : 'When daily burn >' }} {{ a.threshold_credits }} credits → {{ a.notify_email }}</div>
              </div>
              <button class="text-red-400 text-[0.72rem]" (click)="removeAlert(a)">Remove</button>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .btn-primary { padding: 0.45rem 0.95rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
  `],
})
export class AdminBillingComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  credits = signal<CreditState | null>(null);
  alerts = signal<Alert[]>([]);
  siteCosts = signal<CostRow[]>([]);
  buying = signal<string | null>(null);
  creating = signal(false);
  draft: { name: string; alert_kind: string; threshold_credits: number; notify_email: string } = {
    name: '', alert_kind: 'balance_low', threshold_credits: 50, notify_email: '',
  };
  get bundleKeys(): string[] { return Object.keys(this.credits()?.bundles ?? {}); }

  ngOnInit(): void { this.loadAll(); }
  loadAll(): void {
    this.api.get<{ data: CreditState }>('/billing/credits').subscribe({ next: (r) => this.credits.set(r.data) });
    this.api.get<{ data: Alert[] }>('/billing/spend-alerts').subscribe({ next: (r) => this.alerts.set(r.data ?? []) });
    this.api.get<{ data: { rows: CostRow[] } }>('/billing/site-costs').subscribe({ next: (r) => this.siteCosts.set(r.data?.rows ?? []) });
  }
  topup(bundle: string): void {
    this.buying.set(bundle);
    this.api.post<{ data: { mode: string; url?: string; balance?: number } }>('/billing/credits/topup', { bundle }).subscribe({
      next: (r) => {
        this.buying.set(null);
        if (r.data?.mode === 'stripe' && r.data.url) window.location.href = r.data.url;
        else { this.toast.success(`Credits added — balance ${r.data?.balance}`); this.loadAll(); }
      },
      error: () => { this.buying.set(null); this.toast.error('Top-up failed'); },
    });
  }
  newAlert(): void { this.creating.set(true); }
  saveAlert(): void {
    this.api.post('/billing/spend-alerts', this.draft).subscribe({
      next: () => { this.toast.success('Alert created'); this.creating.set(false); this.draft = { name: '', alert_kind: 'balance_low', threshold_credits: 50, notify_email: '' }; this.loadAll(); },
      error: () => this.toast.error('Failed'),
    });
  }
  removeAlert(a: Alert): void {
    this.api.delete(`/billing/spend-alerts/${a.id}`).subscribe({ next: () => { this.toast.success('Removed'); this.loadAll(); } });
  }
  bytes(n: number): string { if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`; if (n < Math.pow(1024, 3)) return `${(n/Math.pow(1024,2)).toFixed(1)} MB`; return `${(n/Math.pow(1024,3)).toFixed(2)} GB`; }
}
