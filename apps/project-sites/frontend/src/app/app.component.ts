import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute } from '@angular/router';
import { HeaderComponent } from './components/header/header.component';
import { ToastComponent } from './components/toast/toast.component';
import { BgOrbsComponent } from './components/bg-orbs/bg-orbs.component';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastComponent, BgOrbsComponent],
  template: `
    <app-header />
    <app-bg-orbs />
    <app-toast />
    <main class="app">
      <router-outlet />
    </main>
  `,
  styles: [`
    .app {
      min-height: 100vh;
      padding-top: 60px;
      position: relative;
    }
  `],
})
export class AppComponent implements OnInit {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    this.handleAuthCallback();
    this.restoreSession();
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
        this.router.navigate(['/details']);
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
