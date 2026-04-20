import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Integrations</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Connect third-party services to extend your site.</p>
      </div>

      <!-- Integration Cards Grid -->
      <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">

        <!-- Google Analytics -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-[#E37400]/10 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E37400" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">Google Analytics</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Track traffic, conversions, and user behavior.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-amber-500/10 text-amber-400">Not configured</span>
          </div>
          <div class="flex gap-2 items-center">
            <input type="text" class="input-field flex-1" placeholder="G-XXXXXXXXXX" [(ngModel)]="gaId" />
            <button class="btn-accent-sm" [disabled]="!gaId.trim()">Save</button>
          </div>
          <p class="text-[0.68rem] text-text-secondary/60 m-0">Enter your GA4 measurement ID to enable tracking on your site.</p>
        </div>

        <!-- Stripe -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-[#635BFF]/10 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#635BFF" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">Stripe</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Accept payments and process donations.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">Active</span>
          </div>
          <div class="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
            <div class="flex items-center justify-between">
              <span class="text-[0.72rem] text-text-secondary">Payment processing is enabled for your site.</span>
            </div>
          </div>
        </div>

        <!-- PostHog -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-[#F9BD2B]/10 flex items-center justify-center flex-shrink-0 text-[#F9BD2B] font-bold text-sm">PH</div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">PostHog</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Product analytics, session recordings, and funnels.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">Active</span>
          </div>
          <div class="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
            <span class="text-[0.72rem] text-text-secondary">Server-side event capture is active. Events are tracked for funnels and analytics.</span>
          </div>
        </div>

        <!-- Sentry -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-[#362D59]/30 flex items-center justify-center flex-shrink-0 text-[#B6A8D8] font-bold text-sm">S</div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">Sentry</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Error tracking and performance monitoring.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">Active</span>
          </div>
          <div class="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
            <span class="text-[0.72rem] text-text-secondary">Error tracking is enabled. Exceptions are captured automatically via Toucan SDK.</span>
          </div>
        </div>

        <!-- Listmonk -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center flex-shrink-0 text-primary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">Listmonk</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Self-hosted newsletter and mailing lists.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
          </div>
          <div class="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
            <span class="text-[0.72rem] text-text-secondary">Connect to listmonk.megabyte.space for newsletter management.</span>
          </div>
        </div>

        <!-- Webhooks -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-5 flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0 text-violet-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-[0.85rem] text-white font-semibold">Webhooks</span>
              <p class="text-[0.68rem] text-text-secondary m-0">Real-time event notifications to external services.</p>
            </div>
            <span class="text-[0.62rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
          </div>
          @if (webhookEndpoints.length > 0) {
            <div class="flex flex-col gap-1.5">
              @for (endpoint of webhookEndpoints; track endpoint.url) {
                <div class="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg border border-white/[0.04]">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></span>
                  <span class="text-[0.72rem] text-text-secondary font-mono truncate flex-1">{{ endpoint.url }}</span>
                  <button class="icon-btn-sm-danger p-1" title="Remove">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              }
            </div>
          }
          <button class="btn-ghost-sm self-start" disabled>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Webhook Endpoint
          </button>
        </div>

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
        <p class="text-[0.78rem] text-text-secondary m-0">Generate API keys for programmatic access to your site data and configuration.</p>
      </div>

    </div>
  `,
})
export class AdminIntegrationsComponent {
  gaId = '';
  webhookEndpoints: Array<{url: string}> = [];
}
