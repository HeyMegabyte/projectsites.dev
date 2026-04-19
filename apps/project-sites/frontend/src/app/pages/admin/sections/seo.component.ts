import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-seo',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="flex flex-col items-center justify-center text-center py-10 px-5 text-text-secondary gap-3">
        <svg class="opacity-40" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <h3 class="text-white font-semibold text-base m-0">SEO Settings</h3>
        <p class="text-[0.9rem] max-w-[400px] m-0">SEO configuration tools are coming soon. Your site already includes optimized meta tags, schema markup, and sitemap.</p>
      </div>
    </div>
  `,
})
export class AdminSeoComponent {}
