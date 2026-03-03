import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval, takeWhile, switchMap, forkJoin } from 'rxjs';
import {
  IonButton, IonBadge, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridReadyEvent, GridApi, ICellRendererParams } from 'ag-grid-community';
import { ApiService, Site, DomainSummary, SubscriptionInfo } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { DeleteModalComponent } from '../../modals/delete-modal.component';
import { DomainModalComponent } from '../../modals/domain-modal.component';
import { LogsModalComponent } from '../../modals/logs-modal.component';
import { ResetModalComponent } from '../../modals/reset-modal.component';
import { DetailsModalComponent } from '../../modals/details-modal.component';
import { FilesModalComponent } from '../../modals/files-modal.component';
import { DeployModalComponent } from '../../modals/deploy-modal.component';
import { StatusModalComponent } from '../../modals/status-modal.component';
import { CheckoutModalComponent } from '../../modals/checkout-modal.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, IonButton, IonBadge, IonSpinner, AgGridAngular],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private modalCtrl = inject(ModalController);

  sites = signal<Site[]>([]);
  domainSummary = signal<DomainSummary>({ total: 0, active: 0, pending: 0, failed: 0 });
  subscription = signal<SubscriptionInfo | null>(null);
  loading = signal(true);
  alive = true;
  private gridApi: GridApi | null = null;

  columnDefs: ColDef<Site>[] = [
    {
      headerName: 'Status',
      field: 'status',
      width: 110,
      cellRenderer: (params: ICellRendererParams) => {
        const colors: Record<string, string> = {
          published: '#22c55e', building: '#fbbf24', queued: '#fbbf24',
          generating: '#a78bfa', error: '#ef4444', draft: '#94a3b8',
        };
        const color = colors[params.value] || '#94a3b8';
        return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase;background:${color}22;color:${color}">${params.value}</span>`;
      },
    },
    {
      headerName: 'Business Name',
      field: 'business_name',
      flex: 2,
      editable: true,
    },
    {
      headerName: 'Slug',
      field: 'slug',
      flex: 1,
      editable: true,
    },
    {
      headerName: 'Plan',
      field: 'plan',
      width: 80,
      cellRenderer: (params: ICellRendererParams) => {
        if (!params.value) return '';
        const color = params.value === 'paid' ? '#22c55e' : '#94a3b8';
        return `<span style="font-size:0.65rem;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase;background:${color}1f;color:${color}">${params.value}</span>`;
      },
    },
    {
      headerName: 'Actions',
      width: 340,
      suppressSizeToFit: true,
      cellRenderer: () => '',
    },
  ];

  defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
  };

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

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    event.api.sizeColumnsToFit();
  }

  onCellEditingStopped(event: { data: Site; colDef: ColDef; newValue: string; oldValue: string }): void {
    if (event.newValue === event.oldValue) return;
    const field = event.colDef.field;
    if (!field) return;
    const body: Partial<Site> = field === 'business_name'
      ? { business_name: event.newValue }
      : { slug: event.newValue };

    this.api.updateSite(event.data.id, body).subscribe({
      next: (res) => {
        this.sites.update((sites) =>
          sites.map((s) => (s.id === event.data.id ? { ...s, ...res.data } : s))
        );
        this.toast.success('Updated successfully');
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Update failed');
        this.loadData();
      },
    });
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

    this.api.getSubscription().subscribe({
      next: (res) => this.subscription.set(res.data),
      error: () => { /* subscription check may fail for free users */ },
    });
  }

  private startPolling(): void {
    interval(5000)
      .pipe(
        takeWhile(() => this.alive && this.sites().some((s) =>
          ['building', 'queued', 'generating', 'uploading'].includes(s.status))),
        switchMap(() => this.api.listSites())
      )
      .subscribe({
        next: (res) => this.sites.set(res.data || []),
      });
  }

  newSite(): void {
    this.router.navigate(['/']);
  }

  visitSite(site: Site): void {
    const url = site.primary_hostname
      ? `https://${site.primary_hostname}`
      : `https://${site.slug}.projectsites.dev`;
    window.open(url, '_blank');
  }

  async openDetails(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DetailsModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'updated' && data) {
      this.sites.update((sites) => sites.map((s) => s.id === data.id ? data : s));
    }
  }

  async openDomains(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DomainModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openLogs(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: LogsModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openStatus(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: StatusModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openFiles(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: FilesModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal-fullscreen',
    });
    await modal.present();
  }

  async openDeploy(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeployModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'deployed') this.loadData();
  }

  async openReset(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ResetModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'reset' && data) {
      this.sites.update((sites) => sites.map((s) => s.id === data.id ? data : s));
    }
  }

  async openDelete(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeleteModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'deleted' && data) {
      this.sites.update((sites) => sites.filter((s) => s.id !== data));
    }
  }

  async openCheckout(site: Site): Promise<void> {
    const me = await this.api.getMe().toPromise();
    if (!me?.data?.org_id) {
      this.toast.error('Unable to load billing info');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: CheckoutModalComponent,
      componentProps: { site, orgId: me.data.org_id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openBillingPortal(): Promise<void> {
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res) => {
        if (res.data.portal_url) {
          window.location.href = res.data.portal_url;
        }
      },
      error: () => this.toast.error('Failed to open billing portal'),
    });
  }

  getSubscriptionLabel(): string {
    const sub = this.subscription();
    if (!sub) return 'Free Plan';
    return sub.plan === 'paid' ? 'Pro Plan' : 'Free Plan';
  }
}
