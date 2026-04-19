import { Component, OnInit, OnDestroy, inject, signal, HostListener } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, filter } from 'rxjs';
import { ApiService, Site } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { AdminStateService } from './admin-state.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, RouterModule],
  providers: [AdminStateService],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  siteDropdownOpen = signal(false);
  sidebarCollapsed = signal(false);
  isEditorRoute = signal(false);
  editorSaving = signal(false);
  currentSection = signal('Dashboard');

  private routerSub?: Subscription;

  // Deploy modal
  deployModalSiteId = signal<string | null>(null);
  deployModalSiteName = signal('');
  deployFile: File | null = null;
  deployFileName = signal('');
  deploying = signal(false);

  // Delete modal
  deletingSite = signal<Site | null>(null);
  deleteCancelSub = false;

  private api = inject(ApiService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deletingSite()) { this.cancelDelete(); return; }
    if (this.deployModalSiteId()) { this.closeDeploy(); return; }
  }

  private updateRouteState(url: string): void {
    this.isEditorRoute.set(url.includes('/admin/editor'));
    const segment = url.split('/').pop() || '';
    const labels: Record<string, string> = {
      '': 'Dashboard', 'admin': 'Dashboard', 'editor': 'Editor',
      'domains': 'Domains', 'snapshots': 'Snapshots', 'analytics': 'Analytics',
      'seo': 'SEO', 'billing': 'Billing', 'audit': 'Audit Log', 'settings': 'Settings',
    };
    this.currentSection.set(labels[segment] || 'Dashboard');
  }

  ngOnInit(): void {
    this.updateRouteState(this.router.url);
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.updateRouteState(e.urlAfterRedirects));

    if (!this.auth.isLoggedIn()) {
      this.state.loading.set(false);
      return;
    }
    this.state.loadData();
    this.state.startPolling();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.state.stopPolling();
  }

  // ── Editor save ─────────────────────────────────────

  saveEditor(): void {
    const iframe = document.querySelector('.editor-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) {
      this.toast.error('Editor not ready');
      return;
    }
    this.editorSaving.set(true);
    iframe.contentWindow.postMessage({
      type: 'PS_REQUEST_FILES',
      includeChat: true,
      correlationId: crypto.randomUUID(),
    }, '*');
    this.toast.info('Saving files from editor...');
    // Reset saving state after a timeout (actual save is handled by editor component's message listener)
    setTimeout(() => this.editorSaving.set(false), 10000);
  }

  // ── Sidebar ─────────────────────────────────────────

  toggleSiteDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.siteDropdownOpen.update(v => !v);
  }

  closeSiteDropdown(): void {
    this.siteDropdownOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  closeDropdowns(): void {
    this.siteDropdownOpen.set(false);
  }

  selectSite(site: Site): void {
    this.state.selectSite(site);
    this.siteDropdownOpen.set(false);
  }

  // ── Deploy modal ────────────────────────────────────

  openDeploy(site: Site): void {
    this.deployModalSiteId.set(site.id);
    this.deployModalSiteName.set(site.business_name);
    this.deployFile = null;
    this.deployFileName.set('');
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
        this.state.loadData();
      },
      error: () => {
        this.deploying.set(false);
        this.toast.error('Deploy failed');
      },
    });
  }

  // ── Delete modal ────────────────────────────────────

  confirmDelete(site: Site): void {
    this.deletingSite.set(site);
    this.deleteCancelSub = false;
  }

  cancelDelete(): void {
    this.deletingSite.set(null);
  }

  deleteSite(): void {
    const site = this.deletingSite();
    if (!site) return;
    this.state.deleteSite(site, this.deleteCancelSub);
    this.deletingSite.set(null);
  }
}
