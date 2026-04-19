import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-forms',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Contact Submissions -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Contact Submissions
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
              <tr><td colspan="4" class="py-8 text-center text-text-secondary text-[0.82rem]">No form submissions yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Donation History -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            Donation History
          </h3>
          <span class="text-[0.65rem] font-bold py-0.5 px-2.5 rounded-full uppercase bg-primary/10 text-primary">Coming soon</span>
        </div>
        <p class="text-[0.82rem] text-text-secondary m-0 mb-3">Track Stripe donations received through your site's donation forms.</p>
        <div class="py-6 text-center text-text-secondary text-[0.82rem]">No donations recorded yet.</div>
      </div>

    </div>
  `,
})
export class AdminFormsComponent {}
