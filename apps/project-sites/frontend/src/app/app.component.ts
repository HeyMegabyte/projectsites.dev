import { Component, type OnInit, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './components/header/header.component';
import { ToastComponent } from './components/toast/toast.component';
import { BgOrbsComponent } from './components/bg-orbs/bg-orbs.component';
import { EasterEggsComponent } from './components/easter-eggs/easter-eggs.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { ShortcutsOverlayComponent } from './components/shortcuts-overlay/shortcuts-overlay.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { FeedbackWidgetComponent } from './components/feedback-widget/feedback-widget.component';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';
import { MetaService } from './services/meta.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastComponent, BgOrbsComponent, EasterEggsComponent, CommandPaletteComponent, ShortcutsOverlayComponent, OnboardingComponent, FeedbackWidgetComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    @if (showHeader()) { <app-header role="banner" /> }
    <app-bg-orbs />
    <app-easter-eggs />
    <app-toast />
    @if (showCommandPalette()) {
      <app-command-palette
        (closed)="showCommandPalette.set(false)"
        (showShortcuts)="onPaletteShowShortcuts()"
      />
    }
    @if (showShortcuts()) {
      <app-shortcuts-overlay (closed)="showShortcuts.set(false)" />
    }
    <main id="main-content" role="main" class="app" [class.no-pad]="!showHeader()">
      <router-outlet />
    </main>
    <app-onboarding />
    <app-feedback-widget />
  `,
  styles: [`
    .app {
      min-height: 100vh;
      padding-top: 64px;
      position: relative;
    }
    .app.no-pad {
      padding-top: 0;
    }
  `],
})
export class AppComponent implements OnInit {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private meta = inject(MetaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  showHeader = signal(true);
  showCommandPalette = signal(false);
  showShortcuts = signal(false);

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    // Cmd+K / Ctrl+K — toggle command palette
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.showCommandPalette.update(v => !v);
      this.showShortcuts.set(false);
      return;
    }
    // '?' — show shortcuts overlay (only when not typing in an input/textarea)
    if (event.key === '?' && !this.isInputFocused()) {
      this.showShortcuts.update(v => !v);
      this.showCommandPalette.set(false);
      return;
    }
    // '/' — focus the first visible search input (only when not typing)
    if (event.key === '/' && !this.isInputFocused()) {
      event.preventDefault();
      const search = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="earch"]');
      if (search) search.focus();
    }
  }

  /** Show shortcuts from the command palette action */
  onPaletteShowShortcuts(): void {
    this.showCommandPalette.set(false);
    this.showShortcuts.set(true);
  }

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
  }

  ngOnInit(): void {
    this.meta.init();
    this.handleAuthCallback();
    this.restoreSession();
    this.trackRoute();
    this.initCursorFollower();
  }

  private isHeaderlessRoute(url: string): boolean {
    const path = url.split('?')[0];
    // Homepage has its own nav; admin/billing/editor have their own chrome
    if (path === '/' || path === '') return true;
    return ['/admin', '/billing', '/editor'].some(r => path.startsWith(r));
  }

  private trackRoute(): void {
    // Set initial value
    this.showHeader.set(!this.isHeaderlessRoute(this.router.url));
    // Listen for route changes
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.showHeader.set(!this.isHeaderlessRoute(e.urlAfterRedirects));
      });
  }

  private initCursorFollower(): void {
    if (typeof window === 'undefined') return;
    // Respect prefers-reduced-motion and hover capability
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const follower = document.createElement('div');
    follower.className = 'cursor-follower';
    document.body.appendChild(follower);

    let mouseX = 0;
    let mouseY = 0;
    let followerX = 0;
    let followerY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!follower.classList.contains('visible')) {
        follower.classList.add('visible');
      }
    });

    document.addEventListener('mouseleave', () => {
      follower.classList.remove('visible');
    });

    // Hover detection for interactive elements
    document.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, textarea, select, [data-tooltip], .search-result, .address-option')) {
        follower.classList.add('hover');
      }
    });
    document.addEventListener('mouseout', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, textarea, select, [data-tooltip], .search-result, .address-option')) {
        follower.classList.remove('hover');
      }
    });

    // Click ripple
    document.addEventListener('click', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'click-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      ripple.style.width = '80px';
      ripple.style.height = '80px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });

    // Smooth follow with lerp
    const animate = () => {
      followerX += (mouseX - followerX) * 0.15;
      followerY += (mouseY - followerY) * 0.15;
      follower.style.left = followerX + 'px';
      follower.style.top = followerY + 'px';
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private handleAuthCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const email = params.get('email');
    const authCallback = params.get('auth_callback');

    if (token && email && authCallback) {
      this.auth.setSession(token, email);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      url.searchParams.delete('email');
      url.searchParams.delete('auth_callback');
      window.history.replaceState({}, '', url.toString());

      // Restore business and navigate
      const business = this.auth.getSelectedBusiness();
      if (business) {
        this.router.navigate(['/create']);
      } else {
        this.router.navigate(['/admin']);
      }
    }
  }

  private restoreSession(): void {
    if (this.auth.isLoggedIn()) {
      this.api.getMe().subscribe({
        error: () => {
          this.auth.clearSession();
        },
      });
    }
  }
}
