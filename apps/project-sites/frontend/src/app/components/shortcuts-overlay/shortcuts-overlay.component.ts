import { Component, EventEmitter, Output, HostListener } from '@angular/core';

interface ShortcutEntry {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['Cmd/Ctrl', 'K'], description: 'Open command palette' },
  { keys: ['?'], description: 'Show this overlay' },
  { keys: ['/'], description: 'Focus search' },
  { keys: ['Escape'], description: 'Close modal/overlay' },
  { keys: ['Cmd/Ctrl', 'S'], description: 'Save (in editor)' },
];

@Component({
  selector: 'app-shortcuts-overlay',
  standalone: true,
  template: `
    <div
      class="shortcuts-backdrop"
      role="dialog"
      aria-label="Keyboard shortcuts"
      aria-modal="true"
      (click)="onBackdropClick($event)"
    >
      <div class="shortcuts-modal" data-testid="shortcuts-overlay">
        <div class="shortcuts-header">
          <h2 class="shortcuts-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/>
            </svg>
            Keyboard Shortcuts
          </h2>
          <button class="shortcuts-close" (click)="closed.emit()" aria-label="Close shortcuts">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="shortcuts-divider"></div>
        <div class="shortcuts-grid">
          @for (s of shortcuts; track s.description) {
            <div class="shortcut-row">
              <span class="shortcut-desc">{{ s.description }}</span>
              <span class="shortcut-keys">
                @for (key of s.keys; track key; let last = $last) {
                  <kbd class="shortcut-key">{{ key }}</kbd>
                  @if (!last) {
                    <span class="shortcut-plus">+</span>
                  }
                }
              </span>
            </div>
          }
        </div>
        <div class="shortcuts-footer">
          Press <kbd>Escape</kbd> to close
        </div>
      </div>
    </div>
  `,
  styles: [`
    @keyframes fadeInScale {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes fadeInBg {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .shortcuts-backdrop {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(2, 2, 12, 0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: fadeInBg 0.15s ease;
    }
    .shortcuts-modal {
      width: 100%; max-width: 480px;
      background: #0d0d1a;
      border: 1px solid rgba(0, 229, 255, 0.15);
      border-radius: 16px;
      box-shadow:
        0 24px 80px rgba(0, 0, 0, 0.6),
        0 0 0 1px rgba(0, 229, 255, 0.06),
        0 0 60px rgba(0, 229, 255, 0.04);
      overflow: hidden;
      animation: fadeInScale 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .shortcuts-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px 14px;
    }
    .shortcuts-title {
      display: flex; align-items: center; gap: 10px;
      margin: 0; font-size: 1rem; font-weight: 600;
      color: #e8eaed;
    }
    .shortcuts-title svg { color: rgba(0, 229, 255, 0.6); }
    .shortcuts-close {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 8px;
      border: none; background: transparent;
      color: rgba(255, 255, 255, 0.3); cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .shortcuts-close:hover {
      background: rgba(0, 229, 255, 0.08);
      color: rgba(255, 255, 255, 0.7);
    }
    .shortcuts-close:focus-visible {
      outline: 2px solid #00e5ff; outline-offset: 2px;
    }

    .shortcuts-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.12), transparent);
    }

    .shortcuts-grid {
      padding: 12px 20px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .shortcut-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-radius: 8px;
      transition: background 0.12s;
    }
    .shortcut-row:hover { background: rgba(0, 229, 255, 0.04); }
    .shortcut-desc {
      font-size: 0.88rem; color: #c8cad0; font-weight: 500;
    }
    .shortcut-keys {
      display: flex; align-items: center; gap: 4px;
    }
    .shortcut-key {
      font-size: 0.72rem; font-family: var(--font, 'Inter', sans-serif);
      padding: 3px 8px; border-radius: 6px; font-weight: 600;
      background: rgba(0, 229, 255, 0.06);
      border: 1px solid rgba(0, 229, 255, 0.15);
      color: rgba(0, 229, 255, 0.7);
      line-height: 1.4;
    }
    .shortcut-plus {
      font-size: 0.68rem; color: rgba(255, 255, 255, 0.18);
    }

    .shortcuts-footer {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 12px 20px;
      border-top: 1px solid rgba(0, 229, 255, 0.06);
      background: rgba(0, 0, 0, 0.15);
      font-size: 0.72rem; color: rgba(255, 255, 255, 0.2);
    }
    .shortcuts-footer kbd {
      font-size: 0.65rem; font-family: var(--font, 'Inter', sans-serif);
      padding: 1px 5px; border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.35);
    }
  `],
})
export class ShortcutsOverlayComponent {
  @Output() closed = new EventEmitter<void>();

  readonly shortcuts = SHORTCUTS;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('shortcuts-backdrop')) {
      this.closed.emit();
    }
  }
}
