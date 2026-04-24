import { Component, inject, signal, computed, ElementRef, ViewChild, type AfterViewInit, type OnDestroy, EventEmitter, Output } from '@angular/core';
import { Router } from '@angular/router';

interface PaletteCommand {
  id: string;
  label: string;
  icon: string;
  route?: string;
  action?: string;
}

const COMMANDS: PaletteCommand[] = [
  { id: 'home', label: 'Go to Homepage', icon: 'home', route: '/' },
  { id: 'search', label: 'Search for a Business', icon: 'search', route: '/search' },
  { id: 'create', label: 'Create New Site', icon: 'plus', route: '/create' },
  { id: 'admin', label: 'Open Dashboard', icon: 'dashboard', route: '/admin' },
  { id: 'editor', label: 'Open Editor', icon: 'edit', route: '/admin/editor' },
  { id: 'billing', label: 'Manage Billing', icon: 'billing', route: '/admin/billing' },
  { id: 'settings', label: 'Open Settings', icon: 'settings', route: '/admin/settings' },
  { id: 'shortcuts', label: 'Show Keyboard Shortcuts', icon: 'keyboard', action: 'showShortcuts' },
  { id: 'changelog', label: 'View Changelog', icon: 'changelog', route: '/changelog' },
  { id: 'status', label: 'System Status', icon: 'status', route: '/status' },
  { id: 'privacy', label: 'Privacy Policy', icon: 'lock', route: '/privacy' },
  { id: 'terms', label: 'Terms of Service', icon: 'document', route: '/terms' },
];

