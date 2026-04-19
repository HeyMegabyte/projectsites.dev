import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="flex flex-col items-center justify-center text-center py-10 px-5 text-text-secondary gap-3">
        <svg class="opacity-40" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
        <h3 class="text-white font-semibold text-base m-0">Analytics</h3>
        <p class="text-[0.9rem] max-w-[400px] m-0">Traffic analytics are coming soon. Your site is being tracked automatically.</p>
      </div>
    </div>
  `,
})
export class AdminAnalyticsComponent {}
