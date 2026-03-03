import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonList, IonItem, IonLabel, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, LogEntry } from '../services/api.service';
import { ToastService } from '../services/toast.service';

interface DisplayLog {
  action: string;
  created_at: string;
  relativeTime: string;
  metadata?: string;
}

@Component({
  selector: 'app-logs-modal',
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonList, IonItem, IonLabel, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Build Logs</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="copyLogsForAI()">Copy for AI</ion-button>
          <ion-button (click)="refresh()">Refresh</ion-button>
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
        <div class="modal-loading"><ion-spinner name="crescent"></ion-spinner> Loading logs...</div>
      } @else if (logs().length === 0) {
        <p class="empty-text">No logs yet.</p>
      } @else {
        <ion-list lines="none" class="logs-list">
          @for (log of logs(); track log.created_at) {
            <ion-item class="log-entry">
              <ion-label>
                <p class="log-time">{{ log.relativeTime }}</p>
                <h3 class="log-action">{{ log.action }}</h3>
              </ion-label>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: [`
    .modal-loading {
      text-align: center; padding: 40px; color: var(--text-muted);
      display: flex; align-items: center; justify-content: center; gap: 12px;
    }
    .empty-text { text-align: center; padding: 20px; color: var(--text-muted); }
    .logs-list { max-height: 60vh; overflow-y: auto; }
    .log-entry {
      --padding-start: 12px;
      --padding-end: 12px;
      .log-time { font-size: 0.75rem; color: var(--text-muted); }
      .log-action { font-size: 0.88rem; color: var(--text-secondary); font-weight: 500; }
    }
  `],
})
export class LogsModalComponent implements OnInit, OnDestroy {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  logs = signal<DisplayLog[]>([]);
  loading = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadLogs();
    this.timer = setInterval(() => this.updateRelativeTimes(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  refresh(): void {
    this.loadLogs();
  }

  copyLogsForAI(): void {
    const text = this.logs()
      .map((l) => `[${l.created_at}] ${l.action}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(
      () => this.toast.success('Logs copied to clipboard'),
      () => this.toast.error('Failed to copy logs')
    );
  }

  private loadLogs(): void {
    this.loading.set(true);
    this.api.getSiteLogs(this.siteId).subscribe({
      next: (res) => {
        this.logs.set(
          (res.data || []).map((l) => ({
            action: this.formatLogAction(l.action),
            created_at: l.created_at,
            relativeTime: this.formatRelativeTime(l.created_at),
            metadata: l.metadata_json,
          }))
        );
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load logs');
      },
    });
  }

  private updateRelativeTimes(): void {
    this.logs.update((logs) =>
      logs.map((l) => ({ ...l, relativeTime: this.formatRelativeTime(l.created_at) }))
    );
  }

  private formatLogAction(action: string): string {
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

  private formatRelativeTime(iso: string): string {
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
