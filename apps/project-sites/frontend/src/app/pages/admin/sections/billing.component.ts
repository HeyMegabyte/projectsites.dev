import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [],
  template: `
    <div class="billing-shell p-7 flex-1 overflow-y-auto max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="billing-header flex items-center gap-3">
        <div class="header-glyph" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2.5"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
            <line x1="6" y1="15" x2="10" y2="15"/>
          </svg>
        </div>
        <div class="flex-1">
          <h2 class="text-lg font-bold text-white m-0 tracking-tight">Billing &amp; Plan</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Manage your subscription on Stripe.</p>
        </div>
        <span class="plan-pill" [class.plan-pill-pro]="isPro" [class.plan-pill-free]="!isPro">
          {{ isPro ? 'Pro' : 'Free' }}
        </span>
      </div>

      <!-- Current Plan Card -->
      <div class="billing-card">
        <div class="flex items-start gap-5 max-md:flex-col">
          <div class="flex-1 w-full">
            <div class="flex items-center gap-3 mb-5">
              <h3 class="text-base font-semibold text-white m-0">Current Plan</h3>
              <span class="status-dot" [class.status-active]="isPro" [class.status-inactive]="!isPro" aria-hidden="true"></span>
            </div>

            <!-- Stats grid -->
            <div class="stats-grid grid grid-cols-3 max-md:grid-cols-1 gap-4 mb-6">
              <div class="stat-tile" [style.animation-delay.ms]="0">
                <span class="stat-label">Price</span>
                <span class="stat-value">
                  {{ isPro ? '$19' : '$0' }}<span class="stat-suffix">/mo</span>
                </span>
              </div>
              <div class="stat-tile" [style.animation-delay.ms]="80">
                <span class="stat-label">Status</span>
                <span class="stat-value" [class.status-text-active]="isPro" [class.status-text-inactive]="!isPro">
                  {{ state.subscription()?.status || 'No subscription' }}
                </span>
              </div>
              <div class="stat-tile" [style.animation-delay.ms]="160">
                <span class="stat-label">Plan</span>
                <span class="stat-value">{{ isPro ? (state.subscription()?.plan || 'Pro') : 'Free tier' }}</span>
              </div>
            </div>

            <!-- Features List -->
            <div class="features-list flex flex-col gap-2 mb-6">
              @for (feature of planFeatures; track feature.name; let i = $index) {
                <div class="feature-row"
                     [class.feature-included]="feature.included"
                     [class.feature-locked]="!feature.included"
                     [style.animation-delay.ms]="i * 36">
                  <span class="feature-icon" aria-hidden="true">
                    @if (feature.included) {
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    } @else {
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    }
                  </span>
                  <span class="feature-text">{{ feature.name }}</span>
                </div>
              }
            </div>

            <!-- Action -->
            <div class="flex gap-3 flex-wrap">
              @if (isPro) {
                <button type="button" class="btn-manage" (click)="state.openBilling()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  Manage on Stripe
                </button>
              } @else {
                <button type="button" class="btn-upgrade" (click)="upgrade()" [disabled]="loading">
                  <span class="btn-glow" aria-hidden="true"></span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  <span>{{ loading ? 'Opening Stripe…' : 'Upgrade to Pro' }}</span>
                </button>
              }
            </div>
          </div>
        </div>
      </div>

    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ring-cyan: 0 0 0 2px #000, 0 0 0 4px rgba(0, 229, 255, 0.55);
      display: block;
    }

    .billing-shell { animation: fadeIn 320ms var(--ease-cinematic); }

    /* ===== Header ===== */
    .billing-header { animation: fadeUp 480ms var(--ease-cinematic) both; }
    .header-glyph {
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.12), rgba(124, 58, 237, 0.08));
      border: 1px solid rgba(0, 229, 255, 0.18);
      color: rgba(0, 229, 255, 0.9);
      transition: transform 480ms var(--ease-elastic), box-shadow 320ms var(--ease-cinematic), border-color 220ms var(--ease-cinematic);
      box-shadow: 0 6px 20px -10px rgba(0, 229, 255, 0.4);
    }
    .billing-header:hover .header-glyph {
      transform: rotate(-6deg) scale(1.08);
      border-color: rgba(0, 229, 255, 0.45);
      box-shadow: 0 10px 28px -10px rgba(0, 229, 255, 0.6);
    }

    /* ===== Plan pill ===== */
    .plan-pill {
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em;
      padding: 5px 12px; border-radius: 999px; text-transform: uppercase;
      border: 1px solid transparent;
      transition: transform 220ms var(--ease-cinematic), box-shadow 220ms var(--ease-cinematic);
    }
    .plan-pill-pro {
      color: #4ade80; background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.35);
      box-shadow: 0 0 14px -2px rgba(34, 197, 94, 0.35);
    }
    .plan-pill-free {
      color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.10);
    }

    /* ===== Card ===== */
    .billing-card {
      position: relative;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      padding: 1.75rem;
      overflow: hidden;
      animation: fadeUp 600ms var(--ease-cinematic) 80ms both;
      transition: transform 320ms var(--ease-cinematic), border-color 220ms var(--ease-cinematic), box-shadow 320ms var(--ease-cinematic);
    }
    .billing-card::before {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse at top right, rgba(0,229,255,0.05) 0%, transparent 60%);
      opacity: 0; transition: opacity 320ms var(--ease-cinematic);
    }
    .billing-card:hover {
      border-color: rgba(0, 229, 255, 0.16);
      transform: translateY(-2px);
      box-shadow: 0 20px 60px -30px rgba(0, 229, 255, 0.4);
    }
    .billing-card:hover::before { opacity: 1; }

    /* ===== Status dot ===== */
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      flex-shrink: 0;
    }
    .status-active {
      background: #4ade80;
      box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.18);
      animation: livePulse 2s var(--ease-cinematic) infinite;
    }
    .status-inactive { background: rgba(255,255,255,0.25); }

    /* ===== Stats grid ===== */
    .stat-tile {
      display: flex; flex-direction: column; gap: 0.35rem;
      padding: 0.9rem 1rem;
      background: rgba(0, 0, 0, 0.20);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      position: relative;
      animation: fadeUp 520ms var(--ease-cinematic) both;
      transition: border-color 220ms var(--ease-cinematic), background 220ms var(--ease-cinematic), transform 220ms var(--ease-cinematic);
    }
    .stat-tile::after {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0;
      width: 2px;
      background: linear-gradient(180deg, #00E5FF, #7C3AED);
      transform: scaleY(0); transform-origin: top;
      transition: transform 320ms var(--ease-cinematic);
      border-radius: 2px;
    }
    .stat-tile:hover {
      border-color: rgba(0,229,255,0.18);
      background: rgba(0,229,255,0.04);
      transform: translateY(-1px);
    }
    .stat-tile:hover::after { transform: scaleY(1); }
    .stat-label {
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase;
      color: rgba(255,255,255,0.50);
    }
    .stat-value {
      font-size: 1.35rem; font-weight: 700; color: #fff; line-height: 1.1;
    }
    .stat-suffix { font-size: 0.8rem; font-weight: 400; color: rgba(255,255,255,0.50); margin-left: 2px; }
    .status-text-active { color: #4ade80; }
    .status-text-inactive { color: rgba(255,255,255,0.50); }

    /* ===== Features ===== */
    .feature-row {
      display: flex; align-items: center; gap: 0.55rem;
      padding: 6px 8px;
      border-radius: 8px;
      transition: background 200ms var(--ease-cinematic), transform 200ms var(--ease-cinematic);
      animation: slideIn 420ms var(--ease-cinematic) both;
    }
    .feature-row:hover {
      background: rgba(255,255,255,0.025);
      transform: translateX(2px);
    }
    .feature-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      flex-shrink: 0;
      transition: transform 280ms var(--ease-elastic);
    }
    .feature-row:hover .feature-icon { transform: scale(1.18) rotate(-4deg); }
    .feature-included { color: #4ade80; }
    .feature-included .feature-text { color: #fff; }
    .feature-locked { color: rgba(255,255,255,0.30); }
    .feature-locked .feature-text { color: rgba(255,255,255,0.45); }
    .feature-text { font-size: 0.82rem; }

    /* ===== Buttons ===== */
    .btn-upgrade, .btn-manage {
      position: relative;
      display: inline-flex; align-items: center; gap: 0.5rem;
      padding: 0.65rem 1.15rem;
      font-size: 0.82rem; font-weight: 600;
      border-radius: 10px;
      cursor: pointer; overflow: hidden;
      transition: transform 200ms var(--ease-cinematic), border-color 200ms var(--ease-cinematic), box-shadow 240ms var(--ease-cinematic), background 200ms var(--ease-cinematic);
    }
    .btn-upgrade {
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.18), rgba(124, 58, 237, 0.18));
      border: 1px solid rgba(0, 229, 255, 0.45);
      color: #00E5FF;
      box-shadow: 0 6px 18px -8px rgba(0, 229, 255, 0.45);
    }
    .btn-upgrade .btn-glow {
      position: absolute; inset: 0;
      background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%);
      transform: translateX(-100%);
      transition: transform 700ms var(--ease-cinematic);
      pointer-events: none;
    }
    .btn-upgrade:hover:not(:disabled) {
      transform: translateY(-2px);
      border-color: rgba(0, 229, 255, 0.7);
      box-shadow: 0 12px 28px -10px rgba(0, 229, 255, 0.65);
      background: linear-gradient(135deg, rgba(0,229,255,0.25), rgba(124,58,237,0.25));
    }
    .btn-upgrade:hover:not(:disabled) .btn-glow { transform: translateX(100%); }
    .btn-upgrade:hover:not(:disabled) svg { transform: scale(1.12) rotate(-6deg); }
    .btn-upgrade svg { transition: transform 240ms var(--ease-elastic); }
    .btn-upgrade:active:not(:disabled) { transform: translateY(0) scale(0.96); }
    .btn-upgrade:focus-visible { outline: none; box-shadow: var(--ring-cyan), 0 12px 28px -10px rgba(0, 229, 255, 0.65); }
    .btn-upgrade:disabled { opacity: 0.6; cursor: not-allowed; }

    .btn-manage {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.85);
    }
    .btn-manage:hover {
      transform: translateY(-2px);
      border-color: rgba(0, 229, 255, 0.35);
      color: #00E5FF;
      background: rgba(0, 229, 255, 0.05);
      box-shadow: 0 10px 22px -10px rgba(0, 229, 255, 0.35);
    }
    .btn-manage:hover svg { transform: scale(1.10) rotate(-4deg); }
    .btn-manage svg { transition: transform 240ms var(--ease-elastic); }
    .btn-manage:active { transform: translateY(0) scale(0.96); }
    .btn-manage:focus-visible { outline: none; box-shadow: var(--ring-cyan); }

    /* ===== Keyframes ===== */
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-4px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes livePulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.18); }
      50% { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0.08); }
    }

    @media (prefers-reduced-motion: reduce) {
      .billing-shell, .billing-header, .billing-card, .stat-tile, .feature-row { animation: none; }
      .header-glyph, .stat-tile, .feature-row, .feature-icon, .btn-upgrade, .btn-manage, .btn-upgrade svg, .btn-manage svg, .billing-card { transition: none; transform: none !important; }
      .status-active { animation: none; }
      .btn-upgrade .btn-glow { display: none; }
    }
  `],
})
export class AdminBillingComponent {
  state = inject(AdminStateService);
  loading = false;

  get isPro(): boolean {
    return this.state.subscription()?.status === 'active';
  }

  get planFeatures() {
    return [
      { name: 'AI-generated website', included: true },
      { name: 'Free subdomain (slug.projectsites.dev)', included: true },
      { name: 'SSL certificate', included: true },
      { name: 'Contact form', included: true },
      { name: 'Unlimited AI rebuilds', included: this.isPro },
      { name: 'Custom domain', included: this.isPro },
      { name: 'Remove ProjectSites branding', included: this.isPro },
      { name: 'Advanced analytics', included: this.isPro },
      { name: 'Email support', included: this.isPro },
    ];
  }

  upgrade(): void {
    this.loading = true;
    this.state.openCheckout();
    setTimeout(() => (this.loading = false), 4000);
  }
}
