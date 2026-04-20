import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-admin-forms',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Forms</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">View contact form submissions and donation records.</p>
      </div>

      <!-- Contact Submissions -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Contact Submissions
          </h3>
          <div class="flex items-center gap-2">
            <button class="btn-ghost-sm" disabled>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>

        @if (contactSubmissions.length === 0) {
          <div class="flex flex-col items-center justify-center py-10 text-text-secondary gap-3">
            <svg class="opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span class="text-[0.82rem]">No form submissions yet</span>
            <span class="text-[0.72rem] text-text-secondary/60">When visitors submit your contact form, their messages will appear here.</span>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-left text-[0.8rem]">
              <thead>
                <tr class="border-b border-white/[0.06]">
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide w-5"></th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Date</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Name</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Email</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Message</th>
                </tr>
              </thead>
              <tbody>
                @for (sub of contactSubmissions; track sub.id) {
                  <tr class="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] cursor-pointer" (click)="toggleExpand(sub.id)">
                    <td class="py-2.5 px-3 text-text-secondary/40">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" [style.transform]="expandedId() === sub.id ? 'rotate(90deg)' : 'rotate(0)'" class="transition-transform">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </td>
                    <td class="py-2.5 px-3 text-text-secondary whitespace-nowrap">{{ sub.date }}</td>
                    <td class="py-2.5 px-3 text-white font-medium">{{ sub.name }}</td>
                    <td class="py-2.5 px-3 text-primary/70 font-mono text-[0.75rem]">{{ sub.email }}</td>
                    <td class="py-2.5 px-3 text-text-secondary max-w-[300px]"><span class="line-clamp-1">{{ sub.message }}</span></td>
                  </tr>
                  @if (expandedId() === sub.id) {
                    <tr class="bg-white/[0.01]">
                      <td colspan="5" class="p-4 text-[0.8rem] text-text-secondary border-b border-white/[0.04]">
                        <div class="pl-3 border-l-2 border-primary/20">{{ sub.message }}</div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Donation History -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            Donation History
          </h3>
          <div class="flex items-center gap-2">
            <button class="btn-ghost-sm" disabled>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>

        @if (donations.length === 0) {
          <div class="flex flex-col items-center justify-center py-10 text-text-secondary gap-3">
            <svg class="opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="text-[0.82rem]">No donations recorded yet</span>
            <span class="text-[0.72rem] text-text-secondary/60">Donations processed through Stripe will appear here automatically.</span>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-left text-[0.8rem]">
              <thead>
                <tr class="border-b border-white/[0.06]">
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Date</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Donor</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Amount</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (donation of donations; track donation.id) {
                  <tr class="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01]">
                    <td class="py-2.5 px-3 text-text-secondary whitespace-nowrap">{{ donation.date }}</td>
                    <td class="py-2.5 px-3 text-white">{{ donation.donor }}</td>
                    <td class="py-2.5 px-3 text-green-400 font-mono font-semibold">{{ donation.amount }}</td>
                    <td class="py-2.5 px-3">
                      <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase bg-green-500/10 text-green-400">{{ donation.status }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

    </div>
  `,
})
export class AdminFormsComponent {
  expandedId = signal<string | null>(null);

  // Empty by default - populated from API when data exists
  contactSubmissions: Array<{id: string; date: string; name: string; email: string; message: string}> = [];
  donations: Array<{id: string; date: string; donor: string; amount: string; status: string}> = [];

  toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }
}
