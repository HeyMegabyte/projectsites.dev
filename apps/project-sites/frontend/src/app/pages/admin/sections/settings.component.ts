import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center gap-3 mb-[18px]">
          <h3 class="text-base font-semibold text-white m-0">Site Settings</h3>
        </div>
        @if (state.selectedSite(); as site) {
          <div class="mb-5">
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Site Name</label>
            <div class="flex gap-2.5 items-center">
              <input type="text" class="input-field flex-1" [value]="site.business_name" #nameInput />
              <button class="btn-ghost-sm" (click)="saveName(nameInput.value, site.id)">Save</button>
            </div>
          </div>
          <div class="mb-5">
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Slug</label>
            <div class="flex gap-2.5 items-center">
              <input type="text" class="input-field flex-1" [value]="site.slug" #slugInput />
              <span class="text-[0.75rem] text-text-secondary whitespace-nowrap">.projectsites.dev</span>
              <button class="btn-ghost-sm" (click)="saveSlug(slugInput.value, site.id)">Save</button>
            </div>
          </div>
          <div class="mt-8 pt-5 border-t border-red-500/[0.12]">
            <h4 class="text-[0.85rem] font-semibold text-red-500 m-0 mb-3">Danger Zone</h4>
            @if (!confirmingDelete()) {
              <button class="btn-ghost-danger" (click)="confirmingDelete.set(true)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Delete Site
              </button>
            } @else {
              <div class="p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
                <p class="text-[0.85rem] text-text-secondary mb-3 m-0">This will permanently remove <strong class="text-white">{{ site.business_name }}</strong>. This cannot be undone.</p>
                <div class="flex gap-2">
                  <button class="btn-ghost" (click)="confirmingDelete.set(false)">Cancel</button>
                  <button class="btn-ghost-danger" (click)="deleteSite(site)">Confirm Delete</button>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AdminSettingsComponent {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  confirmingDelete = signal(false);

  saveName(value: string, siteId: string): void {
    const name = value.trim();
    if (!name) return;
    this.api.updateSite(siteId, { business_name: name } as any).subscribe({
      next: (res) => {
        this.state.sites.update(sites => sites.map(s => s.id === siteId ? { ...s, ...res.data } : s));
        this.toast.success('Name updated');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Update failed'),
    });
  }

  saveSlug(value: string, siteId: string): void {
    const slug = value.trim();
    if (!slug) return;
    this.api.updateSite(siteId, { slug } as any).subscribe({
      next: (res) => {
        this.state.sites.update(sites => sites.map(s => s.id === siteId ? { ...s, slug: res.data?.slug || slug } : s));
        this.toast.success('Slug updated');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Update failed'),
    });
  }

  deleteSite(site: any): void {
    this.state.deleteSite(site, false);
    this.confirmingDelete.set(false);
  }
}
