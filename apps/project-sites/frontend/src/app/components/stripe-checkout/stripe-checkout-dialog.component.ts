import { Component, inject, signal, type OnInit, type OnDestroy, type ElementRef, ViewChild, type AfterViewInit } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { StripeService } from '../../services/stripe.service';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';

interface StripeCheckoutData {
  clientSecret: string;
  siteName: string;
}

@Component({
  selector: 'app-stripe-checkout-dialog',
  standalone: true,
  imports: [DialogShellComponent],
  template: `
    <app-dialog-shell (closed)="onClose()">
      <span dialogIcon>
        <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      </span>
      <span dialogTitle>Upgrade {{ data.siteName }}</span>

      <div class="p-6 min-h-[400px]">
        @if (loading()) {
          <div class="flex flex-col items-center justify-center gap-3 py-16 text-text-secondary text-sm">
            <div class="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <span>Loading checkout...</span>
          </div>
        } @else if (error()) {
          <div class="flex flex-col items-center justify-center gap-3 py-16 text-text-secondary text-sm">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-red-400"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span>{{ error() }}</span>
            <button class="btn-ghost text-xs mt-2" (click)="retry()">Try Again</button>
          </div>
        }
        <div #checkoutContainer class="stripe-checkout-container"></div>
      </div>
    </app-dialog-shell>
  `,
  styles: [`
    .stripe-checkout-container {
      min-height: 300px;
    }
    .stripe-checkout-container :deep(iframe) {
      border-radius: 12px;
    }
  `],
})
export class StripeCheckoutDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  data = inject<StripeCheckoutData>(DIALOG_DATA);
  dialogRef = inject(DialogRef);
  private stripe = inject(StripeService);

  @ViewChild('checkoutContainer') containerRef!: ElementRef<HTMLElement>;

  loading = signal(true);
  error = signal<string | null>(null);
  private checkout: { unmount(): void; destroy(): void } | null = null;
  private mounted = false;

  ngOnInit(): void {
    // Pre-load Stripe.js
    this.stripe.loadStripe();
  }

  ngAfterViewInit(): void {
    this.mountCheckout();
  }

  ngOnDestroy(): void {
    this.destroyCheckout();
  }

  private async mountCheckout(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.stripe.mountEmbeddedCheckout(
        this.data.clientSecret,
        this.containerRef.nativeElement,
      );
      if (result) {
        this.checkout = result;
        this.mounted = true;
      } else {
        this.error.set('Failed to load checkout. Please try again.');
      }
    } catch {
      this.error.set('Something went wrong loading checkout.');
    } finally {
      this.loading.set(false);
    }
  }

  private destroyCheckout(): void {
    if (this.checkout && this.mounted) {
      try {
        this.checkout.unmount();
        this.checkout.destroy();
      } catch {
        // Cleanup errors are non-critical
      }
      this.checkout = null;
      this.mounted = false;
    }
  }

  retry(): void {
    this.destroyCheckout();
    this.mountCheckout();
  }

  onClose(): void {
    this.destroyCheckout();
    this.dialogRef.close();
  }
}
