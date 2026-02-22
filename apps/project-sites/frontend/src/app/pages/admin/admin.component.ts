import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval, takeWhile, switchMap, forkJoin } from 'rxjs';
import { ApiService, Site, DomainSummary, Hostname } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  sites = signal<Site[]>([]);
  domainSummary = signal<DomainSummary>({ total: 0, active: 0, pending: 0, failed: 0 });
  loading = signal(true);
  alive = true;

  // Inline edit state
  editingSiteId = signal<string | null>(null);
  editingField = signal<'name' | 'slug' | null>(null);
  editValue = '';

  // Domain modal
  domainModalSiteId = signal<string | null>(null);
  hostnames = signal<Hostname[]>([]);
  newHostname = '';
  loadingHostnames = signal(false);

  // Logs modal
  logsModalSiteId = signal<string | null>(null);
  logs = signal<{ action: string; created_at: string; metadata?: string }[]>([]);
  loadingLogs = signal(false);

  // Delete confirm
  deletingSiteId = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    this.loadData();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.alive = false;
  }

  private loadData(): void {
    forkJoin({
      sites: this.api.listSites(),
      domains: this.api.getDomainSummary(),
    }).subscribe({
      next: (res) => {
        this.sites.set(res.sites.data || []);
        this.domainSummary.set(res.domains.data || { total: 0, active: 0, pending: 0, failed: 0 });
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
        takeWhile(() => this.alive && this.sites().some((s) => ['building', 'queued', 'generating', 'uploading'].includes(s.status))),
        switchMap(() => this.api.listSites())
      )
      .subscribe({
        next: (res) => {
          this.sites.set(res.data || []);
        },
      });
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      published: 'published',
      building: 'building',
      queued: 'building',
      collecting: 'collecting',
      generating: 'generating',
      uploading: 'uploading',
      error: 'error',
      failed: 'error',
      draft: 'draft',
    };
    return map[status] || 'draft';
  }

  getSiteUrl(site: Site): string {
    if (site.primary_hostname) return `https://${site.primary_hostname}`;
    return `https://${site.slug}-sites.megabyte.space`;
  }

  visitSite(site: Site): void {
    window.open(this.getSiteUrl(site), '_blank');
  }

  newSite(): void {
    this.router.navigate(['/']);
  }

  // --- Inline editing ---
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
      error: (err) => {
        this.toast.error(err?.error?.message || 'Update failed');
      },
    });
  }

  // --- Delete ---
  confirmDelete(siteId: string): void {
    this.deletingSiteId.set(siteId);
  }

  cancelDelete(): void {
    this.deletingSiteId.set(null);
  }

  deleteSite(siteId: string): void {
    this.api.deleteSite(siteId).subscribe({
      next: () => {
        this.sites.update((sites) => sites.filter((s) => s.id !== siteId));
        this.deletingSiteId.set(null);
        this.toast.success('Site deleted');
      },
      error: () => this.toast.error('Failed to delete site'),
    });
  }

  // --- Domain modal ---
  openDomains(siteId: string): void {
    this.domainModalSiteId.set(siteId);
    this.loadHostnames(siteId);
  }

  closeDomains(): void {
    this.domainModalSiteId.set(null);
    this.hostnames.set([]);
    this.newHostname = '';
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
        this.toast.success('Domain added');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to add domain'),
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

  // --- Logs modal ---
  openLogs(siteId: string): void {
    this.logsModalSiteId.set(siteId);
    this.loadLogs(siteId);
  }

  closeLogs(): void {
    this.logsModalSiteId.set(null);
    this.logs.set([]);
  }

  private loadLogs(siteId: string): void {
    this.loadingLogs.set(true);
    this.api.getSiteLogs(siteId).subscribe({
      next: (res) => {
        this.logs.set(
          (res.data || []).map((l) => ({
            action: this.formatLogAction(l.action),
            created_at: l.created_at,
            metadata: l.metadata_json,
          }))
        );
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
      'workflow.started': 'Build Started',
      'workflow.completed': 'Build Completed',
      'workflow.failed': 'Build Failed',
      'workflow.step.profile_research_complete': 'Profile Research Done',
      'workflow.step.generate_website_complete': 'Website Generated',
      'workflow.step.upload_complete': 'Upload Complete',
      'hostname.added': 'Domain Added',
      'hostname.verified': 'Domain Verified',
      'billing.checkout_created': 'Checkout Started',
      'billing.subscription_active': 'Subscription Active',
    };
    return map[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
