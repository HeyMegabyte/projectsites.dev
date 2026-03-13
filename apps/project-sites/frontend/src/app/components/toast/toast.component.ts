import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type" (click)="toastService.dismiss(toast.id)">
          <span class="toast-icon">
            @switch (toast.type) {
              @case ('error') {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
                </svg>
              }
              @case ('success') {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
                </svg>
              }
              @default {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
              }
            }
          </span>
          <span class="toast-text">{{ toast.message }}</span>
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
      display: flex; align-items: center; gap: 10px;
      padding: 12px 18px; border-radius: 12px; font-size: 0.85rem; font-weight: 500;
      animation: slideDown 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); max-width: 400px; cursor: pointer;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: transform 0.2s, opacity 0.2s;
    }
    .toast:hover { transform: translateX(-4px); }
    .toast-icon { display: flex; flex-shrink: 0; }
    .toast-text { flex: 1; }
    .toast-error {
      background: rgba(239, 68, 68, 0.12); color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .toast-success {
      background: rgba(34, 197, 94, 0.12); color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.2);
    }
    .toast-info {
      background: rgba(0, 212, 255, 0.12); color: var(--accent);
      border: 1px solid rgba(0, 212, 255, 0.2);
    }
  `],
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
