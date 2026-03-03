import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonList, IonItem, IonLabel, IonBadge, IonSpinner,
  IonSegment, IonSegmentButton,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Hostname } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-domain-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonList, IonItem, IonLabel, IonBadge, IonSpinner,
    IonSegment, IonSegmentButton,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Domain Management</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-segment [value]="tab()" (ionChange)="tab.set($any($event).detail.value)">
        <ion-segment-button value="hostnames">Hostnames</ion-segment-button>
        <ion-segment-button value="cname">CNAME Instructions</ion-segment-button>
      </ion-segment>

      @if (tab() === 'hostnames') {
        @if (loading()) {
          <div class="modal-loading"><ion-spinner name="crescent"></ion-spinner> Loading domains...</div>
        } @else {
          @if (hostnames().length > 0) {
            <ion-list lines="full">
              @for (hn of hostnames(); track hn.id) {
                <ion-item>
                  <ion-label>
                    <h3>
                      {{ hn.hostname }}
                      @if (hn.is_primary) { <ion-badge color="primary">Primary</ion-badge> }
                    </h3>
                    <p>
                      <ion-badge [color]="hn.status === 'active' ? 'success' : hn.status === 'pending' ? 'warning' : 'danger'">
                        {{ hn.status }}
                      </ion-badge>
                    </p>
                  </ion-label>
                  <ion-buttons slot="end">
                    @if (!hn.is_primary) {
                      <ion-button size="small" (click)="setPrimary(hn.id)">Set Primary</ion-button>
                    }
                    <ion-button size="small" color="danger" (click)="deleteHostname(hn.id)">Remove</ion-button>
                  </ion-buttons>
                </ion-item>
              }
            </ion-list>
          } @else {
            <p class="empty-text">No custom domains configured.</p>
          }

          <div class="add-domain-row">
            <input
              type="text"
              class="input-field"
              placeholder="yourdomain.com"
              [(ngModel)]="newHostname"
              (keyup.enter)="addHostname()"
            />
            <ion-button fill="solid" [disabled]="!newHostname.trim()" (click)="addHostname()">Add</ion-button>
          </div>
        }
      }

      @if (tab() === 'cname') {
        <div class="cname-info">
          <h4>Setup Instructions</h4>
          <ol>
            <li>Go to your domain registrar's DNS settings</li>
            <li>Add a <strong>CNAME</strong> record</li>
            <li>Set the name/host to your subdomain (e.g., <code>www</code>)</li>
            <li>Set the value/target to <code>projectsites.dev</code></li>
            <li>Wait for DNS propagation (usually 5-30 minutes)</li>
          </ol>
          <div class="cname-example">
            <code>CNAME &nbsp; www &nbsp; → &nbsp; projectsites.dev</code>
          </div>
          <p class="cname-note">For root domains (apex), use an ALIAS or ANAME record if your registrar supports it.</p>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .modal-loading {
      text-align: center; padding: 40px; color: var(--text-muted);
      display: flex; align-items: center; justify-content: center; gap: 12px;
    }
    .empty-text { text-align: center; padding: 20px; color: var(--text-muted); }
    .add-domain-row {
      display: flex; gap: 12px; margin-top: 16px;
      .input-field { flex: 1; }
    }
    ion-segment { margin-bottom: 16px; }
    .cname-info {
      padding: 16px 0;
      h4 { font-size: 1rem; margin-bottom: 12px; }
      ol { padding-left: 20px; margin-bottom: 16px; }
      li { padding: 4px 0; font-size: 0.9rem; color: var(--text-secondary); }
      code { background: var(--accent-dim); padding: 2px 8px; border-radius: 4px; color: var(--accent); font-size: 0.85rem; }
    }
    .cname-example {
      padding: 16px; background: var(--bg-input); border-radius: var(--radius);
      border: 1px solid var(--border); margin-bottom: 12px; text-align: center;
      code { font-size: 0.95rem; }
    }
    .cname-note { font-size: 0.82rem; color: var(--text-muted); font-style: italic; }
  `],
})
export class DomainModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  hostnames = signal<Hostname[]>([]);
  loading = signal(true);
  tab = signal<'hostnames' | 'cname'>('hostnames');
  newHostname = '';

  ngOnInit(): void {
    this.loadHostnames();
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  private loadHostnames(): void {
    this.loading.set(true);
    this.api.getHostnames(this.siteId).subscribe({
      next: (res) => {
        this.hostnames.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load domains');
      },
    });
  }

  addHostname(): void {
    if (!this.newHostname.trim()) return;
    this.api.addHostname(this.siteId, this.newHostname.trim()).subscribe({
      next: (res) => {
        this.hostnames.update((h) => [...h, res.data]);
        this.newHostname = '';
        this.toast.success('Domain added');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to add domain'),
    });
  }

  setPrimary(hostnameId: string): void {
    this.api.setPrimaryHostname(this.siteId, hostnameId).subscribe({
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
    this.api.deleteHostname(this.siteId, hostnameId).subscribe({
      next: () => {
        this.hostnames.update((h) => h.filter((hn) => hn.id !== hostnameId));
        this.toast.success('Domain removed');
      },
      error: () => this.toast.error('Failed to remove domain'),
    });
  }
}
