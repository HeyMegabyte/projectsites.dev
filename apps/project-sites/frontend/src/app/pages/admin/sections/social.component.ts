import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-social',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Social Links -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-5 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Social Links
        </h3>
        <div class="flex flex-col gap-3">
          @for (link of socialLinks; track link.name) {
            <div class="flex gap-2.5 items-center">
              <label class="text-[0.78rem] font-semibold text-text-secondary w-24 flex-shrink-0">{{ link.name }}</label>
              <input type="url" class="input-field flex-1" [placeholder]="link.placeholder" />
            </div>
          }
        </div>
        <button class="btn-accent mt-5" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
          Save Links
        </button>
      </div>

      <!-- OG Image Preview -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            OG Image Preview
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <div class="rounded-xl border border-white/[0.06] overflow-hidden max-w-[480px]">
          <div class="bg-white/[0.03] h-[200px] flex items-center justify-center text-text-secondary text-[0.82rem]">
            <div class="flex flex-col items-center gap-2">
              <svg class="opacity-40" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Social card preview</span>
            </div>
          </div>
          <div class="p-3 bg-white/[0.02]">
            <div class="text-[0.72rem] text-text-secondary mb-0.5">projectsites.dev</div>
            <div class="text-[0.82rem] text-white font-medium">Your Site Title</div>
            <div class="text-[0.75rem] text-text-secondary mt-0.5">Your site description will appear here when shared on social media.</div>
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
        <p class="text-[0.82rem] text-text-secondary m-0">Automatically post to your social media accounts when your site is updated or a new blog post is published.</p>
      </div>

    </div>
  `,
})
export class AdminSocialComponent {
  socialLinks = [
    { name: 'Facebook', placeholder: 'https://facebook.com/yourbusiness' },
    { name: 'Twitter / X', placeholder: 'https://x.com/yourbusiness' },
    { name: 'Instagram', placeholder: 'https://instagram.com/yourbusiness' },
    { name: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourbusiness' },
    { name: 'YouTube', placeholder: 'https://youtube.com/@yourbusiness' },
    { name: 'TikTok', placeholder: 'https://tiktok.com/@yourbusiness' },
  ];
}
