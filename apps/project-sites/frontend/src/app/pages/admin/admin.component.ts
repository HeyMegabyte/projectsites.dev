import { Component, OnInit, OnDestroy, inject, signal, HostListener } from '@angular/core';
import { NgTemplateOutlet, DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, interval, takeWhile, switchMap, forkJoin, of, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ApiService, Site, DomainSummary, Hostname, LogEntry, SiteFile, SubscriptionInfo, BusinessResult } from '../../services/api.service';
import { GeolocationService } from '../../services/geolocation.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

interface FileTreeNode {
  name: string;
  key?: string;
  size?: number;
  isDir: boolean;
  expanded: boolean;
  children: FileTreeNode[];
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, DatePipe],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private geo = inject(GeolocationService);
  private sanitizer = inject(DomSanitizer);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deletingSite()) { this.cancelDelete(); return; }
    if (this.editingFile()) { this.closeFileEditor(); return; }
    if (this.filesModalSiteId()) { this.closeFiles(); return; }
    if (this.logsModalSiteId()) { this.closeLogs(); return; }
    if (this.domainModalSiteId()) { this.closeDomains(); return; }
    if (this.deployModalSiteId()) { this.closeDeploy(); return; }
    if (this.resetModalSite()) { this.closeReset(); return; }
  }

  sites = signal<Site[]>([]);
  domainSummary = signal<DomainSummary>({ total: 0, active: 0, pending: 0, failed: 0 });
  subscription = signal<SubscriptionInfo | null>(null);
  loading = signal(true);
  alive = true;

  // Inline edit state
  editingSiteId = signal<string | null>(null);
  editingField = signal<'name' | 'slug' | null>(null);
  editValue = '';

  // More dropdown
  openDropdownId = signal<string | null>(null);

  // Domain modal
  domainModalSiteId = signal<string | null>(null);
  domainModalSiteName = signal('');
  domainModalSlug = signal('');
  domainTab = signal<'existing' | 'connect' | 'register'>('existing');
  hostnames = signal<Hostname[]>([]);
  newHostname = '';
  loadingHostnames = signal(false);

  // Logs modal
  logsModalSiteId = signal<string | null>(null);
  logsModalSiteName = signal('');
  logs = signal<LogEntry[]>([]);
  loadingLogs = signal(false);
  private logsInterval: ReturnType<typeof setInterval> | null = null;

  // Files modal
  filesModalSiteId = signal<string | null>(null);
  filesModalSiteName = signal('');
  files = signal<SiteFile[]>([]);
  fileTree = signal<FileTreeNode[]>([]);
  loadingFiles = signal(false);
  editingFile = signal<SiteFile | null>(null);
  fileContent = '';
  savingFile = signal(false);

  // Deploy modal
  deployModalSiteId = signal<string | null>(null);
  deployModalSiteName = signal('');
  deployFile: File | null = null;
  deployFileName = signal('');
  deploying = signal(false);

  // Snapshots modal
  snapshotModalSiteId = signal<string | null>(null);
  snapshotModalSiteName = signal('');
  snapshotModalSlug = signal('');
  snapshots = signal<{ id: string; snapshot_name: string; build_version: string; description: string | null; created_at: string }[]>([]);
  loadingSnapshots = signal(false);
  newSnapshotName = '';
  newSnapshotDescription = '';
  creatingSnapshot = signal(false);

  // Reset modal
  resetModalSite = signal<Site | null>(null);
  resetName = '';
  resetAddress = '';
  resetContext = '';
  resetting = signal(false);

  // Reset modal search
  resetBusinessSuggestions = signal<BusinessResult[]>([]);
  resetBusinessDropdownOpen = signal(false);
  private resetBusinessSubject = new Subject<string>();
  resetAddressSuggestions = signal<{ description: string; place_id?: string }[]>([]);
  resetAddressDropdownOpen = signal(false);
  private resetAddressSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Domain registration
  registerDomainQuery = '';
  checkingDomain = signal(false);
  domainCheckResult = signal<{ domain: string; available: boolean } | null>(null);

  // Slug editing in domains modal
  editingSlugInModal = signal(false);
  modalSlugValue = '';

  // (Bolt editor moved to /editor/:slug route)

  // Delete confirm
  deletingSite = signal<Site | null>(null);
  deleteCancelSub = false;

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    this.loadData();
    this.startPolling();

    // Reset modal business name search
    this.resetBusinessSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) { this.resetBusinessSuggestions.set([]); this.resetBusinessDropdownOpen.set(false); return of(null); }
          return this.api.searchBusinesses(q, this.geo.lat() ?? undefined, this.geo.lng() ?? undefined);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => { if (!res) return; this.resetBusinessSuggestions.set(res.data || []); this.resetBusinessDropdownOpen.set((res.data || []).length > 0); },
        error: () => { this.resetBusinessSuggestions.set([]); this.resetBusinessDropdownOpen.set(false); },
      });

    // Reset modal address search
    this.resetAddressSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 3) { this.resetAddressSuggestions.set([]); this.resetAddressDropdownOpen.set(false); return of(null); }
          return this.api.searchAddress(q, this.geo.lat() ?? undefined, this.geo.lng() ?? undefined);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => { if (!res) return; this.resetAddressSuggestions.set(res.data || []); this.resetAddressDropdownOpen.set((res.data || []).length > 0); },
        error: () => { this.resetAddressSuggestions.set([]); this.resetAddressDropdownOpen.set(false); },
      });
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.destroy$.next();
    this.destroy$.complete();
    if (this.logsInterval) clearInterval(this.logsInterval);
  }

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

  private startPolling(): void {
    interval(5000)
      .pipe(
        takeWhile(() => this.alive && this.sites().some((s) => ['building', 'queued', 'generating', 'uploading', 'collecting'].includes(s.status))),
        switchMap(() => this.api.listSites())
      )
      .subscribe({
        next: (res) => this.sites.set(res.data || []),
      });
  }

  // ─── Utilities ────────────────────────────────────────

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      published: 'published', building: 'building', queued: 'building',
      collecting: 'building', generating: 'building', uploading: 'building',
      error: 'error', failed: 'error', draft: 'draft',
    };
    return map[status] || 'draft';
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
    // Use thum.io with wait parameter, proxied through our image proxy
    const siteUrl = this.getSiteUrl(site);
    return `/api/image-proxy?url=${encodeURIComponent(`https://image.thum.io/get/width/800/crop/500/wait/3/noanimate/${siteUrl}`)}`;
  }

  goToWaiting(site: Site): void {
    this.router.navigate(['/waiting'], { queryParams: { id: site.id, slug: site.slug } });
  }

  onScreenshotError(event: Event): void {
    const img = event.target as HTMLImageElement;
    // Replace with a gradient placeholder
    img.style.display = 'none';
    const parent = img.parentElement;
    if (parent && !parent.querySelector('.screenshot-fallback')) {
      const div = document.createElement('div');
      div.className = 'site-card-preview-placeholder screenshot-fallback';
      div.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg><span>Preview</span>';
      parent.appendChild(div);
    }
  }

  visitSite(site: Site): void {
    window.open(this.getSiteUrl(site), '_blank');
  }

  editInBolt(site: Site): void {
    this.router.navigate(['/editor', site.slug]);
  }

  copyUrl(site: Site): void {
    navigator.clipboard.writeText(this.getSiteUrl(site)).then(() => {
      this.toast.success('URL copied to clipboard');
    });
  }

  newSite(): void {
    this.auth.clearSelectedBusiness();
    this.auth.setPendingBuild(false);
    this.router.navigate(['/create']);
  }

  openBilling(): void {
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res) => {
        if (res.data?.portal_url) window.open(res.data.portal_url, '_blank');
      },
      error: () => this.toast.error('Failed to open billing portal'),
    });
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

  isBuilding(site: Site): boolean {
    return ['building', 'queued', 'generating', 'uploading', 'collecting'].includes(site.status);
  }

  // ─── More Dropdown ────────────────────────────────────

  toggleDropdown(siteId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openDropdownId.set(this.openDropdownId() === siteId ? null : siteId);
  }

  closeDropdowns(): void {
    this.openDropdownId.set(null);
  }

  // ─── Inline editing ───────────────────────────────────

  startEdit(siteId: string, field: 'name' | 'slug', currentValue: string): void {
    this.editingSiteId.set(siteId);
    this.editingField.set(field);
    this.editValue = currentValue;
  }

  cancelEdit(): void {
    this.editingSiteId.set(null);
    this.editingField.set(null);
  }

  saveEdit(siteId: string): void {
    const field = this.editingField();
    if (!field || !this.editValue.trim()) return;

    const body: Partial<Site> = field === 'name'
      ? { business_name: this.editValue.trim() }
      : { slug: this.editValue.trim() };

    this.api.updateSite(siteId, body).subscribe({
      next: (res) => {
        this.sites.update((sites) =>
          sites.map((s) => (s.id === siteId ? { ...s, ...res.data } : s))
        );
        this.cancelEdit();
        this.toast.success('Updated successfully');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Update failed'),
    });
  }

  // ─── Delete ───────────────────────────────────────────

  confirmDelete(site: Site): void {
    this.deletingSite.set(site);
    this.deleteCancelSub = false;
    this.closeDropdowns();
  }

  cancelDelete(): void {
    this.deletingSite.set(null);
  }

  deleteSite(): void {
    const site = this.deletingSite();
    if (!site) return;

    this.api.deleteSiteWithOptions(site.id, this.deleteCancelSub).subscribe({
      next: () => {
        this.sites.update((sites) => sites.filter((s) => s.id !== site.id));
        this.deletingSite.set(null);
        this.toast.success('Site deleted');
      },
      error: () => this.toast.error('Failed to delete site'),
    });
  }

  // ─── Domain modal ─────────────────────────────────────

  openDomains(site: Site): void {
    this.domainModalSiteId.set(site.id);
    this.domainModalSiteName.set(site.business_name);
    this.domainModalSlug.set(site.slug);
    this.domainTab.set('existing');
    this.loadHostnames(site.id);
    this.closeDropdowns();
  }

  closeDomains(): void {
    this.domainModalSiteId.set(null);
    this.hostnames.set([]);
    this.newHostname = '';
    this.registerDomainQuery = '';
    this.domainCheckResult.set(null);
    this.editingSlugInModal.set(false);
  }

  // ── Snapshots ──────────────────────────────────────────────
  openSnapshots(site: Site): void {
    this.snapshotModalSiteId.set(site.id);
    this.snapshotModalSiteName.set(site.business_name);
    this.snapshotModalSlug.set(site.slug);
    this.loadSnapshots(site.id);
    this.closeDropdowns();
  }

  closeSnapshots(): void {
    this.snapshotModalSiteId.set(null);
    this.snapshots.set([]);
    this.newSnapshotName = '';
    this.newSnapshotDescription = '';
  }

  private loadSnapshots(siteId: string): void {
    this.loadingSnapshots.set(true);
    this.api.get<{ data: { id: string; snapshot_name: string; build_version: string; description: string | null; created_at: string }[] }>(`/sites/${siteId}/snapshots`).subscribe({
      next: (res) => { this.snapshots.set(res.data || []); this.loadingSnapshots.set(false); },
      error: () => { this.loadingSnapshots.set(false); },
    });
  }

  createSnapshot(): void {
    const siteId = this.snapshotModalSiteId();
    if (!siteId || !this.newSnapshotName.trim()) return;
    this.creatingSnapshot.set(true);
    this.api.post<{ data: { id: string; snapshot_name: string; build_version: string; url: string } }>(`/sites/${siteId}/snapshots`, {
      name: this.newSnapshotName.trim(),
      description: this.newSnapshotDescription.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.toast.success(`Snapshot created: ${res.data.snapshot_name}`);
        this.newSnapshotName = '';
        this.newSnapshotDescription = '';
        this.creatingSnapshot.set(false);
        this.loadSnapshots(siteId);
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to create snapshot');
        this.creatingSnapshot.set(false);
      },
    });
  }

  deleteSnapshot(snapshotId: string): void {
    const siteId = this.snapshotModalSiteId();
    if (!siteId) return;
    this.api.delete(`/sites/${siteId}/snapshots/${snapshotId}`).subscribe({
      next: () => {
        this.toast.success('Snapshot deleted');
        this.loadSnapshots(siteId);
      },
      error: () => this.toast.error('Failed to delete snapshot'),
    });
  }

  startSlugEdit(): void {
    this.modalSlugValue = this.domainModalSlug();
    this.editingSlugInModal.set(true);
  }

  cancelSlugEdit(): void {
    this.editingSlugInModal.set(false);
  }

  saveSlugFromModal(): void {
    const siteId = this.domainModalSiteId();
    const newSlug = this.modalSlugValue.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!siteId || !newSlug) return;

    this.api.updateSite(siteId, { slug: newSlug } as any).subscribe({
      next: (res) => {
        this.domainModalSlug.set(res.data?.slug || newSlug);
        this.sites.update((sites) =>
          sites.map((s) => (s.id === siteId ? { ...s, slug: res.data?.slug || newSlug } : s))
        );
        this.editingSlugInModal.set(false);
        this.toast.success('Subdomain updated');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Failed to update subdomain'),
    });
  }

  checkDomainAvailability(): void {
    const query = this.registerDomainQuery.trim().toLowerCase();
    if (!query) return;
    const domain = query.includes('.') ? query : `${query}.com`;
    this.checkingDomain.set(true);
    this.domainCheckResult.set(null);
    this.api.checkSlug(domain.replace(/\./g, '-')).subscribe({
      next: () => {
        this.domainCheckResult.set({ domain, available: true });
        this.checkingDomain.set(false);
      },
      error: () => {
        this.domainCheckResult.set({ domain, available: false });
        this.checkingDomain.set(false);
      },
    });
  }

  private loadHostnames(siteId: string): void {
    this.loadingHostnames.set(true);
    this.api.getHostnames(siteId).subscribe({
      next: (res) => {
        this.hostnames.set(res.data || []);
        this.loadingHostnames.set(false);
      },
      error: () => {
        this.loadingHostnames.set(false);
        this.toast.error('Failed to load domains');
      },
    });
  }

  addHostname(): void {
    const siteId = this.domainModalSiteId();
    if (!siteId || !this.newHostname.trim()) return;

    this.api.addHostname(siteId, this.newHostname.trim()).subscribe({
      next: (res) => {
        this.hostnames.update((h) => [...h, res.data]);
        this.newHostname = '';
        this.toast.success('Domain added — point your CNAME to projectsites.dev');
        this.domainTab.set('existing');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Failed to add domain'),
    });
  }

  setPrimary(hostnameId: string): void {
    const siteId = this.domainModalSiteId();
    if (!siteId) return;

    this.api.setPrimaryHostname(siteId, hostnameId).subscribe({
      next: () => {
        this.hostnames.update((h) =>
          h.map((hn) => ({ ...hn, is_primary: hn.id === hostnameId }))
        );
        this.toast.success('Primary domain updated');
      },
      error: () => this.toast.error('Failed to set primary'),
    });
  }

  deleteHostname(hostnameId: string): void {
    const siteId = this.domainModalSiteId();
    if (!siteId) return;

    this.api.deleteHostname(siteId, hostnameId).subscribe({
      next: () => {
        this.hostnames.update((h) => h.filter((hn) => hn.id !== hostnameId));
        this.toast.success('Domain removed');
      },
      error: () => this.toast.error('Failed to remove domain'),
    });
  }

  getHostnameStatusClass(status: string): string {
    if (status === 'active') return 'hn-active';
    if (status === 'pending') return 'hn-pending';
    return 'hn-failed';
  }

  // ─── Logs modal ───────────────────────────────────────

  openLogs(site: Site): void {
    this.logsModalSiteId.set(site.id);
    this.logsModalSiteName.set(site.business_name);
    this.loadLogs(site.id);
    this.closeDropdowns();

    // Auto-refresh logs every 5s
    this.logsInterval = setInterval(() => {
      const id = this.logsModalSiteId();
      if (id) this.loadLogs(id);
    }, 5000);
  }

  closeLogs(): void {
    this.logsModalSiteId.set(null);
    this.logs.set([]);
    if (this.logsInterval) {
      clearInterval(this.logsInterval);
      this.logsInterval = null;
    }
  }

  loadLogs(siteId: string): void {
    if (this.logs().length === 0) this.loadingLogs.set(true);
    this.api.getSiteLogs(siteId).subscribe({
      next: (res) => {
        this.logs.set(res.data || []);
        this.loadingLogs.set(false);
      },
      error: () => {
        this.loadingLogs.set(false);
        this.toast.error('Failed to load logs');
      },
    });
  }

  formatLogAction(action: string): string {
    const map: Record<string, string> = {
      'site.created': 'Site Created',
      'site.created_from_search': 'Site Created',
      'site.deleted': 'Site Deleted',
      'site.updated': 'Site Updated',
      'site.reset': 'Site Reset',
      'site.deployed': 'Site Deployed',
      'site.deploy_started': 'Deploy Started',
      'site.slug_changed': 'URL Changed',
      'site.name_changed': 'Name Changed',
      'site.published_from_bolt': 'Published from Bolt',
      'site.cache_invalidated': 'Cache Cleared',
      'site.r2_migration_started': 'File Migration Started',
      'site.r2_migration_complete': 'File Migration Complete',
      'site.r2_migration_failed': 'File Migration Failed',
      'file.updated': 'File Saved',
      'file.deleted': 'File Deleted',
      'file.created': 'File Created',
      'hostname.provisioned': 'Domain Added',
      'hostname.unsubscribed': 'Domain Removed',
      'hostname.verified': 'Domain Verified',
      'hostname.deprovisioned': 'Domain Removed',
      'hostname.deleted': 'Domain Deleted',
      'hostname.set_primary': 'Primary Domain Set',
      'hostname.reset_primary': 'Primary Domain Reset',
      'workflow.queued': 'Build Queued',
      'workflow.started': 'Build Started',
      'workflow.phase.research': 'Research Phase',
      'workflow.phase.generation': 'Generation Phase',
      'workflow.phase.deployment': 'Deployment Phase',
      'workflow.status_update': 'Status Update',
      'workflow.step.started': 'Step Started',
      'workflow.step.complete': 'Step Complete',
      'workflow.step.profile_research_started': 'Researching Business',
      'workflow.step.profile_research_complete': 'Profile Research Done',
      'workflow.step.parallel_research_started': 'Researching Details',
      'workflow.step.parallel_research_complete': 'Research Complete',
      'workflow.step.html_generation_started': 'Generating Website',
      'workflow.step.html_generation_complete': 'Website Generated',
      'workflow.step.legal_scoring_started': 'Creating Legal Pages',
      'workflow.step.legal_and_scoring_complete': 'Legal Pages Ready',
      'workflow.step.upload_started': 'Uploading Files',
      'workflow.step.upload_to_r2_complete': 'Files Uploaded',
      'workflow.step.publishing_started': 'Publishing Site',
      'workflow.step.failed': 'Step Failed',
      'workflow.completed': 'Build Completed',
      'workflow.failed': 'Build Failed',
      'workflow.retry_created': 'Workflow Retried',
      'workflow.creation_failed': 'Workflow Failed to Start',
      'workflow.debug.llm_output': 'LLM Response Received',
      'workflow.debug.json_extraction_failed': 'JSON Parse Failed',
      'workflow.debug.validation_failed': 'Validation Failed',
      'workflow.debug.score_text_fallback': 'Score Parsed from Text',
      'workflow.debug.score_fallback': 'Score Defaulted',
      'workflow.debug.google_places_failed': 'Places Lookup Failed',
      'workflow.step.google_places_enriched': 'Places Data Found',
      'workflow.quality_below_threshold': 'Quality Below Threshold',
      'workflow.quality_regenerated': 'Site Regenerated',
      'workflow.quality_regen_failed': 'Regeneration Failed',
      'auth.magic_link_requested': 'Sign-In Link Sent',
      'auth.magic_link_verified': 'Signed In (Email)',
      'auth.google_oauth_started': 'Google Sign-In Started',
      'auth.google_oauth_verified': 'Signed In (Google)',
      'billing.checkout_created': 'Checkout Started',
      'billing.portal_opened': 'Billing Portal Opened',
      'billing.subscription_active': 'Subscription Active',
      'domain.purchase_initiated': 'Domain Purchase Started',
      'notification.domain_verified_sent': 'Domain Notification Sent',
      'notification.build_complete_sent': 'Build Notification Sent',
      'notification.email_failed': 'Email Notification Failed',
      'webhook.processing_failed': 'Webhook Processing Failed',
      'webhook.stripe.checkout.session.completed': 'Payment Received',
      'webhook.stripe.customer.subscription.updated': 'Subscription Updated',
      'webhook.stripe.customer.subscription.deleted': 'Subscription Canceled',
      'webhook.stripe.invoice.payment_failed': 'Payment Failed',
      'webhook.stripe.charge.refunded': 'Payment Refunded',
      'webhook.stripe.invoice.paid': 'Invoice Paid',
    };
    return map[action] || action.replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  getLogColorClass(action: string): string {
    if (/created|verified|completed|published|complete|active/.test(action)) return 'log-c-green';
    if (/deleted|failed|error|canceled/.test(action)) return 'log-c-red';
    if (/reset|queued|warning|migration/.test(action)) return 'log-c-amber';
    if (/generation|deployed|upload|checkout|billing/.test(action)) return 'log-c-purple';
    if (/research|auth|hostname|dns|domain|notification/.test(action)) return 'log-c-cyan';
    if (/updated|changed|renamed|cache|file/.test(action)) return 'log-c-blue';
    if (/webhook|contact/.test(action)) return 'log-c-muted';
    return 'log-c-muted';
  }

  getLogIcon(action: string): string {
    const s = 'width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    if (action.includes('created')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    if (action.includes('deleted')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    if (action.includes('reset')) return `<svg ${s}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    if (action.includes('generation') || action.includes('html')) return `<svg ${s}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    if (action.includes('research') || action.includes('profile')) return `<svg ${s}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    if (action.includes('upload') || action.includes('deploy')) return `<svg ${s}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    if (action.includes('auth')) return `<svg ${s}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    if (action.includes('hostname') || action.includes('dns') || action.includes('domain')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    if (action.includes('slug') || action.includes('renamed') || action.includes('changed')) return `<svg ${s}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
    if (action.includes('billing') || action.includes('checkout') || action.includes('payment') || action.includes('subscription')) return `<svg ${s}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
    if (action.includes('notification')) return `<svg ${s}><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
    if (action.includes('file')) return `<svg ${s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    if (action.includes('cache') || action.includes('migration')) return `<svg ${s}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    if (action.includes('workflow') || action.includes('step')) return `<svg ${s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    if (action.includes('contact')) return `<svg ${s}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>`;
    return `<svg ${s}><circle cx="12" cy="12" r="3"/></svg>`;
  }

  formatLogMeta(metaJson: string, action?: string): string {
    if (!metaJson) return '';
    let m: Record<string, unknown>;
    try {
      m = typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson;
    } catch {
      return '';
    }
    const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const c = (s: string) => `<code>${e(s)}</code>`;
    const t = (ms: unknown) => `${(Number(ms) / 1000).toFixed(1)}s`;
    const accent = (s: string) => `<span style="color:var(--accent)">${s}</span>`;
    const err = (s: string) => `<span style="color:var(--error)">${e(s)}</span>`;
    const dim = (s: string) => s;
    const a = action || '';

    // ── Validation errors: show field issues concisely ──
    if (a.includes('validation_failed')) {
      const step = m['step'] ? String(m['step']) : '';
      const zod = m['zod_details'] ? String(m['zod_details']) : '';
      const fields = zod.split(';').map((f) => f.trim()).filter(Boolean);
      const parts = [step ? c(step) : ''];
      if (fields.length > 0) {
        // Show max 3 field errors to keep it short
        const shown = fields.slice(0, 3).map((f) => {
          const [path, ...rest] = f.split(':');
          const issue = rest.join(':').trim()
            .replace(/^Expected\s+/, '').replace(/,\s*received\s+/, ' ≠ ');
          return `${c(path.trim())}: ${err(issue)}`;
        });
        if (fields.length > 3) shown.push(dim(`+${fields.length - 3} more`));
        parts.push(shown.join(', '));
      }
      return parts.filter(Boolean).join(' &middot; ');
    }

    // ── Workflow started: show business name, slug, flags ──
    if (a === 'workflow.started') {
      const parts: string[] = [];
      if (m['business_name']) parts.push(e(String(m['business_name'])));
      if (m['slug']) parts.push(c(String(m['slug'])));
      const flags = [m['has_context'] ? 'has context' : '', m['has_assets'] ? 'has assets' : ''].filter(Boolean);
      if (flags.length) parts.push(dim(flags.join(', ')));
      if (m['message'] && !m['business_name'] && !m['slug']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Research started: show business name + address ──
    if (a === 'workflow.step.profile_research_started') {
      const parts: string[] = [];
      if (m['business_name']) parts.push(e(String(m['business_name'])));
      if (m['business_address']) parts.push(dim(e(String(m['business_address']))));
      if (m['message'] && !m['business_name']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Parallel research started: show step names ──
    if (a === 'workflow.step.parallel_research_started') {
      const parts: string[] = [];
      if (m['steps'] && Array.isArray(m['steps'])) {
        parts.push(dim(m['steps'].join(', ')));
      } else if (m['message']) {
        parts.push(e(String(m['message']).slice(0, 100)));
      } else {
        parts.push(dim('social, brand, USPs, images'));
      }
      return parts.join(' &middot; ');
    }

    // ── Workflow queued/failed ──
    if (a === 'workflow.queued' || a === 'workflow.failed' || a === 'workflow.creation_failed') {
      const parts: string[] = [];
      if (m['slug']) parts.push(c(String(m['slug'])));
      if (m['error']) parts.push(err(String(m['error']).slice(0, 100)));
      if (m['message'] && !m['slug'] && !m['error']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Generic step started/complete (when not handled by specific actions above) ──
    if (a === 'workflow.step.started' || a === 'workflow.step.complete') {
      const parts: string[] = [];
      if (m['step']) parts.push(c(String(m['step'])));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Workflow phase transitions ──
    if (a.startsWith('workflow.phase.')) {
      const parts: string[] = [];
      if (m['phase']) parts.push(e(String(m['phase'])));
      if (m['message'] && !m['phase']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── LLM output: show step, size, model ──
    if (a.includes('llm_output')) {
      const parts: string[] = [];
      if (m['step']) parts.push(c(String(m['step'])));
      if (m['output_length']) parts.push(accent(`${Number(m['output_length']).toLocaleString()} chars`));
      if (m['model']) parts.push(dim(String(m['model'])));
      return parts.join(' &middot; ');
    }

    // ── JSON extraction failed: show step + truncated error ──
    if (a.includes('json_extraction_failed')) {
      const parts: string[] = [];
      if (m['step']) parts.push(c(String(m['step'])));
      if (m['error']) parts.push(err(String(m['error']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Step failed: show step, phase, concise error ──
    if (a === 'workflow.step.failed') {
      const parts: string[] = [];
      if (m['step']) parts.push(c(String(m['step'])));
      if (m['phase']) parts.push(dim(String(m['phase'])));
      if (m['error']) {
        let errStr = String(m['error']);
        // Strip verbose validation details — already shown in preceding validation_failed entry
        const colonIdx = errStr.indexOf(':');
        if (errStr.length > 80 && colonIdx > 0 && colonIdx < 60) {
          errStr = errStr.slice(0, colonIdx);
        } else if (errStr.length > 80) {
          errStr = errStr.slice(0, 80) + '…';
        }
        parts.push(err(errStr));
      }
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Profile research complete: type, services, location ──
    if (a.includes('profile_research_complete')) {
      const parts: string[] = [];
      if (m['business_type']) parts.push(e(String(m['business_type'])));
      if (m['services_count']) parts.push(`${m['services_count']} services`);
      if (m['city'] || m['state']) parts.push(e([m['city'], m['state']].filter(Boolean).join(', ')));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Google Places enrichment ──
    if (a.includes('google_places_enriched')) {
      const parts: string[] = [];
      if (m['rating']) parts.push(`${m['rating']}★`);
      if (m['review_count']) parts.push(`${m['review_count']} reviews`);
      if (m['photo_count']) parts.push(`${m['photo_count']} photos`);
      const flags = [m['has_phone'] ? 'phone' : '', m['has_website'] ? 'website' : '', m['has_hours'] ? 'hours' : ''].filter(Boolean);
      if (flags.length) parts.push(dim(flags.join(', ')));
      return parts.join(' &middot; ');
    }

    // ── Parallel research complete ──
    if (a.includes('parallel_research_complete')) {
      const parts: string[] = [];
      const items = ['social', 'brand', 'USPs', 'images'].filter(Boolean);
      parts.push(dim(items.join(' + ')));
      if (m['website_url']) parts.push(c(String(m['website_url'])));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── HTML generation complete ──
    if (a.includes('html_generation_complete')) {
      const parts: string[] = [];
      if (m['html_size_kb']) parts.push(accent(`${m['html_size_kb']} KB`));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Legal + scoring complete ──
    if (a.includes('legal_and_scoring_complete')) {
      const parts: string[] = [];
      if (m['quality_score'] !== undefined) parts.push(accent(`Score: ${m['quality_score']}/100`));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Quality below threshold ──
    if (a.includes('quality_below_threshold')) {
      const parts: string[] = [];
      if (m['quality_score'] !== undefined && m['threshold'] !== undefined) {
        parts.push(err(`${m['quality_score']} < ${m['threshold']} threshold`));
      }
      if (m['issues'] && Array.isArray(m['issues']) && m['issues'].length) {
        parts.push(dim(m['issues'].slice(0, 3).join(', ')));
      }
      return parts.join(' &middot; ');
    }

    // ── Quality regenerated ──
    if (a.includes('quality_regenerated')) {
      const parts: string[] = [];
      if (m['new_quality_score'] !== undefined) parts.push(accent(`New score: ${m['new_quality_score']}/100`));
      if (m['improved']) parts.push(dim('improved'));
      return parts.join(' &middot; ');
    }

    // ── Upload complete ──
    if (a.includes('upload_to_r2_complete')) {
      const parts: string[] = [];
      if (m['version']) parts.push(`v${e(String(m['version']))}`);
      if (m['slug']) parts.push(c(`${m['slug']}.projectsites.dev`));
      if (m['elapsed_ms']) parts.push(accent(t(m['elapsed_ms'])));
      return parts.join(' &middot; ');
    }

    // ── Build completed ──
    if (a === 'workflow.completed') {
      const parts: string[] = [];
      if (m['url']) parts.push(c(String(m['url'])));
      if (m['quality_score'] !== undefined) parts.push(accent(`Score: ${m['quality_score']}/100`));
      if (m['total_seconds']) parts.push(accent(`${m['total_seconds']}s total`));
      return parts.join(' &middot; ');
    }

    // ── Status update ──
    if (a === 'workflow.status_update') {
      const parts: string[] = [];
      if (m['old_status'] && m['new_status']) parts.push(`${e(String(m['old_status']))} → ${e(String(m['new_status']))}`);
      else if (m['new_status']) parts.push(e(String(m['new_status'])));
      else if (m['status']) parts.push(e(String(m['status'])));
      if (m['phase']) parts.push(dim(e(String(m['phase']))));
      if (!parts.length && m['message']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Score fallback / text fallback ──
    if (a.includes('score_text_fallback')) {
      const parts: string[] = [];
      if (m['parsed_overall'] !== undefined) parts.push(`Parsed score: ${m['parsed_overall']}`);
      return parts.join(' &middot; ') || dim('Used regex fallback parser');
    }
    if (a.includes('score_fallback')) {
      return dim('Using default scores (scoring failed)');
    }

    // ── Slug / name changes ──
    if (a.includes('slug_changed') && m['old_slug'] && m['new_slug']) {
      return `${c(String(m['old_slug']))} → ${c(String(m['new_slug']))}`;
    }
    if (a.includes('name_changed') && m['old_name'] && m['new_name']) {
      return `${e(String(m['old_name']))} → ${e(String(m['new_name']))}`;
    }

    // ── Hostname operations ──
    if (a.includes('hostname')) {
      const parts: string[] = [];
      if (m['hostname']) parts.push(c(String(m['hostname'])));
      if (m['status']) parts.push(e(String(m['status'])));
      if (m['message'] && !m['hostname']) parts.push(e(String(m['message'])));
      return parts.join(' &middot; ');
    }

    // ── Site created / deployed ──
    if (a === 'site.created' || a === 'site.created_from_search') {
      const parts: string[] = [];
      if (m['business_name']) parts.push(e(String(m['business_name'])));
      if (m['slug']) parts.push(c(String(m['slug'])));
      if (m['mode']) parts.push(dim(String(m['mode'])));
      return parts.join(' &middot; ');
    }
    if (a === 'site.deployed' || a === 'site.deploy_started') {
      const parts: string[] = [];
      if (m['file_count']) parts.push(`${m['file_count']} files`);
      if (m['slug']) parts.push(c(String(m['slug'])));
      return parts.join(' &middot; ');
    }

    // ── File operations ──
    if (a.startsWith('file.')) {
      const parts: string[] = [];
      if (m['file_key'] || m['key']) parts.push(c(String(m['file_key'] || m['key'])));
      if (m['size']) parts.push(dim(`${(Number(m['size']) / 1024).toFixed(1)} KB`));
      return parts.join(' &middot; ');
    }

    // ── Auth ──
    if (a.includes('auth.')) {
      if (m['email']) return c(String(m['email']));
      if (m['identifier']) return c(String(m['identifier']));
      if (m['message']) return e(String(m['message']));
      return '';
    }

    // ── Billing ──
    if (a.includes('billing.') || a.includes('checkout') || a.includes('subscription')) {
      const parts: string[] = [];
      if (m['plan']) parts.push(e(String(m['plan'])));
      if (m['amount']) parts.push(accent(`$${m['amount']}`));
      if (m['interval']) parts.push(dim(`/${m['interval']}`));
      if (m['message'] && !m['plan']) parts.push(e(String(m['message'])));
      return parts.join('');
    }

    // ── Webhook ──
    if (a.includes('webhook')) {
      const parts: string[] = [];
      if (m['event_type']) parts.push(c(String(m['event_type'])));
      if (m['error']) parts.push(err(String(m['error']).slice(0, 100)));
      if (m['message'] && !m['event_type'] && !m['error']) parts.push(e(String(m['message'])));
      return parts.join(' &middot; ');
    }

    // ── R2 migration ──
    if (a.includes('r2_migration')) {
      const parts: string[] = [];
      if (m['file_count']) parts.push(`${m['file_count']} files`);
      if (m['error']) parts.push(err(String(m['error']).slice(0, 100)));
      if (m['message'] && !m['error']) parts.push(e(String(m['message'])));
      return parts.join(' &middot; ');
    }

    // ── Notification ──
    if (a.includes('notification')) {
      const parts: string[] = [];
      if (m['email'] || m['to']) parts.push(c(String(m['email'] || m['to'])));
      if (m['error']) parts.push(err(String(m['error']).slice(0, 80)));
      return parts.join(' &middot; ');
    }

    // ── Site cache / publish ──
    if (a === 'site.cache_invalidated' || a === 'site.published_from_bolt') {
      const parts: string[] = [];
      if (m['slug']) parts.push(c(String(m['slug'])));
      if (m['message'] && !m['slug']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Contact form ──
    if (a === 'contact.form_submitted') {
      const parts: string[] = [];
      if (m['name']) parts.push(e(String(m['name'])));
      if (m['email']) parts.push(c(String(m['email'])));
      return parts.join(' &middot; ');
    }

    // ── Generic started steps (generation, legal, upload, publishing) ──
    if (a.includes('_started') && a.startsWith('workflow.step.')) {
      const parts: string[] = [];
      if (m['slug']) parts.push(c(String(m['slug'])));
      if (m['message'] && !m['slug']) parts.push(e(String(m['message']).slice(0, 100)));
      return parts.join(' &middot; ');
    }

    // ── Generic fallback: use message, then structured fields ──
    const parts: string[] = [];
    if (m['message']) {
      let msg = String(m['message']);
      if (msg.length > 140) msg = msg.slice(0, 140) + '…';
      parts.push(e(msg));
    }
    if (m['elapsed_ms'] && !m['message']) parts.push(accent(t(m['elapsed_ms'])));
    if (m['slug'] && !m['message']) parts.push(c(String(m['slug'])));
    if (m['error'] && !m['message']) {
      let errMsg = String(m['error']);
      if (errMsg.length > 100) errMsg = errMsg.slice(0, 100) + '…';
      parts.push(err(errMsg));
    }
    return parts.join(' &middot; ');
  }

  formatLogTimestamp(iso: string): string {
    try {
      let normalized = iso;
      if (iso && !iso.includes('T') && !iso.includes('Z')) {
        normalized = iso.replace(' ', 'T') + 'Z';
      } else if (iso && !iso.includes('Z') && !iso.includes('+')) {
        normalized = iso + 'Z';
      }
      const d = new Date(normalized);
      const diff = Date.now() - d.getTime();
      const secs = Math.floor(diff / 1000);
      const mins = Math.floor(secs / 60);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);
      if (isNaN(secs) || secs < 0) return iso;
      if (secs < 10) return 'just now';
      if (secs < 45) return `${secs}s ago`;
      if (secs < 90) return '1 min ago';
      if (mins < 45) return `${mins} min ago`;
      if (mins < 90) return '1 hr ago';
      if (hrs < 24) return `${hrs} hr ago`;
      if (hrs < 42) return '1 day ago';
      if (days < 7) return `${days} days ago`;
      if (days < 11) return '1 week ago';
      if (weeks < 4) return `${weeks} weeks ago`;
      if (days < 45) return '1 month ago';
      if (months < 12) return `${months} months ago`;
      if (months < 18) return '1 year ago';
      return `${years} years ago`;
    } catch { return iso; }
  }

  copyLogsForAI(): void {
    const logs = this.logs();
    if (!logs.length) { this.toast.info('No logs to copy'); return; }
    const siteName = this.logsModalSiteName() || 'unknown';
    const lines: string[] = [];
    lines.push(`# Site Logs: ${siteName}`);
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push(`Total entries: ${logs.length}`);
    lines.push('');
    lines.push('| # | Timestamp (UTC) | Action | Label | Message | Metadata |');
    lines.push('|---|----------------|--------|-------|---------|----------|');
    logs.forEach((log, i) => {
      const label = this.formatLogAction(log.action);
      let meta: Record<string, unknown> = {};
      try { meta = log.metadata_json ? JSON.parse(log.metadata_json) : {}; } catch {}
      const msg = (meta['message'] || '') as string;
      const metaKeys = Object.keys(meta).filter((k) => k !== 'message');
      const metaStr = metaKeys.map((k) => `${k}=${JSON.stringify(meta[k])}`).join(', ').replace(/\|/g, '/').substring(0, 200);
      lines.push(`| ${i + 1} | ${log.created_at || ''} | \`${log.action}\` | ${label} | ${msg.replace(/\|/g, '/')} | ${metaStr} |`);
    });
    lines.push('');
    lines.push('## Raw JSON');
    lines.push('```json');
    lines.push(JSON.stringify(logs.map((l) => {
      let m: Record<string, unknown> = {};
      try { m = l.metadata_json ? JSON.parse(l.metadata_json) : {}; } catch {}
      return { time: l.created_at, action: l.action, label: this.formatLogAction(l.action), metadata: m };
    }), null, 2));
    lines.push('```');
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success(`Logs copied (${logs.length} entries)`);
    });
  }

  // ─── Files modal ──────────────────────────────────────

  openFiles(site: Site): void {
    this.filesModalSiteId.set(site.id);
    this.filesModalSiteName.set(site.business_name);
    this.editingFile.set(null);
    this.loadFiles(site.id);
    this.closeDropdowns();
  }

  closeFiles(): void {
    this.filesModalSiteId.set(null);
    this.files.set([]);
    this.editingFile.set(null);
  }

  private loadFiles(siteId: string): void {
    this.loadingFiles.set(true);
    this.api.listFiles(siteId).subscribe({
      next: (res: any) => {
        // API returns { data: { files: [...], prefix, version } }
        const raw = res.data;
        const files: SiteFile[] = Array.isArray(raw) ? raw : (raw?.files || []);
        this.files.set(files);
        this.fileTree.set(this.buildFileTree(files));
        this.loadingFiles.set(false);
      },
      error: () => {
        this.loadingFiles.set(false);
        this.toast.error('Failed to load files');
      },
    });
  }

  private buildFileTree(files: SiteFile[]): FileTreeNode[] {
    const root: FileTreeNode[] = [];
    for (const file of files) {
      // Strip "sites/{slug}/{version}/" prefix
      const parts = file.key.split('/');
      const relParts = parts.length > 3 ? parts.slice(3) : [parts[parts.length - 1]];

      let current = root;
      for (let i = 0; i < relParts.length; i++) {
        const part = relParts[i];
        const isLast = i === relParts.length - 1;

        if (isLast) {
          current.push({ name: part, key: file.key, size: file.size, isDir: false, expanded: false, children: [] });
        } else {
          let dir = current.find((n) => n.isDir && n.name === part);
          if (!dir) {
            dir = { name: part, isDir: true, expanded: true, children: [] };
            current.push(dir);
          }
          current = dir.children;
        }
      }
    }
    // Sort: dirs first, then files alphabetically
    const sortTree = (nodes: FileTreeNode[]): void => {
      nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach((n) => { if (n.isDir) sortTree(n.children); });
    };
    sortTree(root);
    return root;
  }

  toggleTreeDir(node: FileTreeNode): void {
    node.expanded = !node.expanded;
  }

  selectTreeFile(node: FileTreeNode): void {
    if (node.isDir || !node.key) return;
    const file = this.files().find((f) => f.key === node.key);
    if (file) this.openFileEditor(file);
  }

  getFileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const s = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    if (ext === 'html') return `<svg ${s}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    if (ext === 'css') return `<svg ${s}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/></svg>`;
    if (ext === 'js' || ext === 'ts' || ext === 'mjs') return `<svg ${s}><path d="m10 12 8-6v12z"/></svg>`;
    if (ext === 'json') return `<svg ${s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>`;
    if (/^(png|jpg|jpeg|gif|svg|webp|ico)$/.test(ext)) return `<svg ${s}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
    return `<svg ${s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
  }

  getFileName(key: string): string {
    return key.split('/').pop() || key;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  isEditableFile(key: string): boolean {
    return /\.(html|css|js|json|txt|md|xml|svg|mjs|ts|jsx|tsx)$/i.test(key);
  }

  openFileEditor(file: SiteFile): void {
    if (!this.isEditableFile(file.key)) return;
    const siteId = this.filesModalSiteId();
    if (!siteId) return;

    this.editingFile.set(file);
    this.fileContent = 'Loading...';
    this.api.getFileContent(siteId, file.key).subscribe({
      next: (res) => { this.fileContent = res.data?.content || ''; },
      error: () => {
        this.fileContent = '';
        this.toast.error('Failed to load file');
      },
    });
  }

  closeFileEditor(): void {
    this.editingFile.set(null);
  }

  onEditorKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      this.saveFileContent();
    }
  }

  saveFileContent(): void {
    const siteId = this.filesModalSiteId();
    const file = this.editingFile();
    if (!siteId || !file) return;

    this.savingFile.set(true);
    this.api.saveFile(siteId, file.key, this.fileContent).subscribe({
      next: () => {
        this.savingFile.set(false);
        this.toast.success('File saved');
      },
      error: () => {
        this.savingFile.set(false);
        this.toast.error('Failed to save file');
      },
    });
  }

  deleteFileItem(file: SiteFile): void {
    const siteId = this.filesModalSiteId();
    if (!siteId) return;

    this.api.deleteFile(siteId, file.key).subscribe({
      next: () => {
        this.files.update((f) => f.filter((item) => item.key !== file.key));
        if (this.editingFile()?.key === file.key) this.editingFile.set(null);
        this.toast.success('File deleted');
      },
      error: () => this.toast.error('Failed to delete file'),
    });
  }

  // ─── File editor enhancements ────────────────────────

  fileAiPrompt = '';
  fileAiProcessing = signal(false);
  treeDragOver = signal(false);

  promptNewFile(): void {
    const name = prompt('New file name (e.g., styles.css):');
    if (!name?.trim()) return;
    const siteId = this.filesModalSiteId();
    if (!siteId) return;
    // Determine prefix from existing files
    const firstFile = this.files()[0];
    const prefix = firstFile ? firstFile.key.split('/').slice(0, 3).join('/') + '/' : '';
    const key = prefix + name.trim();
    this.api.saveFile(siteId, key, '').subscribe({
      next: () => {
        this.toast.success(`Created ${name}`);
        this.loadFiles(siteId);
      },
      error: () => this.toast.error('Failed to create file'),
    });
  }

  promptNewFolder(): void {
    const name = prompt('New folder name:');
    if (!name?.trim()) return;
    const siteId = this.filesModalSiteId();
    if (!siteId) return;
    const firstFile = this.files()[0];
    const prefix = firstFile ? firstFile.key.split('/').slice(0, 3).join('/') + '/' : '';
    const key = prefix + name.trim() + '/.gitkeep';
    this.api.saveFile(siteId, key, '').subscribe({
      next: () => {
        this.toast.success(`Created folder ${name}`);
        this.loadFiles(siteId);
      },
      error: () => this.toast.error('Failed to create folder'),
    });
  }

  deleteTreeFile(node: FileTreeNode, event: Event): void {
    event.stopPropagation();
    if (!node.key) return;
    if (!confirm(`Delete ${node.name}?`)) return;
    const file = this.files().find(f => f.key === node.key);
    if (file) this.deleteFileItem(file);
  }

  deleteCurrentFile(): void {
    const file = this.editingFile();
    if (!file) return;
    if (!confirm(`Delete ${this.getFileName(file.key)}?`)) return;
    this.deleteFileItem(file);
  }

  startRenameFile(node: FileTreeNode, event: Event): void {
    event.stopPropagation();
    const newName = prompt('Rename to:', node.name);
    if (!newName?.trim() || newName === node.name) return;
    // Rename = copy content to new key + delete old key
    const siteId = this.filesModalSiteId();
    if (!siteId || !node.key) return;
    const oldKey = node.key;
    const newKey = oldKey.substring(0, oldKey.lastIndexOf('/') + 1) + newName.trim();
    this.api.getFileContent(siteId, oldKey).subscribe({
      next: (res) => {
        this.api.saveFile(siteId, newKey, res.data?.content || '').subscribe({
          next: () => {
            this.api.deleteFile(siteId, oldKey).subscribe({
              next: () => {
                this.toast.success(`Renamed to ${newName}`);
                this.loadFiles(siteId);
              },
            });
          },
          error: () => this.toast.error('Rename failed'),
        });
      },
    });
  }

  startRenameCurrentFile(event: Event): void {
    const file = this.editingFile();
    if (!file) return;
    const currentName = this.getFileName(file.key);
    const newName = prompt('Rename to:', currentName);
    if (!newName?.trim() || newName === currentName) return;
    const siteId = this.filesModalSiteId();
    if (!siteId) return;
    const newKey = file.key.substring(0, file.key.lastIndexOf('/') + 1) + newName.trim();
    this.api.saveFile(siteId, newKey, this.fileContent).subscribe({
      next: () => {
        this.api.deleteFile(siteId, file.key).subscribe({
          next: () => {
            this.toast.success(`Renamed to ${newName}`);
            this.loadFiles(siteId);
            this.editingFile.set(null);
          },
        });
      },
      error: () => this.toast.error('Rename failed'),
    });
  }

  runFileAiPrompt(): void {
    if (!this.fileAiPrompt.trim() || this.fileAiProcessing()) return;
    const file = this.editingFile();
    if (!file) return;
    this.fileAiProcessing.set(true);
    // Use Workers AI to modify the file content
    const siteId = this.filesModalSiteId();
    if (!siteId) { this.fileAiProcessing.set(false); return; }
    this.toast.info('AI is modifying the file...');
    // For now, use a simple toast — full AI integration would call a backend endpoint
    setTimeout(() => {
      this.fileAiProcessing.set(false);
      this.toast.info('AI file editing coming soon');
    }, 2000);
  }

  // Drag-drop support
  onTreePanelDragOver(event: DragEvent): void {
    event.preventDefault();
    this.treeDragOver.set(true);
  }

  onTreePanelDrop(event: DragEvent): void {
    event.preventDefault();
    this.treeDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    this.handleDroppedFiles(files, '');
  }

  onTreeDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onTreeDrop(event: DragEvent, node: FileTreeNode): void {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    // If dropping on a file, use its directory
    const dir = node.key ? node.key.substring(0, node.key.lastIndexOf('/') + 1) : '';
    this.handleDroppedFiles(files, dir);
  }

  onEditorDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onEditorDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const file = files[0];
    if (file.type.startsWith('text/') || /\.(html|css|js|json|md|txt|xml|svg)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        if (this.fileContent.trim() && !confirm(`Overwrite current content with ${file.name}?`)) return;
        this.fileContent = content;
        this.toast.success(`Imported ${file.name}`);
      };
      reader.readAsText(file);
    }
  }

  private handleDroppedFiles(files: FileList, dirPrefix: string): void {
    const siteId = this.filesModalSiteId();
    if (!siteId) return;
    const firstFile = this.files()[0];
    const basePrefix = firstFile ? firstFile.key.split('/').slice(0, 3).join('/') + '/' : '';
    const fullPrefix = basePrefix + dirPrefix;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = fullPrefix + file.name;
      // Check if file already exists
      const exists = this.files().some(f => f.key === key);
      if (exists && !confirm(`Overwrite ${file.name}?`)) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        this.api.saveFile(siteId, key, content).subscribe({
          next: () => {
            this.toast.success(`Uploaded ${file.name}`);
            this.loadFiles(siteId);
          },
          error: () => this.toast.error(`Failed to upload ${file.name}`),
        });
      };
      reader.readAsText(file);
    }
  }

  // ─── Deploy modal ─────────────────────────────────────

  openDeploy(site: Site): void {
    this.deployModalSiteId.set(site.id);
    this.deployModalSiteName.set(site.business_name);
    this.deployFile = null;
    this.deployFileName.set('');
    this.closeDropdowns();
  }

  closeDeploy(): void {
    this.deployModalSiteId.set(null);
    this.deployFile = null;
    this.deployFileName.set('');
  }

  onDeployFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.deployFile = file;
      this.deployFileName.set(`${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
    }
  }

  submitDeploy(): void {
    const siteId = this.deployModalSiteId();
    if (!siteId || !this.deployFile) {
      this.toast.error('Please select a ZIP file');
      return;
    }

    this.deploying.set(true);
    const formData = new FormData();
    formData.append('zip', this.deployFile);

    this.api.deploySite(siteId, formData).subscribe({
      next: () => {
        this.deploying.set(false);
        this.toast.success('Site deployed successfully');
        this.closeDeploy();
        this.loadData();
      },
      error: () => {
        this.deploying.set(false);
        this.toast.error('Deploy failed');
      },
    });
  }

  // ─── Reset modal ──────────────────────────────────────

  openReset(site: Site): void {
    this.closeDropdowns();
    // Store original business data so the create page can restore it
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

  closeReset(): void {
    this.resetModalSite.set(null);
  }

  onResetBusinessInput(): void {
    this.resetBusinessSubject.next(this.resetName);
  }

  selectResetBusiness(biz: BusinessResult): void {
    this.resetName = biz.name;
    this.resetAddress = biz.address;
    this.resetBusinessDropdownOpen.set(false);
  }

  closeResetBusinessDropdown(): void {
    setTimeout(() => this.resetBusinessDropdownOpen.set(false), 200);
  }

  onResetAddressInput(): void {
    this.resetAddressSubject.next(this.resetAddress);
  }

  selectResetAddress(addr: { description: string }): void {
    this.resetAddress = addr.description;
    this.resetAddressDropdownOpen.set(false);
  }

  closeResetAddressDropdown(): void {
    setTimeout(() => this.resetAddressDropdownOpen.set(false), 200);
  }

  submitReset(): void {
    const site = this.resetModalSite();
    if (!site || !this.resetName.trim()) return;

    this.resetting.set(true);
    this.api.resetSite(site.id, {
      business: { name: this.resetName, address: this.resetAddress },
      additional_context: this.resetContext || undefined,
    }).subscribe({
      next: () => {
        this.resetting.set(false);
        this.closeReset();
        this.toast.success('Reset triggered — rebuilding site...');
        this.router.navigate(['/waiting'], { queryParams: { id: site.id, slug: site.slug } });
      },
      error: () => {
        this.resetting.set(false);
        this.toast.error('Reset failed');
      },
    });
  }
}
