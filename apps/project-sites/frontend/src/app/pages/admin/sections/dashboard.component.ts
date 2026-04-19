import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      @if (state.selectedSite(); as site) {
        <!-- Site preview card -->
        <div class="flex gap-6 mb-6 p-6 bg-white/[0.02] border border-white/[0.06] rounded-[14px] max-md:flex-col max-md:p-4">
          <div class="w-[280px] h-[180px] rounded-[10px] overflow-hidden flex-shrink-0 cursor-pointer bg-primary/[0.03] border border-primary/[0.06] max-md:w-full max-md:h-[160px]"
               (click)="state.isBuilding(site) ? state.goToWaiting(site) : state.visitSite(site)">
            @if (site.status === 'published' && site.current_build_version) {
              <img class="w-full h-full object-cover object-top transition-transform duration-300 hover:scale-[1.03]"
                   [src]="state.getScreenshotUrl(site)" [alt]="site.business_name" loading="lazy"
                   (error)="state.onScreenshotError($event)" />
            } @else if (state.isBuilding(site)) {
              <div class="flex flex-col items-center justify-center h-full gap-2 text-amber-400 text-[0.78rem]">
                <div class="building-spinner"></div>
                <span>{{ state.getStatusLabel(site.status) }}...</span>
                <span class="text-[0.65rem] text-primary opacity-60">Click to view progress</span>
              </div>
            } @else if (site.status === 'error' || site.status === 'failed') {
              <div class="flex flex-col items-center justify-center h-full gap-2 text-red-500 text-[0.78rem]">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <span>Build failed</span>
              </div>
            } @else {
              <div class="flex flex-col items-center justify-center h-full gap-2 text-text-secondary text-[0.78rem]">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <span>Draft</span>
              </div>
            }
          </div>

          <div class="flex-1 flex flex-col gap-2.5 min-w-0">
            <div class="flex items-center gap-2">
              <span class="status-chip" [class]="state.getStatusClass(site.status)">{{ state.getStatusLabel(site.status) }}</span>
              @if (site.plan) {
                <span class="text-[0.62rem] font-bold py-[3px] px-2.5 rounded-md uppercase"
                      [class]="site.plan === 'paid' ? 'bg-green-500/10 text-green-500' : 'bg-text-secondary/10 text-text-secondary'">{{ site.plan }}</span>
              }
            </div>
            <h1 class="text-[1.4rem] font-bold text-white m-0">{{ site.business_name || 'Unnamed' }}</h1>
            <div class="flex items-center gap-1.5">
              <a class="text-[0.8rem] text-primary no-underline transition-all hover:underline"
                 [href]="state.getSiteUrl(site)" target="_blank" rel="noopener">
                {{ site.primary_hostname || site.slug + '.projectsites.dev' }}
              </a>
              <button class="icon-btn-sm" (click)="state.copyUrl(site)" title="Copy URL">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>

            <!-- Quick actions -->
            <div class="flex gap-2 flex-wrap mt-1.5">
              @if (site.status === 'published') {
                <button class="btn-accent" (click)="goToEditor()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  Edit with AI
                </button>
                <button class="btn-ghost" (click)="state.visitSite(site)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Preview
                </button>
              }
              <button class="btn-ghost" (click)="state.openReset(site)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/></svg>
                Rebuild
              </button>
            </div>
          </div>
        </div>

        <!-- Stats cards -->
        <div class="grid grid-cols-4 gap-3.5 mb-6 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
          <div class="flex items-center gap-3.5 py-4 px-[18px] bg-white/[0.02] border border-white/[0.06] rounded-[10px] transition-colors hover:border-primary/[0.15]">
            <div class="w-10 h-10 rounded-[10px] bg-primary/[0.08] flex items-center justify-center text-primary flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-[1.3rem] font-bold text-white">{{ state.domainSummary().total }}</span>
              <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Domains</span>
            </div>
          </div>
          <div class="flex items-center gap-3.5 py-4 px-[18px] bg-white/[0.02] border border-white/[0.06] rounded-[10px] transition-colors hover:border-primary/[0.15]">
            <div class="w-10 h-10 rounded-[10px] bg-green-500/[0.08] flex items-center justify-center text-green-500 flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-[1.3rem] font-bold text-white">{{ state.domainSummary().active }}</span>
              <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Active</span>
            </div>
          </div>
          <div class="flex items-center gap-3.5 py-4 px-[18px] bg-white/[0.02] border border-white/[0.06] rounded-[10px] transition-colors hover:border-primary/[0.15]">
            <div class="w-10 h-10 rounded-[10px] bg-primary/[0.08] flex items-center justify-center text-primary flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-[1.3rem] font-bold text-white">{{ site.current_build_version || '—' }}</span>
              <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Build</span>
            </div>
          </div>
          <div class="flex items-center gap-3.5 py-4 px-[18px] bg-white/[0.02] border border-white/[0.06] rounded-[10px] transition-colors hover:border-primary/[0.15]">
            <div class="w-10 h-10 rounded-[10px] bg-primary/[0.08] flex items-center justify-center text-primary flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-[1.3rem] font-bold text-white">{{ state.subscription()?.status === 'active' ? 'Pro' : 'Free' }}</span>
              <span class="text-[0.72rem] text-text-secondary uppercase tracking-wide">Plan</span>
            </div>
          </div>
        </div>

        <!-- All sites list -->
        @if (state.sites().length > 1) {
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
            <div class="flex items-center gap-3 mb-[18px]">
              <h3 class="text-base font-semibold text-white m-0">All Sites</h3>
              <span class="text-[0.65rem] font-bold py-0.5 px-2 rounded-[10px] bg-primary/10 text-primary">{{ state.sites().length }}</span>
            </div>
            <div class="flex flex-col gap-1">
              @for (s of state.sites(); track s.id) {
                <div class="flex items-center gap-3.5 py-2.5 px-3.5 rounded-[10px] cursor-pointer transition-colors hover:bg-primary/[0.04]"
                     [class.file-active]="state.selectedSite()?.id === s.id"
                     (click)="state.selectSite(s)">
                  <div class="w-12 h-8 rounded-md overflow-hidden flex-shrink-0 bg-primary/[0.04]">
                    @if (s.status === 'published' && s.current_build_version) {
                      <img class="w-full h-full object-cover" [src]="state.getScreenshotUrl(s)" [alt]="s.business_name" loading="lazy" (error)="state.onScreenshotError($event)" />
                    } @else {
                      <div class="flex items-center justify-center h-full text-text-secondary opacity-50">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                      </div>
                    }
                  </div>
                  <div class="flex-1 min-w-0 flex flex-col gap-px">
                    <span class="text-[0.82rem] font-semibold text-white truncate">{{ s.business_name || 'Unnamed' }}</span>
                    <span class="text-[0.68rem] text-text-secondary">{{ s.slug }}.projectsites.dev</span>
                  </div>
                  <span class="status-chip-sm" [class]="state.getStatusClass(s.status)">{{ state.getStatusLabel(s.status) }}</span>
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class AdminDashboardComponent {
  state = inject(AdminStateService);
  private router = inject(Router);

  goToEditor(): void {
    this.router.navigate(['/admin/editor']);
  }
}
