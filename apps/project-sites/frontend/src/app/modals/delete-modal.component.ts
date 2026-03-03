import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-delete-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Delete Site</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Cancel</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="delete-warning">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <h3>This action cannot be undone</h3>
        <p>The site <strong>{{ site.business_name }}</strong> and all its data will be permanently deleted.</p>
        <div class="input-group">
          <label>Type the site name to confirm</label>
          <input
            type="text"
            class="input-field"
            [placeholder]="site.business_name || ''"
            [(ngModel)]="confirmText"
          />
        </div>
        <ion-button
          expand="block"
          color="danger"
          [disabled]="confirmText !== site.business_name || deleting()"
          (click)="confirmDelete()"
        >
          @if (deleting()) { Deleting... } @else { Delete Permanently }
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: [`
    .delete-warning {
      text-align: center;
      padding: 20px 0;
      svg { color: var(--error); margin-bottom: 16px; }
      h3 { font-size: 1.1rem; margin-bottom: 8px; color: var(--error); }
      p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 24px; }
    }
  `],
})
export class DeleteModalComponent {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  confirmText = '';
  deleting = signal(false);

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirmDelete(): void {
    if (this.confirmText !== this.site.business_name) return;
    this.deleting.set(true);
    this.api.deleteSite(this.site.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toast.success('Site deleted');
        this.modalCtrl.dismiss(this.site.id, 'deleted');
      },
      error: () => {
        this.deleting.set(false);
        this.toast.error('Failed to delete site');
      },
    });
  }
}
