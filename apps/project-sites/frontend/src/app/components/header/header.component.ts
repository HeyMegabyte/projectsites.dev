import { Component, inject, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NotificationBellComponent],
  template: `
    <header class="header" role="banner">
      <div class="header-inner">
        <a class="logo" (click)="goHome()">
          <img src="/logo-header-icon.png" alt="Project Sites" width="48" height="48" class="logo-icon" />
          <img src="/logo-text.png" alt="projectsites.dev" height="48" class="logo-text-img" />
        </a>
        <div class="header-right">
          @if (auth.isLoggedIn()) {
            <app-notification-bell />
            <div class="user-menu" (click)="toggleMenu($event)">
              <div class="user-avatar">{{ getInitial() }}</div>
              <svg class="chevron" [class.open]="menuOpen()" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
              @if (menuOpen()) {
                <div class="dropdown" (click)="$event.stopPropagation()">
                  <div class="dropdown-header">
                    <div class="dropdown-avatar">{{ getInitial() }}</div>
                    <div class="dropdown-user-info">
                      <span class="dropdown-email">{{ auth.email() }}</span>
                      <span class="dropdown-plan">Free Plan</span>
                    </div>
                  </div>
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item" (click)="goAdmin()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    Dashboard
                  </button>
                  <button class="dropdown-item" (click)="goCreate()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New Site
                  </button>
                  <button class="dropdown-item" (click)="goBilling()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    Billing
                  </button>
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item logout" (click)="logout()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              }
            </div>
          } @else {
            <button class="header-signin-btn" (click)="goSignin()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Sign In
            </button>
          }
        </div>
      </div>
    </header>
  `,
  styles: [`
    .header {
      position: fixed; top: 0; left: 0; right: 0; z-index: var(--z-header);
      padding: 0 24px; height: 64px; display: flex; align-items: center;
      background: #07071a;
      border-bottom: 1px solid rgba(0, 212, 255, 0.06);
      box-shadow: 0 1px 20px rgba(0, 0, 0, 0.4);
    }
    .header-inner {
      width: 1200px; max-width: 100%; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between;
    }
    .logo {
      display: flex; align-items: center; gap: 10px;
      text-decoration: none; cursor: pointer;
      transition: opacity 0.2s;
    }
    .logo:hover { opacity: 0.85; }
    .logo:active { opacity: 0.7; }
    .logo-icon {
      flex-shrink: 0;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
      background: transparent;
    }
    .logo:hover .logo-icon { transform: scale(1.05) rotate(-3deg); }
    .logo-text-img {
      flex-shrink: 0;
      opacity: 0.9;
      margin-top: 5px;
      transition: opacity 0.2s;
    }
    .logo:hover .logo-text-img { opacity: 1; }
    @media (max-width: 480px) {
      .logo-text-img { display: none; }
    }
    .header-right { display: flex; align-items: center; gap: 12px; }

    /* Sign In button */
    .header-signin-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 20px; border-radius: 10px;
      border: 1px solid rgba(0, 212, 255, 0.25);
      background: rgba(0, 212, 255, 0.06);
      color: var(--accent); font-size: 0.85rem; font-weight: 600;
      cursor: pointer; font-family: var(--font);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    .header-signin-btn::before {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.1), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .header-signin-btn:hover {
      background: rgba(0, 212, 255, 0.12);
      border-color: rgba(0, 212, 255, 0.5);
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.15), inset 0 0 20px rgba(0, 212, 255, 0.05);
      transform: translateY(-1px);
    }
    .header-signin-btn:hover::before { opacity: 1; }
    .header-signin-btn:active {
      transform: translateY(0);
      box-shadow: 0 0 8px rgba(0, 212, 255, 0.1);
    }
    .header-signin-btn svg {
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .header-signin-btn:hover svg { transform: translateX(2px); }

    /* User menu */
    .user-menu {
      position: relative;
      display: flex; align-items: center; gap: 8px;
      cursor: pointer;
      padding: 4px 10px 4px 4px;
      border-radius: 12px;
      transition: background 0.2s;
    }
    .user-menu:hover {
      background: rgba(0, 212, 255, 0.06);
    }
    .user-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: linear-gradient(135deg, #00d4ff, #0891b2);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; color: #050510;
      text-transform: uppercase;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.15);
      transition: box-shadow 0.3s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .user-menu:hover .user-avatar {
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35), 0 0 16px rgba(0, 212, 255, 0.15);
      transform: scale(1.05);
    }
    .chevron {
      color: var(--text-muted);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s;
    }
    .chevron.open { transform: rotate(180deg); color: var(--accent); }

    /* Dropdown */
    .dropdown {
      position: absolute; top: calc(100% + 10px); right: -4px;
      min-width: 240px;
      background: rgba(10, 10, 32, 0.98);
      backdrop-filter: blur(24px) saturate(1.5);
      -webkit-backdrop-filter: blur(24px) saturate(1.5);
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 16px;
      padding: 6px;
      box-shadow:
        0 16px 48px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(0, 212, 255, 0.06),
        0 0 60px rgba(0, 212, 255, 0.04);
      animation: slideDown 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      z-index: var(--z-popover);
    }
    .dropdown-header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px 10px;
    }
    .dropdown-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #00d4ff, #0891b2);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.8rem; font-weight: 700; color: #050510;
      text-transform: uppercase; flex-shrink: 0;
    }
    .dropdown-user-info {
      display: flex; flex-direction: column; min-width: 0;
    }
    .dropdown-email {
      font-size: 0.8rem; color: var(--text-primary); font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dropdown-plan {
      font-size: 0.68rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    }
    .dropdown-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.1), transparent);
      margin: 4px 10px;
    }
    .dropdown-item {
      display: flex; align-items: center; gap: 12px;
      width: 100%; padding: 10px 14px;
      border: none; background: transparent;
      color: var(--text-primary); font-size: 0.88rem;
      font-family: var(--font); font-weight: 500; cursor: pointer;
      border-radius: 10px;
      transition: all 0.15s ease;
    }
    .dropdown-item svg {
      color: var(--text-muted);
      transition: color 0.15s, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    .dropdown-item:hover {
      background: rgba(0, 212, 255, 0.08);
      color: var(--accent);
    }
    .dropdown-item:hover svg { color: var(--accent); transform: scale(1.1); }
    .dropdown-item:active { background: rgba(0, 212, 255, 0.12); }
    .dropdown-item:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .dropdown-item.logout:hover {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
    }
    .dropdown-item.logout:hover svg { color: #ef4444; }
  `],
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private api = inject(ApiService);
  menuOpen = signal(false);

  getInitial(): string {
    const email = this.auth.email();
    return email ? email.charAt(0).toUpperCase() : '?';
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  @HostListener('document:click')
  closeMenu(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
    }
  }

  goHome(): void {
    this.menuOpen.set(false);
    this.router.navigate(['/']);
  }

  goSignin(): void {
    this.router.navigate(['/signin']);
  }

  goCreate(): void {
    this.menuOpen.set(false);
    this.router.navigate(['/create']);
  }

  goAdmin(): void {
    this.menuOpen.set(false);
    this.router.navigate(['/admin']);
  }

  goBilling(): void {
    this.menuOpen.set(false);
    // Open Stripe billing portal (same as admin panel billing button)
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res: any) => {
        if (res.data?.portal_url) window.open(res.data.portal_url, '_blank');
        else this.router.navigate(['/admin']);
      },
      error: () => this.router.navigate(['/admin']),
    });
  }

  logout(): void {
    this.menuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
