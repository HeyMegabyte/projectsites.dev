import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService, SelectedBusiness } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-details',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss',
})
export class DetailsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  mode = signal<'business' | 'custom'>('business');
  business = signal<SelectedBusiness | null>(null);
  businessName = '';
  businessAddress = '';
  additionalContext = '';
  submitting = signal(false);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    this.mode.set(this.auth.getMode());
    const biz = this.auth.getSelectedBusiness();
    if (biz) {
      this.business.set(biz);
      this.businessName = biz.name;
      this.businessAddress = biz.address;
    }
  }

  dismissBusiness(): void {
    this.business.set(null);
    this.mode.set('custom');
  }

  submitBuild(): void {
    const name = this.mode() === 'business' ? this.business()?.name : this.businessName;
    const address = this.mode() === 'business' ? this.business()?.address : this.businessAddress;

    if (!name?.trim() || !address?.trim()) {
      this.toast.error('Business name and address are required');
      return;
    }

    this.submitting.set(true);
    const biz = this.business();

    this.api
      .createSiteFromSearch({
        mode: this.mode(),
        additional_context: this.additionalContext || undefined,
        business: {
          name: name.trim(),
          address: address.trim(),
          place_id: biz?.place_id,
          phone: biz?.phone,
          website: biz?.website,
          types: biz?.types,
        },
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.auth.clearSelectedBusiness();
          this.toast.success('Site build started!');
          this.router.navigate(['/waiting'], {
            queryParams: { id: res.data.id, slug: res.data.slug },
          });
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(err?.error?.message || 'Failed to create site');
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
