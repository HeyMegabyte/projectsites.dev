import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { interval, takeWhile, switchMap } from 'rxjs';
import { ApiService, Site, WorkflowStatus } from '../services/api.service';

@Component({
  selector: 'app-status-modal',
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Build Status</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="status-terminal">
        <div class="terminal-header">
          <div class="terminal-dots">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
          </div>
          <span class="terminal-title">{{ site.business_name }}</span>
        </div>
        <div class="terminal-body">
          <div class="status-line">
            <span class="label">Site Status:</span>
            <span class="value" [class]="'status-' + site.status">{{ site.status }}</span>
          </div>
          @if (workflow()) {
            <div class="status-line">
              <span class="label">Workflow:</span>
              <span class="value">{{ workflow()!.status }}</span>
            </div>
            @if (workflow()!.current_step) {
              <div class="status-line">
                <span class="label">Current Step:</span>
                <span class="value">{{ workflow()!.current_step }}</span>
              </div>
            }
            @if (workflow()!.steps) {
              <div class="workflow-steps">
                @for (step of workflow()!.steps; track step.name) {
                  <div class="workflow-step" [class]="'ws-' + step.status">
                    <span class="ws-indicator">
                      @if (step.status === 'completed') { ✓ }
                      @else if (step.status === 'running') { <ion-spinner name="dots" class="ws-spinner"></ion-spinner> }
                      @else if (step.status === 'failed') { ✗ }
                      @else { · }
                    </span>
                    <span>{{ step.name }}</span>
                  </div>
                }
              </div>
            }
            @if (workflow()!.error) {
              <div class="error-box">{{ workflow()!.error }}</div>
            }
          } @else if (loading()) {
            <div class="loading-row"><ion-spinner name="crescent"></ion-spinner> Loading workflow status...</div>
          }
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .status-terminal { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
    .terminal-header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; background: rgba(0,0,0,0.3);
      border-bottom: 1px solid var(--border);
    }
    .terminal-dots { display: flex; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .red { background: #ff5f57; } .yellow { background: #febc2e; } .green { background: #28c840; }
    .terminal-title { font-size: 0.82rem; color: var(--text-muted); font-family: monospace; }
    .terminal-body { padding: 16px; font-family: 'Menlo', 'Consolas', monospace; font-size: 0.85rem; }
    .status-line { display: flex; gap: 8px; padding: 4px 0; }
    .label { color: var(--text-muted); }
    .value { color: var(--text-primary); }
    .status-published { color: var(--success); }
    .status-building, .status-queued { color: #fbbf24; }
    .status-error { color: var(--error); }
    .workflow-steps { margin-top: 12px; }
    .workflow-step {
      display: flex; align-items: center; gap: 8px; padding: 4px 0;
      color: var(--text-muted);
    }
    .ws-completed { color: var(--success); }
    .ws-running { color: var(--accent); }
    .ws-failed { color: var(--error); }
    .ws-indicator { width: 20px; text-align: center; }
    .ws-spinner { width: 14px; height: 14px; }
    .error-box {
      margin-top: 12px; padding: 10px; background: var(--error-dim);
      border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;
      color: var(--error); font-size: 0.82rem;
    }
    .loading-row { display: flex; align-items: center; gap: 8px; color: var(--text-muted); padding: 12px 0; }
  `],
})
export class StatusModalComponent implements OnInit, OnDestroy {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);

  site!: Site;
  workflow = signal<WorkflowStatus | null>(null);
  loading = signal(true);
  private alive = true;

  ngOnInit(): void {
    this.loadStatus();
    if (['building', 'queued', 'generating', 'uploading'].includes(this.site.status)) {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.alive = false;
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  private loadStatus(): void {
    this.api.getWorkflowStatus(this.site.id).subscribe({
      next: (res) => {
        this.workflow.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private startPolling(): void {
    interval(5000)
      .pipe(
        takeWhile(() => this.alive),
        switchMap(() => this.api.getWorkflowStatus(this.site.id))
      )
      .subscribe({
        next: (res) => {
          this.workflow.set(res.data);
          if (['completed', 'failed'].includes(res.data.status)) {
            this.alive = false;
          }
        },
      });
  }
}
