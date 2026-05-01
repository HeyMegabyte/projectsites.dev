import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    Stripe?: (pk: string) => StripeInstance;
  }
}

interface StripeInstance {
  initEmbeddedCheckout(options: { clientSecret: string }): Promise<EmbeddedCheckout>;
}

interface EmbeddedCheckout {
  mount(el: string | HTMLElement): void;
  unmount(): void;
  destroy(): void;
}

@Injectable({ providedIn: 'root' })
export class StripeService {
  private stripe: StripeInstance | null = null;
  private loadPromise: Promise<StripeInstance | null> | null = null;
  loading = signal(false);

  private getPublishableKey(): string | null {
    const meta = document.querySelector('meta[name="x-stripe-pk"]');
    return meta?.getAttribute('content') || null;
  }

  async loadStripe(): Promise<StripeInstance | null> {
    if (this.stripe) return this.stripe;
    if (this.loadPromise) return this.loadPromise;

    const pk = this.getPublishableKey();
    if (!pk) {
      console.warn('[StripeService] No Stripe publishable key found in <meta name="x-stripe-pk">');
      return null;
    }

    this.loadPromise = new Promise<StripeInstance | null>((resolve) => {
      if (window.Stripe) {
        this.stripe = window.Stripe(pk);
        resolve(this.stripe);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = () => {
        if (window.Stripe) {
          this.stripe = window.Stripe(pk);
          resolve(this.stripe);
        } else {
          resolve(null);
        }
      };
      script.onerror = () => {
        console.warn('[StripeService] Failed to load Stripe.js');
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  async mountEmbeddedCheckout(
    clientSecret: string,
    container: HTMLElement,
  ): Promise<EmbeddedCheckout | null> {
    this.loading.set(true);
    try {
      const stripe = await this.loadStripe();
      if (!stripe) return null;
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
      checkout.mount(container);
      return checkout;
    } catch (err) {
      console.warn('[StripeService] Embedded checkout failed:', err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}
