import { Component, inject, signal, HostListener, type OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** localStorage key for persisted language selection. */
const LANGUAGE_STORAGE_KEY = 'ps_language';

/** Supported language definitions. */
interface Language {
  code: string;
  flag: string;
  label: string;
}

const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
];

/**
 * Language switcher dropdown for toggling between English and Spanish.
 *
 * @remarks Persists the selection to localStorage under the key `ps_language`.
 * On init, reads from localStorage first, then falls back to the browser's
 * navigator.language. Uses @ngx-translate/core TranslateService to switch.
 *
 * @example
 * ```html
 * <app-language-switcher />
 * ```
 */
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  template: `
    <div class="lang-switcher" [class.open]="dropdownOpen()">
      <button
        class="lang-trigger"
        (click)="toggleDropdown($event)"
        [attr.aria-expanded]="dropdownOpen()"
        aria-haspopup="listbox"
        aria-label="Change language"
      >
        <svg class="globe-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span class="lang-code">{{ currentLang().code.toUpperCase() }}</span>
        <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      @if (dropdownOpen()) {
        <div class="lang-dropdown" role="listbox" aria-label="Language options">
          @for (lang of languages; track lang.code) {
            <button
              class="lang-option"
              [class.active]="lang.code === currentLang().code"
              (click)="selectLanguage(lang)"
              role="option"
              [attr.aria-selected]="lang.code === currentLang().code"
            >
              <span class="lang-flag">{{ lang.flag }}</span>
              <span class="lang-label">{{ lang.label }}</span>
              @if (lang.code === currentLang().code) {
                <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .lang-switcher {
      position: relative;
      z-index: var(--z-popover);
    }

    .lang-trigger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid rgba(0, 229, 255, 0.12);
      background: rgba(0, 229, 255, 0.04);
      color: var(--text-muted);
      font-family: var(--font);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: 0.03em;
    }

    .lang-trigger:hover {
      background: rgba(0, 229, 255, 0.08);
      border-color: rgba(0, 229, 255, 0.25);
      color: var(--accent);
    }

    .lang-switcher.open .lang-trigger {
      background: rgba(0, 229, 255, 0.1);
      border-color: rgba(0, 229, 255, 0.3);
      color: var(--accent);
    }

    .globe-icon {
      flex-shrink: 0;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lang-trigger:hover .globe-icon {
      transform: rotate(15deg);
    }

    .lang-code {
      min-width: 18px;
      text-align: center;
    }

    .chevron-icon {
      flex-shrink: 0;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lang-switcher.open .chevron-icon {
      transform: rotate(180deg);
    }

    .lang-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 160px;
      background: rgba(10, 10, 32, 0.98);
      backdrop-filter: blur(24px) saturate(1.5);
      -webkit-backdrop-filter: blur(24px) saturate(1.5);
      border: 1px solid rgba(0, 229, 255, 0.1);
      border-radius: 14px;
      padding: 4px;
      box-shadow:
        0 12px 40px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(0, 229, 255, 0.06);
      animation: slideDown 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .lang-option {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: transparent;
      color: var(--text-primary);
      font-family: var(--font);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      border-radius: 10px;
      transition: all 0.15s ease;
    }

    .lang-option:hover {
      background: rgba(0, 229, 255, 0.08);
      color: var(--accent);
    }

    .lang-option.active {
      background: rgba(0, 229, 255, 0.06);
      color: var(--accent);
    }

    .lang-option:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .lang-flag {
      font-size: 1.1rem;
      line-height: 1;
    }

    .lang-label {
      flex: 1;
      text-align: left;
    }

    .check-icon {
      color: var(--accent);
      flex-shrink: 0;
    }
  `],
})
export class LanguageSwitcherComponent implements OnInit {
  private translate = inject(TranslateService);

  readonly languages = SUPPORTED_LANGUAGES;
  readonly dropdownOpen = signal(false);
  readonly currentLang = signal<Language>(SUPPORTED_LANGUAGES[0]);

  ngOnInit(): void {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    let langCode = 'en';

    if (stored && this.isSupported(stored)) {
      langCode = stored;
    } else {
      const browserLang = navigator.language?.split('-')[0] ?? 'en';
      langCode = this.isSupported(browserLang) ? browserLang : 'en';
    }

    const lang = this.findLanguage(langCode);
    this.currentLang.set(lang);
    this.translate.use(lang.code);
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.dropdownOpen.update(v => !v);
  }

  selectLanguage(lang: Language): void {
    this.currentLang.set(lang);
    this.translate.use(lang.code);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang.code);
    this.dropdownOpen.set(false);
  }

  @HostListener('document:click')
  closeDropdown(): void {
    if (this.dropdownOpen()) {
      this.dropdownOpen.set(false);
    }
  }

  private isSupported(code: string): boolean {
    return SUPPORTED_LANGUAGES.some(l => l.code === code);
  }

  private findLanguage(code: string): Language {
    return SUPPORTED_LANGUAGES.find(l => l.code === code) ?? SUPPORTED_LANGUAGES[0];
  }
}
