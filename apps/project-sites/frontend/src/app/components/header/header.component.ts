import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonHeader, IonToolbar, IonButtons, IonButton } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [IonHeader, IonToolbar, IonButtons, IonButton],
  template: `
    <ion-header class="app-header">
      <ion-toolbar>
        <a class="logo" (click)="goHome()" slot="start">
          <img src="/logo-icon.svg" alt="Project Sites" width="32" height="32" />
        </a>
        <ion-buttons slot="end">
          @if (auth.isLoggedIn()) {
            <span class="header-auth-user">{{ auth.email() }}</span>
            <ion-button fill="outline" size="small" (click)="goAdmin()">Dashboard</ion-button>
            <ion-button fill="outline" size="small" (click)="logout()">Sign Out</ion-button>
          } @else {
            <ion-button fill="outline" size="small" (click)="goSignin()">Sign In</ion-button>
          }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`
    .app-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
    }
    ion-toolbar {
      --background: rgba(10, 10, 26, 0.88);
      --border-color: rgba(80, 165, 219, 0.06);
      --min-height: 60px;
      --padding-start: 24px;
      --padding-end: 24px;
      backdrop-filter: blur(24px);
      box-shadow: 0 1px 12px rgba(0, 0, 0, 0.2);
    }
    .logo {
      display: flex;
      align-items: center;
      text-decoration: none;
      cursor: pointer;
    }
    .logo img { flex-shrink: 0; }
    .header-auth-user {
      color: rgba(255,255,255,0.7);
      font-size: 0.85rem;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 8px;
    }
    ion-button {
      --color: var(--accent);
      --border-color: var(--border);
      --border-radius: 6px;
      font-size: 0.85rem;
    }
    ion-button:hover {
      --background: rgba(100, 255, 218, 0.1);
      --border-color: var(--accent);
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
