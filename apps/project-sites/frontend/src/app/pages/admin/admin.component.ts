import { Component, OnInit, OnDestroy, inject, signal, HostListener } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
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

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.state.loading.set(false);
      return;
    }
    this.state.loadData();
    this.state.startPolling();
  }

  ngOnDestroy(): void {
    this.state.stopPolling();
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
