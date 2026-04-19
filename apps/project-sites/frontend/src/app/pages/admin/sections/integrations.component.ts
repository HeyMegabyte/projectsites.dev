import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Google Analytics -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
          Google Analytics
        </h3>
        <div class="mb-3">
          <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">GA4 Measurement ID</label>
          <div class="flex gap-2.5 items-center">
            <input type="text" class="input-field flex-1" placeholder="G-XXXXXXXXXX" disabled />
            <button class="btn-ghost-sm" disabled>Save</button>
          </div>
        </div>
        <p class="text-[0.72rem] text-text-secondary m-0">Add your GA4 measurement ID to enable Google Analytics tracking on your site.</p>
      </div>

      <!-- Stripe -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-3 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          Stripe
        </h3>
        <div class="flex items-center gap-3 p-3 bg-primary/[0.03] rounded-[10px] border border-white/[0.06]">
          <div class="w-8 h-8 rounded-lg bg-[#635BFF]/10 flex items-center justify-center text-[#635BFF] flex-shrink-0 font-bold text-sm">S</div>
          <div class="flex-1 min-w-0">
            <span class="text-[0.8rem] text-white font-medium">Payment processing</span>
            <p class="text-[0.72rem] text-text-secondary m-0">Accept payments and donations through Stripe.</p>
          </div>
          <span class="text-[0.65rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">Active</span>
        </div>
      </div>

      <!-- Listmonk -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Listmonk
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0">Self-hosted newsletter and mailing list manager at listmonk.megabyte.space.</p>
      </div>

      <!-- Webhooks -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"/></svg>
            Webhooks
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0">Configure webhook endpoints to receive real-time notifications when events happen on your site.</p>
      </div>

      <!-- API Keys -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            API Keys
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0">Generate API keys for programmatic access to your site's data and configuration.</p>
      </div>

    </div>
  `,
})
export class AdminIntegrationsComponent {}
