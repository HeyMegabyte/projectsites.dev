import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type" (click)="toastService.dismiss(toast.id)">
          {{ toast.message }}
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed; top: 72px; right: 24px; z-index: 10001;
      display: flex; flex-direction: column; gap: 8px;
    }
    .toast {
      padding: 12px 20px; border-radius: 10px; font-size: 0.85rem;
      animation: fadeInScale 0.2s ease; max-width: 380px; cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .toast-error { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); }
    .toast-success { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.25); }
    .toast-info { background: rgba(80,165,219,0.15); color: var(--accent); border: 1px solid rgba(80,165,219,0.25); }
  `],
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
