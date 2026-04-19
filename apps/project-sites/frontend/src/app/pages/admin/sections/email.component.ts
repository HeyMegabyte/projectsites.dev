import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-email',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Contact Form Submissions -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Contact Form Submissions
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[0.8rem]">
            <thead>
              <tr class="border-b border-white/[0.06]">
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Name</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Email</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Message</th>
                <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colspan="4" class="py-8 text-center text-text-secondary text-[0.82rem]">No submissions yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Newsletter -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Newsletter
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0 mb-3">Connect to Listmonk for newsletter management. Manage subscribers and campaigns from one place.</p>
        <div class="flex items-center gap-3 p-3 bg-primary/[0.03] rounded-[10px] border border-white/[0.06]">
          <div class="w-8 h-8 rounded-lg bg-primary/[0.08] flex items-center justify-center text-primary flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-[0.8rem] text-white font-medium">listmonk.megabyte.space</span>
            <p class="text-[0.72rem] text-text-secondary m-0">Self-hosted newsletter platform</p>
          </div>
          <span class="text-[0.65rem] font-bold py-0.5 px-2 rounded uppercase bg-amber-500/10 text-amber-400">Not connected</span>
        </div>
      </div>

      <!-- Magic Link History -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          Magic Link History
        </h3>
        <p class="text-[0.82rem] text-text-secondary m-0">Recent authentication emails sent to users of this site.</p>
        <div class="mt-3 py-6 text-center text-text-secondary text-[0.82rem]">No magic links sent yet.</div>
      </div>

    </div>
  `,
})
export class AdminEmailComponent {}