@Component({
  selector: 'app-command-palette',
  standalone: true,
  template: `
    <div
      class="palette-backdrop"
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
      (click)="onBackdropClick($event)"
      (keydown)="onKeydown($event)"
    >
      <div class="palette-modal" data-testid="command-palette">
        <div class="palette-input-wrap">
          <svg class="palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            #searchInput
            class="palette-input"
            type="text"
            placeholder="Type a command..."
            [value]="query()"
            (input)="onInput($event)"
            autocomplete="off"
            spellcheck="false"
            data-testid="command-palette-input"
          />
          <kbd class="palette-esc">esc</kbd>
        </div>
        <div class="palette-divider"></div>
        <ul class="palette-list" role="listbox" aria-label="Commands">
          @for (cmd of filtered(); track cmd.id; let i = $index) {
            <li
              class="palette-item"
              [class.active]="i === activeIndex()"
              [attr.aria-selected]="i === activeIndex()"
              role="option"
              (click)="execute(cmd)"
              (mouseenter)="activeIndex.set(i)"
              [attr.data-testid]="'command-' + cmd.id"
            >
              <span class="palette-item-icon" [innerHTML]="getIcon(cmd.icon)"></span>
              <span class="palette-item-label">{{ cmd.label }}</span>
              @if (cmd.route) {
                <span class="palette-item-hint">{{ cmd.route }}</span>
              }
            </li>
          }
          @if (filtered().length === 0) {
            <li class="palette-empty">No commands found</li>
          }
        </ul>
        <div class="palette-footer">
          <span class="palette-footer-key"><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
          <span class="palette-footer-key"><kbd>&crarr;</kbd> select</span>
          <span class="palette-footer-key"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @keyframes fadeInScale {
      from { opacity: 0; transform: translateY(-12px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes fadeInBg {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .palette-backdrop {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: min(22vh, 180px);
      background: rgba(2, 2, 12, 0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: fadeInBg 0.15s ease;
    }
    .palette-modal {
      width: 100%; max-width: 560px;
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

    /* Input area */
    .palette-input-wrap {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px;
    }
    .palette-search-icon {
      flex-shrink: 0; color: rgba(0, 229, 255, 0.5);
    }
    .palette-input {
      flex: 1;
      background: transparent; border: none; outline: none;
      color: #e8eaed; font-size: 1rem; font-family: var(--font, 'Inter', sans-serif);
      caret-color: #00e5ff;
    }
    .palette-input::placeholder { color: rgba(255, 255, 255, 0.28); }
    .palette-esc {
      font-size: 0.65rem; font-family: var(--font, 'Inter', sans-serif);
      padding: 2px 7px; border-radius: 5px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.35);
      pointer-events: none;
    }

    /* Divider */
    .palette-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.12), transparent);
    }

    /* List */
    .palette-list {
      list-style: none; margin: 0; padding: 6px;
      max-height: 360px; overflow-y: auto;
    }
    .palette-list::-webkit-scrollbar { width: 4px; }
    .palette-list::-webkit-scrollbar-track { background: transparent; }
    .palette-list::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.15); border-radius: 4px; }

    .palette-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 14px; border-radius: 10px;
      cursor: pointer; transition: background 0.12s, border-color 0.12s;
      border-left: 2px solid transparent;
    }
    .palette-item:hover,
    .palette-item.active {
      background: rgba(0, 229, 255, 0.08);
      border-left-color: #00e5ff;
    }
    .palette-item-icon {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; flex-shrink: 0;
      color: rgba(0, 229, 255, 0.6);
    }
    .palette-item-icon :deep(svg) { width: 18px; height: 18px; }
    .palette-item-label {
      flex: 1; color: #e0e2e6; font-size: 0.9rem; font-weight: 500;
    }
    .palette-item.active .palette-item-label { color: #fff; }
    .palette-item-hint {
      font-size: 0.72rem; color: rgba(255, 255, 255, 0.2);
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
    }
    .palette-empty {
      padding: 24px; text-align: center;
      color: rgba(255, 255, 255, 0.25); font-size: 0.85rem;
    }

    /* Footer */
    .palette-footer {
      display: flex; align-items: center; justify-content: center; gap: 20px;
      padding: 10px 18px;
      border-top: 1px solid rgba(0, 229, 255, 0.06);
      background: rgba(0, 0, 0, 0.15);
    }
    .palette-footer-key {
      display: flex; align-items: center; gap: 5px;
      font-size: 0.7rem; color: rgba(255, 255, 255, 0.22);
    }
    .palette-footer-key kbd {
      font-size: 0.65rem; font-family: var(--font, 'Inter', sans-serif);
      padding: 1px 5px; border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.35);
      line-height: 1.4;
    }
  `],
})
export class CommandPaletteComponent implements AfterViewInit, OnDestroy {
  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;
  @Output() closed = new EventEmitter<void>();
  @Output() showShortcuts = new EventEmitter<void>();

  private router = inject(Router);

  query = signal('');
  activeIndex = signal(0);

  filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      cmd => cmd.label.toLowerCase().includes(q) || (cmd.route?.toLowerCase().includes(q) ?? false)
    );
  });

  /** SVG icons keyed by name */
  private icons: Record<string, string> = {
    home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    dashboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    billing: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08Z"/></svg>',
    keyboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg>',
    changelog: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
    status: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    document: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  };

  getIcon(name: string): string {
    return this.icons[name] ?? '';
  }

  ngAfterViewInit(): void {
    // Focus the input on the next tick so the animation can settle
    setTimeout(() => this.searchInputRef?.nativeElement?.focus(), 50);
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.activeIndex.set(0);
  }

  onBackdropClick(event: MouseEvent): void {
    // Only close if clicking the backdrop itself, not the modal
    if ((event.target as HTMLElement).classList.contains('palette-backdrop')) {
      this.closed.emit();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.filtered();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.update(i => (i + 1) % Math.max(items.length, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update(i => (i - 1 + items.length) % Math.max(items.length, 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (items.length > 0) {
          this.execute(items[this.activeIndex()]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.closed.emit();
        break;
    }
  }

  execute(cmd: PaletteCommand): void {
    this.closed.emit();
    if (cmd.action === 'showShortcuts') {
      this.showShortcuts.emit();
      return;
    }
    if (cmd.route) {
      this.router.navigate([cmd.route]);
    }
  }
}
