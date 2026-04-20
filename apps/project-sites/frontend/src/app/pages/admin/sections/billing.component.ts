import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Billing & Plan</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Manage your subscription and view payment history.</p>
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
              @for (feature of planFeatures; track feature) {
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
              <button class="btn-ghost" (click)="state.openBilling()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Manage Subscription
              </button>
            } @else {
              <button class="btn-accent" (click)="state.openCheckout()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                Upgrade to Pro
              </button>
            }
          </div>
        </div>
      </div>

      <!-- Usage Stats -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4">Usage</h3>
        <div class="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          @for (usage of usageStats; track usage.label) {
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-[0.72rem] text-text-secondary font-semibold">{{ usage.label }}</span>
                <span class="text-[0.72rem] text-white font-mono">{{ usage.used }}/{{ usage.limit }}</span>
              </div>
              <div class="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500" [style.width.%]="usage.percent"
                     [style.background]="usage.percent > 80 ? '#ef4444' : usage.percent > 60 ? '#f59e0b' : '#00E5FF'"></div>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Payment History -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4">Payment History</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[0.8rem]">
            <thead>
              <tr class="border-b border-white/[0.06]">
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Date</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Description</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Amount</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              @if (isPro) {
                @for (payment of paymentHistory; track payment.date) {
                  <tr class="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01]">
                    <td class="py-2.5 px-3 text-white/80">{{ payment.date }}</td>
                    <td class="py-2.5 px-3 text-text-secondary">{{ payment.description }}</td>
                    <td class="py-2.5 px-3 text-white font-mono">{{ payment.amount }}</td>
                    <td class="py-2.5 px-3">
                      <span class="text-[0.65rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">{{ payment.status }}</span>
                    </td>
                  </tr>
                }
              } @else {
                <tr><td colspan="4" class="py-8 text-center text-text-secondary text-[0.82rem]">No payment history. Upgrade to Pro to get started.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `,
})
export class AdminBillingComponent {
  state = inject(AdminStateService);

  get isPro(): boolean {
    return this.state.subscription()?.status === 'active';
  }

  get planFeatures() {
    return [
      { name: 'AI-generated website', included: true },
      { name: 'Free subdomain (slug.projectsites.dev)', included: true },
      { name: 'SSL certificate', included: true },
      { name: 'Contact form', included: true },
      { name: 'Custom domain', included: this.isPro },
      { name: 'Remove ProjectSites branding', included: this.isPro },
      { name: 'Priority AI rebuilds', included: this.isPro },
      { name: 'Advanced analytics', included: this.isPro },
      { name: 'Email support', included: this.isPro },
    ];
  }

  usageStats = [
    { label: 'Sites', used: 1, limit: this.isPro ? 10 : 1, percent: this.isPro ? 10 : 100 },
    { label: 'Rebuilds (this month)', used: 3, limit: this.isPro ? 50 : 5, percent: this.isPro ? 6 : 60 },
    { label: 'Storage', used: '12 MB', limit: this.isPro ? '1 GB' : '100 MB', percent: this.isPro ? 1 : 12 },
  ];

  paymentHistory = [
    { date: 'Apr 1, 2026', description: 'Pro Plan - Monthly', amount: '$19.00', status: 'Paid' },
    { date: 'Mar 1, 2026', description: 'Pro Plan - Monthly', amount: '$19.00', status: 'Paid' },
    { date: 'Feb 1, 2026', description: 'Pro Plan - Monthly', amount: '$19.00', status: 'Paid' },
  ];
}
