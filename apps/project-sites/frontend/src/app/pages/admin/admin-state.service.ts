import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { forkJoin, interval, takeWhile, switchMap } from 'rxjs';
import { ApiService, Site, DomainSummary, SubscriptionInfo } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

/**
 * Shared state service for the admin dashboard shell and child components.
 * Provided at the AdminComponent level so all children share the same instance.
 *
 * @remarks Holds sites, selected site, subscription, domain summary, and loading state.
 * @example
 * ```ts
 * const state = inject(AdminStateService);
 * const site = state.selectedSite();
 * ```
 */
@Injectable()
export class AdminStateService {
  private api = inject(ApiService);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  sites = signal<Site[]>([]);
  selectedSiteId = signal<string | null>(null);
  domainSummary = signal<DomainSummary>({ total: 0, active: 0, pending: 0, failed: 0 });
  subscription = signal<SubscriptionInfo | null>(null);
  loading = signal(true);

  private alive = true;

  selectedSite = computed(() => {
    const id = this.selectedSiteId();
    if (!id) return this.sites()[0] || null;
    return this.sites().find(s => s.id === id) || this.sites()[0] || null;
  });

  loadData(): void {
    this.loading.set(true);
    forkJoin({
      sites: this.api.listSites(),
      domains: this.api.getDomainSummary(),
      sub: this.api.getSubscription(),
    }).subscribe({
      next: (res) => {
        this.sites.set(res.sites.data || []);
        this.domainSummary.set(res.domains.data || { total: 0, active: 0, pending: 0, failed: 0 });
        this.subscription.set(res.sub.data || null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load dashboard data');
      },
    });
  }

  startPolling(): void {
    interval(5000)
      .pipe(
        takeWhile(() => this.alive && this.sites().some(s =>
          ['building', 'queued', 'generating', 'uploading', 'collecting'].includes(s.status)
        )),
        switchMap(() => this.api.listSites())
      )
      .subscribe({
        next: (res) => this.sites.set(res.data || []),
      });
  }

  stopPolling(): void {
    this.alive = false;
  }

  selectSite(site: Site): void {
    this.selectedSiteId.set(site.id);
  }

  deleteSite(site: Site, cancelSub: boolean): void {
    this.api.deleteSiteWithOptions(site.id, cancelSub).subscribe({
      next: () => {
        this.sites.update(sites => sites.filter(s => s.id !== site.id));
        this.toast.success('Site deleted');
        if (this.selectedSiteId() === site.id) {
          this.selectedSiteId.set(null);
        }
      },
      error: () => this.toast.error('Failed to delete site'),
    });
  }

  // ── Utility methods ──────────────────────────────────

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      published: 'published', building: 'building', queued: 'building',
      collecting: 'building', generating: 'building', uploading: 'building',
      error: 'error', failed: 'error', draft: 'draft',
    };
    return map[status] || 'draft';
  }

  getStatusTextClass(status: string): string {
    const cls = this.getStatusClass(status);
    const map: Record<string, string> = {
      published: 'text-green-500',
      building: 'text-amber-400 animate-pulse',
      error: 'text-red-500',
      draft: 'text-text-secondary',
    };
    return map[cls] || 'text-text-secondary';
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      published: 'Live', building: 'Building', queued: 'Queued',
      collecting: 'Researching', generating: 'Generating', uploading: 'Uploading',
      error: 'Error', failed: 'Failed', draft: 'Draft',
    };
    return map[status] || status;
  }

  getSiteUrl(site: Site): string {
    if (site.primary_hostname) return `https://${site.primary_hostname}`;
    return `https://${site.slug}.projectsites.dev`;
  }

  getSafeSiteUrl(site: Site): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getSiteUrl(site));
  }

  getScreenshotUrl(site: Site): string {
    const siteUrl = this.getSiteUrl(site);
    return `/api/image-proxy?url=${encodeURIComponent(`https://image.thum.io/get/width/800/crop/500/wait/3/noanimate/${siteUrl}`)}`;
  }

  isBuilding(site: Site): boolean {
    return ['building', 'queued', 'generating', 'uploading', 'collecting'].includes(site.status);
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  signOut(): void {
    this.auth.clearSession();
    this.router.navigate(['/']);
  }

  newSite(): void {
    this.auth.clearSelectedBusiness();
    this.auth.setPendingBuild(false);
    this.router.navigate(['/create']);
  }

  visitSite(site: Site): void {
    window.open(this.getSiteUrl(site), '_blank');
  }

  copyUrl(site: Site): void {
    navigator.clipboard.writeText(this.getSiteUrl(site)).then(() => {
      this.toast.success('URL copied to clipboard');
    });
  }

  openBilling(): void {
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res) => {
        if (res.data?.portal_url) window.open(res.data.portal_url, '_blank');
      },
      error: () => this.toast.error('Failed to open billing portal'),
    });
  }

  openReset(site: Site): void {
    this.auth.setSelectedBusiness({
      name: site.business_name || '',
      address: site.business_address || '',
      place_id: (site as any).place_id,
      phone: (site as any).business_phone,
      website: (site as any).business_website,
    });
    this.auth.setMode('business');
    this.auth.setPendingBuild(true);
    const queryParams: Record<string, string> = {
      name: site.business_name || '',
      reset: site.id,
    };
    if (site.business_address) queryParams['address'] = site.business_address;
    this.router.navigate(['/create'], { queryParams });
  }

  goToWaiting(site: Site): void {
    this.router.navigate(['/waiting'], { queryParams: { id: site.id, slug: site.slug } });
  }

  onScreenshotError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    const parent = img.parentElement;
    if (parent && !parent.querySelector('.screenshot-fallback')) {
      const div = document.createElement('div');
      div.className = 'site-card-preview-placeholder screenshot-fallback';
      div.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg><span>Preview</span>';
      parent.appendChild(div);
    }
  }
}
