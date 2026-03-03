import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-checkout-modal',
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Upgrade to Pro</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
        <div class="checkout-loading">
          <ion-spinner name="crescent"></ion-spinner>
          <p>Loading checkout...</p>
        </div>
      } @else if (error()) {
        <div class="checkout-error">
          <p>{{ error() }}</p>
          <ion-button fill="outline" (click)="initCheckout()">Try Again</ion-button>
        </div>
      }
      <div #checkoutContainer id="checkout-container"></div>
    </ion-content>
  `,
  styles: [`
    .checkout-loading, .checkout-error {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 12px; padding: 40px;
      text-align: center;
    }
    .checkout-error p { color: var(--error); }
    #checkout-container { min-height: 400px; }
  `],
})
export class CheckoutModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  orgId!: string;
  loading = signal(true);
  error = signal('');

  @ViewChild('checkoutContainer') checkoutContainer!: ElementRef;

  ngOnInit(): void {
    this.initCheckout();
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  async initCheckout(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    this.api.createCheckout(this.orgId, this.site.id, window.location.href).subscribe({
      next: async (res) => {
        try {
          const { loadStripe } = await import('@stripe/stripe-js');
          const stripe = await loadStripe(
            'pk_live_placeholder' // Stripe publishable key loaded from env
          );
          if (stripe && res.data.client_secret) {
            const checkout = await stripe.initEmbeddedCheckout({
              clientSecret: res.data.client_secret,
            });
            checkout.mount('#checkout-container');
          }
          this.loading.set(false);
        } catch (err) {
          this.loading.set(false);
          this.error.set('Failed to load Stripe checkout');
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Failed to create checkout session');
      },
    });
  }
}
