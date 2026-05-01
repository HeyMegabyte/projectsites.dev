import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Billing & Plan</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Manage your subscription on Stripe.</p>
      </div>

      <!-- Current Plan Card -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-start gap-5 max-md:flex-col">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-4">
              <h3 class="text-base font-semibold text-white m-0">Current Plan</h3>
              <span class="text-[0.62rem] font-bold py-[3px] px-2.5 rounded-md uppercase"
                    [class]="isPro ? 'bg-green-500/10 text-green-400' : 'bg-white/[0.06] text-text-secondary'">
                {{ isPro ? 'Pro' : 'Free' }}
              </span>
            </div>

            <div class="flex gap-8 mb-5 flex-wrap">
              <div class="flex flex-col gap-1">
                <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Price</span>
                <span class="text-2xl font-bold text-white">{{ isPro ? '$19' : '$0' }}<span class="text-sm font-normal text-text-secondary">/mo</span></span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Status</span>
                <span class="text-lg font-bold" [class]="isPro ? 'text-green-400' : 'text-text-secondary'">{{ state.subscription()?.status || 'No subscription' }}</span>
              </div>
              @if (isPro) {
                <div class="flex flex-col gap-1">
                  <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Plan</span>
                  <span class="text-lg font-bold text-white">{{ state.subscription()?.plan || 'Pro' }}</span>
                </div>
              }
            </div>

            <!-- Features List -->
            <div class="flex flex-col gap-2 mb-5">
              @for (feature of planFeatures; track feature.name) {
                <div class="flex items-center gap-2">
                  <svg class="flex-shrink-0" [class]="feature.included ? 'text-green-400' : 'text-text-secondary/40'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    @if (feature.included) {
                      <polyline points="20 6 9 17 4 12"/>
                    } @else {
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    }
                  </svg>
                  <span class="text-[0.78rem]" [class]="feature.included ? 'text-white' : 'text-text-secondary/50'">{{ feature.name }}</span>
                </div>
              }
            </div>

            <!-- Action -->
            @if (isPro) {
              <button class="btn-ghost cursor-pointer" (click)="state.openBilling()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Manage on Stripe
              </button>
            } @else {
              <button class="btn-accent cursor-pointer" (click)="upgrade()" [disabled]="loading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                {{ loading ? 'Opening Stripe…' : 'Upgrade to Pro' }}
              </button>
            }
          </div>
        </div>
      </div>

    </div>
  `,
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
