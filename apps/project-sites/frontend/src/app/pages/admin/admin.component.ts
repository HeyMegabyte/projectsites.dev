import { Component, type OnInit, type OnDestroy, inject, signal } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, filter } from 'rxjs';
import { ApiService, type Site } from '../../services/api.service';
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
  siteSearchQuery = signal('');
  sidebarCollapsed = signal(false);
  isEditorRoute = signal(false);
  editorSaving = signal(false);
  currentSection = signal('Dashboard');

  private routerSub?: Subscription;

  private api = inject(ApiService);

  private updateRouteState(url: string): void {
    this.isEditorRoute.set(url === '/admin' || url.startsWith('/admin/editor'));
    const segment = url.split('/').pop() || '';
    const labels: Record<string, string> = {
      '': 'Editor', 'admin': 'Editor', 'editor': 'Editor',
      'snapshots': 'Snapshots', 'analytics': 'Analytics',
      'forms': 'Forms', 'ai-logs': 'AI Logs', 'ai-chat': 'AI Chat',
      'ai-endpoints': 'AI Endpoints',
      'billing': 'Billing', 'audit': 'Audit Log', 'settings': 'Settings',
    };
    this.currentSection.set(labels[segment] || 'Editor');
    // Fire CF Analytics Engine data point per route change (fire-and-forget).
    this.api.post('/analytics/track', {
      route: url.split('?')[0],
      site_id: this.state.selectedSite()?.id ?? null,
    }).subscribe({ error: () => {} });
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
    setTimeout(() => this.editorSaving.set(false), 10000);
  }

  // ── Sidebar ─────────────────────────────────────────

  toggleSiteDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.siteDropdownOpen.update(v => !v);
    if (!this.siteDropdownOpen()) {
      this.siteSearchQuery.set('');
    }
  }

  get filteredSites(): Site[] {
    const q = this.siteSearchQuery().toLowerCase().trim();
    if (!q) return this.state.sites();
    return this.state.sites().filter(s =>
      (s.business_name || '').toLowerCase().includes(q) ||
      (s.slug || '').toLowerCase().includes(q)
    );
  }

  closeSiteDropdown(): void {
    this.siteDropdownOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  closeDropdowns(): void {
    this.siteDropdownOpen.set(false);
    this.siteSearchQuery.set('');
  }

  selectSite(site: Site): void {
    this.state.selectSite(site);
    this.siteDropdownOpen.set(false);
  }
}
