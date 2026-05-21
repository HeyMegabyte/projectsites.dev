import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
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

interface GhStatus {
  connected: boolean;
  repo_html_url?: string;
  repo_full_name?: string;
  default_branch?: string;
  last_commit_sha?: string;
  commit_count?: number;
  github_user?: string;
}

@Component({
  selector: 'app-admin-snapshots',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Snapshots</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Version history for
            <a
              class="text-primary font-mono no-underline hover:underline transition-colors duration-150 inline-flex items-center gap-1 group/sitelink"
              [href]="'https://' + state.selectedSite()?.slug + '.projectsites.dev'"
              target="_blank"
              rel="noopener noreferrer"
              [title]="'Open live site ' + state.selectedSite()?.slug + '.projectsites.dev in new tab'"
            >
              {{ state.selectedSite()?.slug }}.projectsites.dev
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-60 group-hover/sitelink:opacity-100 transition-opacity"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </p>
        </div>

        <!-- GitHub link/sync — mirrors the isomorphic-git snapshot tree to GitHub on every build. -->
        @if (!ghStatus()?.connected) {
          <button class="btn-github-link" [disabled]="linkingGh() || !state.selectedSite()" (click)="linkGithub()"
                  title="Mirror snapshot history to a GitHub repo; every new snapshot will push automatically.">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            <span>{{ linkingGh() ? 'Opening GitHub…' : 'Link GitHub' }}</span>
          </button>
        } @else {
          <div class="btn-github-linked-wrap">
            <a class="btn-github-linked" [href]="ghStatus()!.repo_html_url" target="_blank" rel="noopener noreferrer"
               [title]="'Open ' + ghStatus()!.repo_full_name + ' on GitHub'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              <span class="font-mono text-[0.7rem]">{{ ghStatus()!.repo_full_name }}</span>
              @if (pushingGh()) {
                <span class="text-[0.62rem] opacity-70">syncing…</span>
              } @else if (ghStatus()!.commit_count) {
                <span class="text-[0.62rem] opacity-70">{{ ghStatus()!.commit_count }} commits</span>
              }
            </a>
            <button class="btn-github-push" [disabled]="pushingGh()" (click)="pushToGithub(true)"
                    title="Push the latest build to GitHub now">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   [class.animate-spin]="pushingGh()">
                <path d="M12 5v14M19 12l-7 7-7-7"/>
              </svg>
            </button>
            <button class="btn-github-unlink" [disabled]="unlinkingGh()" (click)="unlinkGithub()"
                    title="Disconnect GitHub backup">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        }
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
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                      <button class="btn-snap-view group" (click)="viewSnapshot(snap)" title="Open this snapshot in a new tab" [attr.aria-label]="'Open snapshot ' + snap.snapshot_name + ' in new tab'">
                        <span class="btn-snap-view-glow" aria-hidden="true"></span>
                        <svg class="btn-snap-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        <span class="btn-snap-label">View</span>
                      </button>
                      @if (!first) {
                        <button class="btn-snap-revert group" (click)="revertToSnapshot(snap)" [disabled]="reverting()" title="Revert site to this version" [attr.aria-label]="'Revert site to snapshot ' + snap.snapshot_name">
                          <span class="btn-snap-revert-glow" aria-hidden="true"></span>
                          <svg class="btn-snap-icon" [class.animate-spin]="reverting()" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                          <span class="btn-snap-label">{{ reverting() ? 'Reverting' : 'Revert' }}</span>
                        </button>
                      }
                      <button class="btn-snap-trash group" (click)="confirmDelete(snap)" title="Delete this snapshot" [attr.aria-label]="'Delete snapshot ' + snap.snapshot_name">
                        <span class="btn-snap-trash-glow" aria-hidden="true"></span>
                        <svg class="btn-snap-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
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
  styles: [`
    :host { display: block; }
    .btn-github-link { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.75rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: all 150ms ease; }
    .btn-github-link:hover:not(:disabled) { background: rgba(0,229,255,0.1); border-color: rgba(0,229,255,0.35); color: #00E5FF; transform: translateY(-1px); }
    .btn-github-link:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-github-linked-wrap { display: inline-flex; align-items: stretch; border-radius: 8px; border: 1px solid rgba(0,229,255,0.25); background: rgba(0,229,255,0.06); overflow: hidden; }
    .btn-github-linked { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.38rem 0.65rem; color: #00E5FF; text-decoration: none; font-size: 0.72rem; font-weight: 600; transition: background 150ms ease; }
    .btn-github-linked:hover { background: rgba(0,229,255,0.12); }
    .btn-github-push, .btn-github-unlink { display: inline-flex; align-items: center; justify-content: center; width: 26px; border: none; border-left: 1px solid rgba(0,229,255,0.18); background: transparent; color: #00E5FF; cursor: pointer; transition: background 150ms ease, color 150ms ease; }
    .btn-github-push:hover:not(:disabled) { background: rgba(0,229,255,0.16); }
    .btn-github-unlink:hover:not(:disabled) { background: rgba(248,113,113,0.16); color: #f87171; }
    .btn-github-push:disabled, .btn-github-unlink:disabled { opacity: 0.45; cursor: not-allowed; }
  `],
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

  // GitHub mirror (replaces the standalone GitHub Backup nav item).
  ghStatus = signal<GhStatus | null>(null);
  linkingGh = signal(false);
  pushingGh = signal(false);
  unlinkingGh = signal(false);

  ngOnInit(): void {
    const site = this.state.selectedSite();
    if (site) {
      this.loadSnapshots(site.id);
      this.loadGhStatus(site.id);
    }
  }

  private loadGhStatus(siteId: string): void {
    this.api.get<{ data: GhStatus }>(`/sites/${siteId}/github/status`).subscribe({
      next: (r) => this.ghStatus.set(r.data),
      error: () => this.ghStatus.set({ connected: false }),
    });
  }

  linkGithub(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.linkingGh.set(true);
    const returnUrl = encodeURIComponent('/admin/snapshots');
    window.location.href = `/api/sites/${site.id}/github/connect?return_url=${returnUrl}`;
  }

  pushToGithub(manual: boolean): void {
    const site = this.state.selectedSite();
    const status = this.ghStatus();
    if (!site || !status?.connected) return;
    this.pushingGh.set(true);
    this.api.post<{ data: { commit_sha: string; html_url: string } }>(`/sites/${site.id}/github/backup`, {}).subscribe({
      next: () => {
        this.pushingGh.set(false);
        if (manual) this.toast.success('Mirrored to GitHub');
        this.loadGhStatus(site.id);
      },
      error: (err) => {
        this.pushingGh.set(false);
        const msg = err?.error?.error?.message || 'GitHub mirror failed';
        if (manual) this.toast.error(msg);
        else this.toast.error(`Snapshot saved · GitHub mirror failed: ${msg}`);
      },
    });
  }

  unlinkGithub(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    if (!window.confirm('Disconnect GitHub mirror? The existing repo + commits stay; future snapshots will no longer push automatically.')) return;
    this.unlinkingGh.set(true);
    this.api.post(`/sites/${site.id}/github/disconnect`, {}).subscribe({
      next: () => {
        this.unlinkingGh.set(false);
        this.ghStatus.set({ connected: false });
        this.toast.success('GitHub mirror disconnected');
      },
      error: () => {
        this.unlinkingGh.set(false);
        this.toast.error('Failed to disconnect');
      },
    });
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
        if (this.ghStatus()?.connected) this.pushToGithub(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to create snapshot');
        this.creatingSnapshot.set(false);
      },
    });
  }

  viewSnapshot(snap: Snapshot): void {
    const site = this.state.selectedSite();
    if (!site) return;
    const url = `https://${site.slug}-${snap.snapshot_name}.projectsites.dev`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  confirmDelete(snap: Snapshot): void {
    if (!window.confirm(`Permanently delete snapshot "${snap.snapshot_name}"? This cannot be undone.`)) return;
    this.deleteSnapshot(snap.id);
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
