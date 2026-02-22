import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-signin',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './signin.component.html',
  styleUrl: './signin.component.scss',
})
export class SigninComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  panel = signal<'main' | 'email'>('main');
  email = '';
  sending = signal(false);
  sent = signal(false);

  showEmailPanel(): void {
    this.panel.set('email');
  }

  backToMain(): void {
    this.panel.set('main');
    this.sent.set(false);
  }

  signInWithGoogle(): void {
    const business = this.auth.getSelectedBusiness();
    const mode = this.auth.getMode();
    let redirectUrl = window.location.origin + '/?auth_callback=google';
    if (business) {
      redirectUrl += `&biz_name=${encodeURIComponent(business.name)}&biz_address=${encodeURIComponent(business.address)}`;
      if (business.place_id) redirectUrl += `&biz_place_id=${encodeURIComponent(business.place_id)}`;
      redirectUrl += `&mode=${mode}`;
    }
    window.location.href = `/api/auth/google?redirect_url=${encodeURIComponent(redirectUrl)}`;
  }

  sendMagicLink(): void {
    if (!this.email || this.sending()) return;

    this.sending.set(true);
    const business = this.auth.getSelectedBusiness();
    const mode = this.auth.getMode();
    let redirectUrl = window.location.origin + '/?auth_callback=email';
    if (business) {
      redirectUrl += `&biz_name=${encodeURIComponent(business.name)}&biz_address=${encodeURIComponent(business.address)}`;
      if (business.place_id) redirectUrl += `&biz_place_id=${encodeURIComponent(business.place_id)}`;
      redirectUrl += `&mode=${mode}`;
    }

    this.api.sendMagicLink(this.email, redirectUrl).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.sent.set(true);
        if (res.data?.token) {
          this.auth.setSession(res.data.token, this.email);
        }
        this.toast.success('Check your email for the magic link!');
      },
      error: (err) => {
        this.sending.set(false);
        this.toast.error(err?.error?.message || 'Failed to send magic link');
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
