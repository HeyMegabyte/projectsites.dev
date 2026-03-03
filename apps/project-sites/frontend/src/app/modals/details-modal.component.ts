import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonList, IonItem, IonLabel, IonBadge,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-details-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonList, IonItem, IonLabel, IonBadge,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Site Details</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list lines="full">
        <ion-item>
          <ion-label>
            <p>Business Name</p>
            <h3>{{ site.business_name }}</h3>
          </ion-label>
        </ion-item>
        <ion-item>
          <ion-label>
            <p>Address</p>
            <h3>{{ site.business_address }}</h3>
          </ion-label>
        </ion-item>
        <ion-item>
          <ion-label>
            <p>Status</p>
            <h3>
              <ion-badge [color]="statusColor()">{{ site.status }}</ion-badge>
            </h3>
          </ion-label>
        </ion-item>
        <ion-item>
          <ion-label>
            <p>Slug</p>
            @if (editingSlug()) {
              <div class="slug-edit-row">
                <input
                  type="text"
                  class="input-field slug-input"
                  [(ngModel)]="slugValue"
                  (keyup.enter)="saveSlug()"
                  (keyup.escape)="editingSlug.set(false)"
                />
                <ion-button size="small" fill="solid" (click)="saveSlug()">Save</ion-button>
                <ion-button size="small" fill="outline" (click)="editingSlug.set(false)">Cancel</ion-button>
              </div>
            } @else {
              <h3 class="clickable" (click)="startEditSlug()">
                {{ site.slug }}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </h3>
            }
          </ion-label>
        </ion-item>
        @if (site.plan) {
          <ion-item>
            <ion-label>
              <p>Plan</p>
              <h3>{{ site.plan }}</h3>
            </ion-label>
          </ion-item>
        }
      </ion-list>

      @if (site.status === 'published') {
        <ion-button expand="block" fill="solid" (click)="viewLiveSite()">
          View Live Site
        </ion-button>
      }
    </ion-content>
  `,
  styles: [`
    .slug-edit-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .slug-input { flex: 1; padding: 8px 12px; font-size: 0.9rem; }
    .clickable {
      cursor: pointer;
      display: flex; align-items: center; gap: 6px;
      svg { color: var(--text-muted); }
      &:hover svg { color: var(--accent); }
    }
    ion-button[expand="block"] { margin-top: 20px; }
  `],
})
export class DetailsModalComponent {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  editingSlug = signal(false);
  slugValue = '';

  statusColor(): string {
    const map: Record<string, string> = {
      published: 'success', building: 'warning', queued: 'warning',
      generating: 'secondary', error: 'danger', draft: 'medium',
    };
    return map[this.site.status] || 'medium';
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  viewLiveSite(): void {
    const url = this.site.primary_hostname
      ? `https://${this.site.primary_hostname}`
      : `https://${this.site.slug}.projectsites.dev`;
    window.open(url, '_blank');
  }

  startEditSlug(): void {
    this.slugValue = this.site.slug;
    this.editingSlug.set(true);
  }

  saveSlug(): void {
    if (!this.slugValue.trim()) return;
    this.api.updateSite(this.site.id, { slug: this.slugValue.trim() }).subscribe({
      next: (res) => {
        this.site = { ...this.site, ...res.data };
        this.editingSlug.set(false);
        this.toast.success('Slug updated');
        this.modalCtrl.dismiss(this.site, 'updated');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to update slug'),
    });
  }
}
