import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-social',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Social</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Manage social media links and sharing settings.</p>
      </div>

      <!-- Social Links -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-5 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Social Links
        </h3>
        <div class="flex flex-col gap-3">
          @for (link of socialLinks; track link.name) {
            <div class="flex gap-2.5 items-center">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" [style.background]="link.bgColor">
                <span class="text-[0.72rem] font-bold" [style.color]="link.iconColor">{{ link.abbr }}</span>
              </div>
              <label class="text-[0.78rem] font-semibold text-text-secondary w-24 flex-shrink-0">{{ link.name }}</label>
              <input type="url" class="input-field flex-1" [placeholder]="link.placeholder" [(ngModel)]="link.value" />
            </div>
          }
        </div>
        <div class="flex items-center gap-3 mt-5">
          <button class="btn-accent" [disabled]="saving()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            {{ saving() ? 'Saving...' : 'Save Links' }}
          </button>
          @if (saved()) {
            <span class="text-[0.72rem] text-green-400 flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Saved
            </span>
          }
        </div>
      </div>

      <!-- OG Image Preview -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Social Share Preview
        </h3>
        <p class="text-[0.72rem] text-text-secondary m-0 mb-4">This is how your site appears when shared on social media platforms.</p>

        <!-- Twitter/X Preview -->
        <div class="mb-4">
          <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold mb-2 block">Twitter / X</span>
          <div class="rounded-xl border border-white/[0.08] overflow-hidden max-w-[480px]">
            <div class="bg-white/[0.03] h-[180px] flex items-center justify-center text-text-secondary text-[0.82rem] relative overflow-hidden">
              <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-violet-500/5"></div>
              <div class="flex flex-col items-center gap-2 relative z-10">
                <svg class="opacity-30" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span class="text-[0.75rem]">OG image preview</span>
              </div>
            </div>
            <div class="p-3 bg-white/[0.02]">
              <div class="text-[0.68rem] text-text-secondary mb-0.5">{{ siteDomain }}</div>
              <div class="text-[0.82rem] text-white font-medium">{{ siteTitle }}</div>
              <div class="text-[0.72rem] text-text-secondary mt-0.5 line-clamp-2">{{ siteDescription }}</div>
            </div>
          </div>
        </div>

        <!-- Facebook Preview -->
        <div>
          <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold mb-2 block">Facebook</span>
          <div class="rounded-xl border border-white/[0.08] overflow-hidden max-w-[480px]">
            <div class="bg-white/[0.03] h-[250px] flex items-center justify-center text-text-secondary relative overflow-hidden">
              <div class="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-primary/5"></div>
              <div class="flex flex-col items-center gap-2 relative z-10">
                <svg class="opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span class="text-[0.75rem]">OG image preview</span>
              </div>
            </div>
            <div class="p-3 bg-white/[0.02] border-t border-white/[0.04]">
              <div class="text-[0.62rem] text-text-secondary uppercase tracking-wide">{{ siteDomain }}</div>
              <div class="text-[0.85rem] text-white font-semibold mt-0.5">{{ siteTitle }}</div>
              <div class="text-[0.72rem] text-text-secondary mt-0.5 line-clamp-1">{{ siteDescription }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Auto-posting -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Auto-posting
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0 mb-4">Automatically post to your social media accounts when your site is updated or a new blog post is published.</p>
        <div class="flex flex-col gap-2">
          @for (platform of autoPostPlatforms; track platform.name) {
            <div class="flex items-center justify-between py-2.5 px-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
              <div class="flex items-center gap-2.5">
                <span class="text-[0.72rem] font-bold w-6 text-center" [style.color]="platform.color">{{ platform.abbr }}</span>
                <span class="text-[0.78rem] text-white/80">{{ platform.name }}</span>
              </div>
              <div class="w-9 h-5 rounded-full bg-white/[0.06] relative cursor-not-allowed opacity-50">
                <div class="w-3.5 h-3.5 rounded-full bg-text-secondary/40 absolute top-[3px] left-[3px] transition-all"></div>
              </div>
            </div>
          }
        </div>
      </div>

    </div>
  `,
})
export class AdminSocialComponent {
  state = inject(AdminStateService);
  saving = signal(false);
  saved = signal(false);

  socialLinks = [
    { name: 'Facebook', placeholder: 'https://facebook.com/yourbusiness', value: '', abbr: 'f', bgColor: 'rgba(24, 119, 242, 0.1)', iconColor: '#1877F2' },
    { name: 'Twitter / X', placeholder: 'https://x.com/yourbusiness', value: '', abbr: 'X', bgColor: 'rgba(255, 255, 255, 0.06)', iconColor: '#fff' },
    { name: 'Instagram', placeholder: 'https://instagram.com/yourbusiness', value: '', abbr: 'ig', bgColor: 'rgba(225, 48, 108, 0.1)', iconColor: '#E1306C' },
    { name: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourbusiness', value: '', abbr: 'in', bgColor: 'rgba(0, 119, 181, 0.1)', iconColor: '#0077B5' },
    { name: 'YouTube', placeholder: 'https://youtube.com/@yourbusiness', value: '', abbr: 'YT', bgColor: 'rgba(255, 0, 0, 0.1)', iconColor: '#FF0000' },
    { name: 'TikTok', placeholder: 'https://tiktok.com/@yourbusiness', value: '', abbr: 'TT', bgColor: 'rgba(255, 255, 255, 0.06)', iconColor: '#fff' },
  ];

  autoPostPlatforms = [
    { name: 'Twitter / X', abbr: 'X', color: '#fff' },
    { name: 'Facebook', abbr: 'f', color: '#1877F2' },
    { name: 'LinkedIn', abbr: 'in', color: '#0077B5' },
  ];

  get siteTitle(): string {
    return this.state.selectedSite()?.business_name || 'Your Site Title';
  }

  get siteDomain(): string {
    const slug = this.state.selectedSite()?.slug || 'your-site';
    return `${slug}.projectsites.dev`;
  }

  get siteDescription(): string {
    return 'Your site description will appear here when shared on social media.';
  }
}
