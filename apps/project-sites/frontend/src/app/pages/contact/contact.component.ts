import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './contact.component.html',
})
export class ContactComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  name = '';
  email = '';
  phone = '';
  message = '';
  submitting = signal(false);
  submitted = signal(false);
  attempted = signal(false);

  get nameInvalid(): boolean { return this.attempted() && !this.name.trim(); }
  get emailInvalid(): boolean {
    if (!this.attempted()) return false;
    if (!this.email.trim()) return true;
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email);
  }
  get messageInvalid(): boolean { return this.attempted() && !this.message.trim(); }

  goHome(): void {
    this.router.navigate(['/']);
  }

  submit(): void {
    this.attempted.set(true);
    if (!this.name.trim() || !this.email.trim() || !this.message.trim()) {
      this.toast.error('Please fill in all required fields.');
      return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(this.email)) {
      this.toast.error('Please enter a valid email address.');
      return;
    }

    this.submitting.set(true);
    this.api.submitContact({
      name: this.name.trim(),
      email: this.email.trim(),
      phone: this.phone.trim() || undefined,
      message: this.message.trim(),
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      error: () => {
        this.submitting.set(false);
      },
    });
  }
}
