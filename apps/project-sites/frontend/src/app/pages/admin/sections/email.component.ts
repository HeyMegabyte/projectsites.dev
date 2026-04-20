import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-admin-email',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Email</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Contact form submissions, newsletters, and authentication emails.</p>
      </div>

      <!-- Contact Form Submissions -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Contact Form Submissions
          </h3>
          <span class="text-[0.72rem] text-text-secondary">{{ contactSubmissions.length }} total</span>
        </div>

        @if (contactSubmissions.length === 0) {
          <div class="flex flex-col items-center justify-center py-10 text-text-secondary gap-3">
            <svg class="opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            <span class="text-[0.82rem]">No contact submissions yet</span>
            <span class="text-[0.72rem] text-text-secondary/60">Submissions will appear here when visitors use your contact form.</span>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-left text-[0.8rem]">
              <thead>
                <tr class="border-b border-white/[0.06]">
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Date</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Name</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Email</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Message</th>
                  <th class="py-2.5 px-3 text-text-secondary font-semibold text-[0.72rem] uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (sub of contactSubmissions; track sub.id) {
                  <tr class="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.01] cursor-pointer" (click)="toggleExpand(sub.id)">
                    <td class="py-2.5 px-3 text-text-secondary whitespace-nowrap">{{ sub.date }}</td>
                    <td class="py-2.5 px-3 text-white font-medium">{{ sub.name }}</td>
                    <td class="py-2.5 px-3 text-primary/70 font-mono text-[0.75rem]">{{ sub.email }}</td>
                    <td class="py-2.5 px-3 text-text-secondary max-w-[300px]">
                      <span class="line-clamp-1">{{ sub.message }}</span>
                    </td>
                    <td class="py-2.5 px-3">
                      <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase"
                            [class]="sub.status === 'new' ? 'bg-primary/10 text-primary' : sub.status === 'read' ? 'bg-white/[0.06] text-text-secondary' : 'bg-green-500/10 text-green-400'">
                        {{ sub.status }}
                      </span>
                    </td>
                  </tr>
                  @if (expandedId() === sub.id) {
                    <tr class="bg-white/[0.01]">
                      <td colspan="5" class="p-4 text-[0.8rem] text-text-secondary border-b border-white/[0.04]">
                        <div class="pl-2 border-l-2 border-primary/20">{{ sub.message }}</div>
                        <div class="flex gap-2 mt-3">
                          <button class="btn-ghost-sm">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            Reply
                          </button>
                          <button class="btn-ghost-sm">Mark as Read</button>
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
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

        <div class="grid grid-cols-3 gap-3 mb-4 max-md:grid-cols-1">
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-0.5">
            <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Subscribers</span>
            <span class="text-xl font-bold text-white">0</span>
          </div>
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-0.5">
            <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Campaigns Sent</span>
            <span class="text-xl font-bold text-white">0</span>
          </div>
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 flex flex-col gap-0.5">
            <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">Open Rate</span>
            <span class="text-xl font-bold text-text-secondary">--</span>
          </div>
        </div>

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

        @if (magicLinks.length === 0) {
          <div class="py-6 text-center text-text-secondary text-[0.82rem]">No magic links sent yet.</div>
        } @else {
          <div class="flex flex-col gap-0">
            @for (link of magicLinks; track link.id) {
              <div class="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-2 h-2 rounded-full flex-shrink-0" [class]="link.used ? 'bg-green-500' : 'bg-amber-500'"></span>
                  <span class="text-[0.78rem] text-white/80 truncate">{{ link.email }}</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-[0.62rem] font-bold py-0.5 px-2 rounded uppercase"
                        [class]="link.used ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'">
                    {{ link.used ? 'Used' : 'Pending' }}
                  </span>
                  <span class="text-[0.72rem] text-text-secondary/60 whitespace-nowrap">{{ link.date }}</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

    </div>
  `,
})
export class AdminEmailComponent {
  expandedId = signal<string | null>(null);

  // Mock data - populated when submissions exist
  contactSubmissions: Array<{id: string; date: string; name: string; email: string; message: string; status: string}> = [];

  magicLinks: Array<{id: string; email: string; date: string; used: boolean}> = [];

  toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }
}
