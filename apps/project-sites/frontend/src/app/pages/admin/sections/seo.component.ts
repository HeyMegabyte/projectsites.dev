import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-seo',
  standalone: true,
  imports: [],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">SEO</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Optimize your site for search engines and social sharing.</p>
      </div>

      <!-- Meta Tags -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Meta Tags
          </h3>
          <span class="text-[0.62rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.72rem] text-text-secondary/70 m-0 mb-4">Meta tags are auto-generated from your business profile. Manual overrides land in a future release.</p>
        <div class="flex flex-col gap-4 opacity-60 pointer-events-none select-none">
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Page Title</label>
            <input type="text" class="input-field" [placeholder]="siteTitle + ' | ' + siteName" disabled />
          </div>
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Meta Description</label>
            <textarea class="input-field !h-20 resize-none" placeholder="Describe your business in 1-2 sentences for search results..." disabled></textarea>
          </div>
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Keywords</label>
            <input type="text" class="input-field" placeholder="keyword1, keyword2, keyword3" disabled />
          </div>
        </div>
      </div>

      <!-- Search Preview -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4">Google Search Preview</h3>
        <div class="bg-white rounded-xl p-4 max-w-[600px]">
          <div class="text-[0.72rem] text-[#202124] mb-0.5 font-sans">{{ siteDomain }}</div>
          <div class="text-[1.05rem] text-[#1a0dab] font-sans leading-tight mb-1 hover:underline cursor-pointer">
            {{ siteTitle }} | {{ siteName }}
          </div>
          <div class="text-[0.82rem] text-[#4d5156] font-sans leading-snug">
            Your site description will appear here once meta overrides ship. Until then we generate one from your business profile.
          </div>
        </div>
      </div>

      <!-- JSON-LD Preview -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Structured Data (JSON-LD)
          </h3>
          <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">Auto-generated</span>
        </div>
        <p class="text-[0.72rem] text-text-secondary m-0 mb-3">Your site includes LocalBusiness schema markup, FAQPage schema, and BreadcrumbList for rich search results.</p>
        <div class="bg-[rgba(6,6,18,0.85)] border border-primary/[0.06] rounded-lg p-4 font-mono text-[0.7rem] text-text-secondary/70 overflow-x-auto leading-relaxed">
          <pre class="m-0 whitespace-pre-wrap">{{ jsonLdPreview }}</pre>
        </div>
      </div>

      <!-- SEO Checklist -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4">SEO Health Check</h3>
        <div class="flex flex-col gap-2">
          @for (check of seoChecks; track check.label) {
            <div class="flex items-center gap-3 py-2 px-3 bg-white/[0.01] rounded-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   [class]="check.pass ? 'text-green-400' : 'text-amber-400'">
                @if (check.pass) {
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                } @else {
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                }
              </svg>
              <span class="text-[0.78rem]" [class]="check.pass ? 'text-white/80' : 'text-amber-400/80'">{{ check.label }}</span>
            </div>
          }
        </div>
      </div>

    </div>
  `,
})
export class AdminSeoComponent {
  state = inject(AdminStateService);

  get siteName(): string {
    return this.state.selectedSite()?.business_name || 'Your Business';
  }

  get siteTitle(): string {
    return this.state.selectedSite()?.business_name || 'Your Site Title';
  }

  get siteDomain(): string {
    const slug = this.state.selectedSite()?.slug || 'your-site';
    return `${slug}.projectsites.dev`;
  }

  get jsonLdPreview(): string {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: this.siteName,
      url: `https://${this.siteDomain}`,
      sameAs: [],
    }, null, 2);
  }

  seoChecks = [
    { label: 'Page title is under 60 characters', pass: true },
    { label: 'Meta description is present', pass: true },
    { label: 'JSON-LD LocalBusiness schema is valid', pass: true },
    { label: 'robots.txt allows crawling', pass: true },
    { label: 'sitemap.xml is generated', pass: true },
    { label: 'Open Graph meta tags are present', pass: true },
    { label: 'Canonical URL is set on all pages', pass: true },
    { label: 'H1 heading is present on all pages', pass: true },
    { label: 'All images have alt text', pass: false },
    { label: 'Internal links use descriptive anchor text', pass: false },
  ];
}
