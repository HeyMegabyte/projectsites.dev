import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center gap-3 mb-[18px]">
          <h3 class="text-base font-semibold text-white m-0">Billing & Plan</h3>
        </div>
        <div class="flex gap-8 mb-5">
          <div class="flex flex-col gap-1">
            <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Current Plan</span>
            <span class="text-lg font-bold text-white">{{ state.subscription()?.status === 'active' ? 'Pro' : 'Free' }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Status</span>
            <span class="text-lg font-bold text-white">{{ state.subscription()?.status || 'No subscription' }}</span>
          </div>
        </div>
        @if (state.subscription()?.status === 'active') {
          <button class="btn-ghost" (click)="state.openBilling()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            Manage Subscription
          </button>
        }
      </div>
    </div>
  `,
})
export class AdminBillingComponent {
  state = inject(AdminStateService);
}
