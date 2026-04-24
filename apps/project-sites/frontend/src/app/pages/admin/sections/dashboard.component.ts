import { Component, inject, type OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AdminStateService } from '../admin-state.service';
import { ApiService, type LogEntry } from '../../../services/api.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      @if (state.selectedSite(); as site) {

        <!-- ═══ Site Overview Card (full width) ═══ -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 mb-5 max-md:p-4">
          <div class="flex items-start gap-5 max-md:flex-col">
            <!-- Left: screenshot thumbnail -->
            <div class="w-[200px] h-[130px] rounded-xl overflow-hidden flex-shrink-0 bg-white/[0.02] border border-white/[0.06] cursor-pointer max-md:w-full max-md:h-[160px]"
                 (click)="state.isBuilding(site) ? state.goToWaiting(site) : state.visitSite(site)">
              @if (site.status === 'published' && site.current_build_version) {
                <img class="w-full h-full object-cover object-top transition-transform duration-300 hover:scale-[1.03]"
                     [src]="state.getScreenshotUrl(site)" [alt]="site.business_name" loading="lazy"
                     (error)="state.onScreenshotError($event)" />
              } @else if (state.isBuilding(site)) {
                <div class="flex flex-col items-center justify-center h-full gap-2 text-amber-400 text-xs">
                  <div class="building-spinner"></div>
                  <span>{{ state.getStatusLabel(site.status) }}...</span>
                </div>
              } @else {
                <div class="flex flex-col items-center justify-center h-full gap-2 text-text-secondary text-xs">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                  <span>{{ site.status === 'draft' ? 'Draft' : 'No preview' }}</span>
                </div>
              }
            </div>

            <!-- Right: site info -->
            <div class="flex-1 min-w-0 flex flex-col gap-2">
              <div class="flex items-center gap-2 flex-wrap">
                <h1 class="text-xl font-bold text-white m-0 truncate">{{ site.business_name || 'Unnamed Site' }}</h1>
                <span class="status-chip" [class]="state.getStatusClass(site.status)">{{ state.getStatusLabel(site.status) }}</span>
                @if (site.plan) {
                  <span class="text-[0.6rem] font-bold py-[3px] px-2 rounded-md uppercase"
                        [class]="site.plan === 'paid' ? 'bg-green-500/10 text-green-500' : 'bg-white/[0.06] text-text-secondary'">{{ site.plan === 'paid' ? 'Pro' : 'Free' }}</span>
                }
              </div>

              <div class="flex items-center gap-1.5 text-sm text-text-secondary">
                <span class="text-primary/70 font-mono text-xs">{{ site.slug }}.projectsites.dev</span>
                <button class="icon-btn-sm opacity-60 hover:opacity-100" (click)="state.copyUrl(site)" title="Copy URL">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>

              @if (site.updated_at) {
                <div class="text-[0.7rem] text-text-secondary/60">
                  Last updated {{ state.formatRelativeTime(site.updated_at) }}
                  @if (site.current_build_version) {
                    <span class="ml-2 text-primary/40">v{{ site.current_build_version }}</span>
                  }
                </div>
              }

              <!-- Action buttons -->
              <div class="flex gap-2 flex-wrap mt-1">
                @if (site.status === 'published') {
                  <button class="btn-accent text-sm" (click)="goToEditor()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                    Edit with AI
                  </button>
                  <button class="btn-ghost text-sm" (click)="state.visitSite(site)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Preview
                  </button>
                }
                <button class="btn-ghost text-sm" (click)="state.openReset(site)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/></svg>
                  Rebuild
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Stats Row: 4 compact cards ═══ -->
        <div class="grid grid-cols-4 gap-3 mb-5 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
          <!-- Pages -->
          <div class="stat-card">
            <div class="stat-icon bg-primary/[0.08] text-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ fileCount() }}</span>
              <span class="stat-label">Pages</span>
            </div>
          </div>

          <!-- Domains -->
          <div class="stat-card cursor-pointer" (click)="goTo('/admin/domains')">
            <div class="stat-icon bg-primary/[0.08] text-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ state.domainSummary().total }}</span>
              <span class="stat-label">Domains</span>
            </div>
          </div>

          <!-- Snapshots -->
          <div class="stat-card cursor-pointer" (click)="goTo('/admin/snapshots')">
            <div class="stat-icon bg-violet-500/[0.08] text-violet-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ site.current_build_version || 0 }}</span>
              <span class="stat-label">Snapshots</span>
            </div>
          </div>

          <!-- Plan -->
          <div class="stat-card cursor-pointer" (click)="goTo('/admin/billing')">
            <div class="stat-icon" [class]="state.subscription()?.status === 'active' ? 'bg-green-500/[0.08] text-green-400' : 'bg-white/[0.04] text-text-secondary'">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-value">{{ state.subscription()?.status === 'active' ? 'Pro' : 'Free' }}</span>
              <span class="stat-label">{{ state.subscription()?.status === 'active' ? '$19/mo' : '$0/mo' }}</span>
            </div>
          </div>
        </div>

        <!-- ═══ Bottom Grid: 2 columns ═══ -->
        <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">

          <!-- Recent Activity -->
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-white m-0">Recent Activity</h3>
              <a class="text-[0.7rem] text-primary/60 hover:text-primary cursor-pointer no-underline transition-colors" routerLink="/admin/audit">View All</a>
            </div>
            @if (recentLogs().length === 0) {
              <div class="text-[0.78rem] text-text-secondary/50 py-4 text-center">No activity yet</div>
            } @else {
              <div class="flex flex-col gap-0">
                @for (log of recentLogs(); track log.id) {
                  <div class="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                    <div class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" [class]="getLogIconClass(log.action)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        @if (log.action.includes('create') || log.action.includes('build')) {
                          <path d="M12 5v14M5 12h14"/>
                        } @else if (log.action.includes('delete')) {
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        } @else if (log.action.includes('publish') || log.action.includes('deploy')) {
                          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        } @else {
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        }
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-[0.78rem] text-white/80">{{ formatAction(log.action) }}</span>
                      <span class="text-[0.65rem] text-text-secondary/50 ml-2">{{ state.formatRelativeTime(log.created_at) }}</span>
                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Section Summaries -->
          <div class="flex flex-col gap-3">
            <!-- Domains -->
            <div class="section-link-card" (click)="goTo('/admin/domains')">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-[0.82rem] font-semibold text-white">Domains</span>
                  <span class="text-[0.7rem] text-text-secondary truncate">{{ state.domainSummary().total }} connected, {{ state.domainSummary().active }} active</span>
                </div>
              </div>
              <span class="text-[0.7rem] text-primary/50 group-hover:text-primary transition-colors">Manage &rarr;</span>
            </div>

            <!-- SEO -->
            <div class="section-link-card" (click)="goTo('/admin/seo')">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-[0.82rem] font-semibold text-white">SEO Settings</span>
                  <span class="text-[0.7rem] text-text-secondary truncate">Meta tags, sitemap, and search optimization</span>
                </div>
              </div>
              <span class="text-[0.7rem] text-primary/50 group-hover:text-primary transition-colors">Manage &rarr;</span>
            </div>

            <!-- Billing -->
            <div class="section-link-card" (click)="goTo('/admin/billing')">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                     [class]="state.subscription()?.status === 'active' ? 'bg-green-500/[0.06] text-green-400' : 'bg-white/[0.04] text-text-secondary'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-[0.82rem] font-semibold text-white">Billing &amp; Plan</span>
                  <span class="text-[0.7rem] text-text-secondary truncate">{{ state.subscription()?.status === 'active' ? 'Pro plan active' : 'Free plan — upgrade for custom domains' }}</span>
                </div>
              </div>
              <span class="text-[0.7rem] text-primary/50 group-hover:text-primary transition-colors">Manage &rarr;</span>
            </div>

            <!-- Analytics -->
            <div class="section-link-card" (click)="goTo('/admin/analytics')">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-[0.82rem] font-semibold text-white">Analytics</span>
                  <span class="text-[0.7rem] text-text-secondary truncate">Traffic, visitors, and page views</span>
                </div>
              </div>
              <span class="text-[0.7rem] text-primary/50 group-hover:text-primary transition-colors">Manage &rarr;</span>
            </div>
          </div>
        </div>

      }
    </div>
  `,
  styles: [`
    .stat-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      transition: border-color 0.2s;
    }
    .stat-card:hover {
      border-color: rgba(0, 229, 255, 0.15);
    }
    .stat-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .stat-content {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .stat-value {
      font-size: 1.15rem;
      font-weight: 700;
      color: white;
    }
    .stat-label {
      font-size: 0.68rem;
      color: rgba(255, 255, 255, 0.45);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section-link-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .section-link-card:hover {
      border-color: rgba(0, 229, 255, 0.15);
      background: rgba(0, 229, 255, 0.02);
    }
  `],
})
export class AdminDashboardComponent implements OnInit {
  state = inject(AdminStateService);
  private router = inject(Router);
  private api = inject(ApiService);

  recentLogs = signal<LogEntry[]>([]);
  fileCount = signal<number>(0);

  ngOnInit(): void {
    this.loadRecentActivity();
    this.loadFileCount();
  }

  goToEditor(): void {
    this.router.navigate(['/admin/editor']);
  }

  goTo(path: string): void {
    this.router.navigate([path]);
  }

  private loadRecentActivity(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.getSiteLogs(site.id, 5).subscribe({
      next: (res) => this.recentLogs.set(res.data || []),
      error: () => { /* silent — non-critical */ },
    });
  }

  private loadFileCount(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.listFiles(site.id).subscribe({
      next: (res) => this.fileCount.set(res.data?.files?.length || 0),
      error: () => { /* silent — non-critical */ },
    });
  }

  formatAction(action: string): string {
    const labels: Record<string, string> = {
      'site.created': 'Site created',
      'site.published': 'Site published',
      'site.deleted': 'Site deleted',
      'site.reset': 'Site rebuild started',
      'site.deploy': 'Files deployed',
      'site.build_started': 'Build started',
      'site.build_completed': 'Build completed',
      'site.build_failed': 'Build failed',
      'hostname.added': 'Domain added',
      'hostname.removed': 'Domain removed',
      'hostname.primary_set': 'Primary domain changed',
      'billing.checkout': 'Checkout started',
      'billing.subscription_created': 'Subscription activated',
      'billing.subscription_cancelled': 'Subscription cancelled',
    };
    return labels[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  getLogIconClass(action: string): string {
    if (action.includes('delete') || action.includes('fail') || action.includes('cancel')) {
      return 'bg-red-500/[0.08] text-red-400';
    }
    if (action.includes('publish') || action.includes('deploy') || action.includes('complet')) {
      return 'bg-green-500/[0.08] text-green-400';
    }
    if (action.includes('build') || action.includes('reset')) {
      return 'bg-amber-500/[0.08] text-amber-400';
    }
    return 'bg-primary/[0.08] text-primary';
  }
}
