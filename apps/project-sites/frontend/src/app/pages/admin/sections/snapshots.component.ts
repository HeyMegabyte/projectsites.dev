import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface Snapshot {
  id: string;
  snapshot_name: string;
  build_version: string;
  description: string | null;
  created_at: string;
}

@Component({
  selector: 'app-admin-snapshots',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center gap-3 mb-[18px]">
          <h3 class="text-base font-semibold text-white m-0">Snapshots</h3>
          <span class="text-[0.75rem] text-text-secondary font-mono">{{ state.selectedSite()!.slug }}-&#123;name&#125;.projectsites.dev</span>
        </div>
        <div class="flex flex-col gap-2 pb-5 mb-5 border-b border-white/[0.06]">
          <div class="flex gap-2.5 items-center">
            <input type="text" placeholder="Name (e.g., v2, redesign)" [(ngModel)]="newSnapshotName" class="input-field flex-1" maxlength="30" />
            <button class="btn-accent" [disabled]="creatingSnapshot() || !newSnapshotName.trim()" (click)="createSnapshot()">
              {{ creatingSnapshot() ? 'Creating...' : 'Create Snapshot' }}
            </button>
          </div>
          <input type="text" placeholder="Description (optional)" [(ngModel)]="newSnapshotDescription" class="input-field" />
        </div>
        @if (loadingSnapshots()) {
          <div class="flex flex-col items-center justify-center gap-3 py-[60px] text-text-secondary text-[0.85rem]"><div class="loading-spinner"></div><span>Loading snapshots...</span></div>
        } @else if (snapshots().length === 0) {
          <p class="text-[0.78rem] text-text-secondary my-2">No snapshots yet. The first one is created when your site is built.</p>
        } @else {
          <div class="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
            @for (snap of snapshots(); track snap.id) {
              <div class="flex items-center justify-between p-3 px-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] transition-colors hover:border-primary/[0.12]">
                <div class="flex flex-col gap-0.5 min-w-0">
                  <a class="font-semibold text-[0.85rem] text-primary no-underline hover:underline" [href]="'https://' + state.selectedSite()!.slug + '-' + snap.snapshot_name + '.projectsites.dev'" target="_blank" rel="noopener">
                    {{ snap.snapshot_name }}
                  </a>
                  <span class="text-[0.68rem] text-text-secondary font-mono">{{ snap.build_version }} &middot; {{ snap.created_at | date:'short' }}</span>
                  @if (snap.description) {
                    <span class="text-[0.75rem] text-text-secondary">{{ snap.description }}</span>
                  }
                </div>
                <button class="icon-btn-sm-danger" (click)="deleteSnapshot(snap.id)" title="Delete snapshot">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AdminSnapshotsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  snapshots = signal<Snapshot[]>([]);
  loadingSnapshots = signal(false);
  newSnapshotName = '';
  newSnapshotDescription = '';
  creatingSnapshot = signal(false);

  ngOnInit(): void {
    const site = this.state.selectedSite();
    if (site) this.loadSnapshots(site.id);
  }

  private loadSnapshots(siteId: string): void {
    this.loadingSnapshots.set(true);
    this.api.get<{ data: Snapshot[] }>(`/sites/${siteId}/snapshots`).subscribe({
      next: (res) => { this.snapshots.set(res.data || []); this.loadingSnapshots.set(false); },
      error: () => { this.loadingSnapshots.set(false); },
    });
  }

  createSnapshot(): void {
    const site = this.state.selectedSite();
    if (!site || !this.newSnapshotName.trim()) return;
    this.creatingSnapshot.set(true);
    this.api.post<{ data: { id: string; snapshot_name: string; build_version: string; url: string } }>(`/sites/${site.id}/snapshots`, {
      name: this.newSnapshotName.trim(),
      description: this.newSnapshotDescription.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.toast.success(`Snapshot created: ${res.data.snapshot_name}`);
        this.newSnapshotName = '';
        this.newSnapshotDescription = '';
        this.creatingSnapshot.set(false);
        this.loadSnapshots(site.id);
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to create snapshot');
        this.creatingSnapshot.set(false);
      },
    });
  }

  deleteSnapshot(snapshotId: string): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.delete(`/sites/${site.id}/snapshots/${snapshotId}`).subscribe({
      next: () => { this.toast.success('Snapshot deleted'); this.loadSnapshots(site.id); },
      error: () => this.toast.error('Failed to delete snapshot'),
    });
  }
}
