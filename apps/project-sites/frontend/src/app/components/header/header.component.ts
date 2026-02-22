import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="header">
      <div class="header-inner">
        <a class="logo" (click)="goHome()">
          <img src="/logo-icon.svg" alt="Project Sites" width="32" height="32" />
        </a>
        <div class="header-auth">
          @if (auth.isLoggedIn()) {
            <span class="header-auth-user">{{ auth.email() }}</span>
            <button class="header-auth-btn" (click)="goAdmin()">Dashboard</button>
            <button class="header-auth-btn" (click)="logout()">Sign Out</button>
          } @else {
            <button class="header-auth-btn" (click)="goSignin()">Sign In</button>
          }
        </div>
      </div>
    </header>
  `,
  styles: [`
    .header {
      position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
      padding: 0 24px; height: 60px; display: flex; align-items: center;
      background: rgba(10, 10, 26, 0.88); backdrop-filter: blur(24px);
      border-bottom: 1px solid rgba(80, 165, 219, 0.06);
      box-shadow: 0 1px 12px rgba(0, 0, 0, 0.2);
    }
    .header-inner {
      max-width: 1200px; width: 100%; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between;
    }
    .logo { display: flex; align-items: center; text-decoration: none; cursor: pointer; }
    .logo img { flex-shrink: 0; }
    .header-auth { display: flex; align-items: center; gap: 12px; }
    .header-auth-user {
      color: rgba(255,255,255,0.7); font-size: 0.85rem;
      max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .header-auth-btn {
      padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border);
      background: transparent; color: var(--accent); font-size: 0.85rem;
      cursor: pointer; transition: background 0.2s, border-color 0.2s;
      white-space: nowrap;
    }
    .header-auth-btn:hover {
      background: rgba(100, 255, 218, 0.1); border-color: var(--accent);
    }
  `],
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  goHome(): void {
    this.router.navigate(['/']);
  }

  goSignin(): void {
    this.router.navigate(['/signin']);
  }

  goAdmin(): void {
    this.router.navigate(['/admin']);
  }

  logout(): void {
    this.auth.clearSession();
    this.router.navigate(['/']);
  }
}
