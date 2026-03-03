import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-reset-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Reset & Rebuild</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Cancel</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="reset-info">This will regenerate <strong>{{ site.business_name }}</strong> with AI. The current site will be replaced.</p>
      <div class="input-group">
        <label>Additional Context <span class="label-hint">(optional)</span></label>
        <textarea
          class="input-field"
          placeholder="Any changes you'd like? Different style, new services, updated info..."
          [(ngModel)]="additionalContext"
          rows="4"
          maxlength="5000"
        ></textarea>
        <span class="char-count">{{ additionalContext.length }} / 5000</span>
      </div>
      <ion-button
        expand="block"
        fill="solid"
        color="warning"
        [disabled]="resetting()"
        (click)="submitReset()"
      >
        @if (resetting()) {
          <ion-spinner name="crescent" slot="start"></ion-spinner> Resetting...
        } @else {
          Reset & Rebuild
        }
      </ion-button>
    </ion-content>
  `,
  styles: [`
    .reset-info { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px; line-height: 1.5; }
    .label-hint { font-weight: 400; font-size: 0.75rem; color: var(--text-muted); text-transform: none; letter-spacing: normal; }
    .char-count { font-size: 0.75rem; color: var(--text-muted); text-align: right; }
  `],
})
export class ResetModalComponent {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  additionalContext = '';
  resetting = signal(false);

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submitReset(): void {
    this.resetting.set(true);
    this.api.resetSite(this.site.id, {
      business: {
        name: this.site.business_name,
        address: this.site.business_address,
      },
      additional_context: this.additionalContext || undefined,
    }).subscribe({
      next: (res) => {
        this.resetting.set(false);
        this.toast.success('Site rebuild started!');
        this.modalCtrl.dismiss(res.data, 'reset');
      },
      error: (err) => {
        this.resetting.set(false);
        this.toast.error(err?.error?.message || 'Failed to reset site');
      },
    });
  }
}
