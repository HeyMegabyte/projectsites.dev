import { Component, inject, signal, type OnInit } from '@angular/core';
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
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold text-white m-0">Snapshots</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Version history for <span class="text-primary/70 font-mono">{{ state.selectedSite()?.slug }}.projectsites.dev</span></p>
      </div>

      <!-- Create Snapshot -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <h3 class="text-base font-semibold text-white m-0 mb-4 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Create Snapshot
        </h3>
        <div class="flex flex-col gap-2">
          <div class="flex gap-2.5 items-center">
            <input type="text" placeholder="Name (e.g., v2, redesign)" [(ngModel)]="newSnapshotName" class="input-field flex-1" maxlength="30" />
            <button class="btn-accent" [disabled]="creatingSnapshot() || !newSnapshotName.trim()" (click)="createSnapshot()">
              {{ creatingSnapshot() ? 'Creating...' : 'Create Snapshot' }}
            </button>
          </div>
          <input type="text" placeholder="Description (optional)" [(ngModel)]="newSnapshotDescription" class="input-field" />
        </div>
      </div>

      <!-- Snapshot Timeline -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0">Version History</h3>
          <span class="text-[0.72rem] text-text-secondary">{{ snapshots().length }} snapshot{{ snapshots().length === 1 ? '' : 's' }}</span>
        </div>

        @if (loadingSnapshots()) {
          <div class="flex flex-col items-center justify-center gap-3 py-[60px] text-text-secondary text-[0.85rem]"><div class="loading-spinner"></div><span>Loading snapshots...</span></div>
        } @else if (snapshots().length === 0) {
          <div class="flex flex-col items-center justify-center py-10 text-text-secondary gap-3">
            <svg class="opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="text-[0.82rem]">No snapshots yet</span>
            <span class="text-[0.72rem] text-text-secondary/60">The first snapshot is created automatically when your site is built.</span>
          </div>
        } @else {
          <!-- Timeline -->
          <div class="relative pl-6 max-h-[500px] overflow-y-auto sidebar-scrollbar">
            <!-- Timeline line -->
            <div class="absolute left-[11px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/30 via-primary/15 to-transparent"></div>

            @for (snap of snapshots(); track snap.id; let first = $first) {
              <div class="relative pb-5 last:pb-0">
                <!-- Timeline dot -->
                <div class="absolute left-[-19px] top-1 w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center"
                     [class]="first ? 'border-primary bg-primary/20 shadow-[0_0_8px_rgba(0,229,255,0.3)]' : 'border-white/20 bg-dark'">
                  @if (first) {
                    <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  }
                </div>

                <!-- Snapshot Card -->
                <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 transition-all hover:border-primary/[0.12] ml-2"
                     [class]="first ? 'border-primary/[0.15] bg-primary/[0.02]' : ''">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex flex-col gap-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <a class="font-semibold text-[0.85rem] text-primary no-underline hover:underline"
                           [href]="'https://' + state.selectedSite()!.slug + '-' + snap.snapshot_name + '.projectsites.dev'" target="_blank" rel="noopener">
                          {{ snap.snapshot_name }}
                        </a>
                        @if (first) {
                          <span class="text-[0.58rem] font-bold py-px px-2 rounded uppercase bg-primary/[0.12] text-primary">Latest</span>
                        }
                        <span class="text-[0.65rem] text-text-secondary/60 font-mono">v{{ snap.build_version }}</span>
                      </div>
                      @if (snap.description) {
                        <span class="text-[0.75rem] text-text-secondary">{{ snap.description }}</span>
                      }
                      <span class="text-[0.68rem] text-text-secondary/50">{{ snap.created_at | date:'medium' }}</span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                      @if (!first) {
                        <button class="btn-ghost-sm text-amber-400 border-amber-400/20 hover:bg-amber-400/10" (click)="revertToSnapshot(snap)" [disabled]="reverting()" title="Revert site to this version">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                          {{ reverting() ? 'Reverting...' : 'Revert' }}
                        </button>
                      }
                      <button class="btn-ghost-sm" title="View this snapshot">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        View
                      </button>
                      <button class="icon-btn-sm-danger" (click)="deleteSnapshot(snap.id)" title="Delete snapshot">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
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
  reverting = signal(false);

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

  revertToSnapshot(snap: Snapshot): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.reverting.set(true);
    this.api.revertSnapshot(site.id, snap.id).subscribe({
      next: (res) => {
        this.toast.success(`Reverted to "${snap.snapshot_name}"`);
        this.reverting.set(false);
        this.loadSnapshots(site.id);
        this.state.loadData();
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to revert snapshot');
        this.reverting.set(false);
      },
    });
  }
}
