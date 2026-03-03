import { Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, forkJoin, of, takeUntil } from 'rxjs';
import {
  IonSearchbar, IonList, IonItem, IonLabel, IonBadge, IonButton,
  IonSpinner, IonAccordionGroup, IonAccordion,
  IonToggle, IonModal,
} from '@ionic/angular/standalone';
import { ApiService, BusinessResult, PreBuiltSite } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';
import { ToastService } from '../../services/toast.service';

interface SearchItem {
  type: 'business' | 'prebuilt' | 'custom';
  name: string;
  address: string;
  place_id?: string;
  distance?: string;
  distanceMiles?: number;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  types?: string[];
  siteId?: string;
  slug?: string;
  status?: string;
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [
    FormsModule, IonSearchbar, IonList, IonItem, IonLabel, IonBadge,
    IonButton, IonSpinner, IonAccordionGroup, IonAccordion,
    IonToggle, IonModal,
  ],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private geo = inject(GeolocationService);
  private toast = inject(ToastService);
  private router = inject(Router);

  query = '';
  results = signal<SearchItem[]>([]);
  loading = signal(false);
  dropdownOpen = signal(false);
  showLocationPrompt = signal(false);
  isAnnual = signal(false);

  // Contact form
  contactName = '';
  contactEmail = '';
  contactMessage = '';
  contactSending = signal(false);

  // FAQ items
  faqItems = [
    { question: 'How long does it take to build my website?', answer: 'Most websites are generated and live within 5-15 minutes. Our AI researches your business, designs your brand, writes content, and publishes — all automatically.' },
    { question: 'Can I use my own domain name?', answer: 'Yes! You can connect your custom domain in the admin dashboard. Just add a CNAME record pointing to projectsites.dev and we handle SSL automatically.' },
    { question: 'What if I want to make changes to my website?', answer: 'You can edit files directly in the built-in code editor, upload custom assets, or regenerate the entire site with new context. Changes deploy instantly.' },
    { question: 'Is there a free plan?', answer: 'Yes! Every site starts on the free plan which includes AI generation, CDN hosting, and SSL. Upgrade to remove the branding bar and get custom domain support.' },
    { question: 'What AI model powers the generation?', answer: 'We use Cloudflare Workers AI with Llama models for content generation. The AI researches your business across the web to create accurate, professional content.' },
    { question: 'Can I cancel anytime?', answer: 'Absolutely. No contracts, no commitments. Cancel your subscription anytime from the billing portal and your site stays live on the free plan.' },
  ];

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) {
            this.results.set([]);
            this.dropdownOpen.set(false);
            return of(null);
          }
          this.loading.set(true);
          const lat = this.geo.lat() ?? undefined;
          const lng = this.geo.lng() ?? undefined;
          return forkJoin({
            businesses: this.api.searchBusinesses(q, lat, lng),
            sites: this.api.searchSites(q),
          });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) return;

        const items: SearchItem[] = [];
        const seen = new Set<string>();

        for (const s of res.sites.data || []) {
          const key = s.place_id || s.business_name;
          if (!seen.has(key)) {
            seen.add(key);
            items.push({
              type: 'prebuilt',
              name: s.business_name,
              address: s.business_address,
              place_id: s.place_id,
              siteId: s.id,
              slug: s.slug,
              status: s.status,
            });
          }
        }

        for (const b of res.businesses.data || []) {
          const key = b.place_id || b.name;
          if (!seen.has(key)) {
            seen.add(key);
            const item: SearchItem = {
              type: 'business',
              name: b.name,
              address: b.address,
              place_id: b.place_id,
              lat: b.lat,
              lng: b.lng,
              phone: b.phone,
              website: b.website,
              types: b.types,
            };
            if (this.geo.hasLocation() && b.lat && b.lng) {
              const miles = this.geo.distanceMiles(this.geo.lat()!, this.geo.lng()!, b.lat, b.lng);
              item.distanceMiles = miles;
              item.distance = this.geo.formatDistance(miles);
            }
            items.push(item);
          }
        }

        items.sort((a, b) => {
          if (a.type === 'prebuilt' && b.type !== 'prebuilt') return -1;
          if (b.type === 'prebuilt' && a.type !== 'prebuilt') return 1;
          return (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
        });

        items.push({
          type: 'custom',
          name: 'Build a custom website',
          address: 'Enter your business details manually',
        });

        this.results.set(items);
        this.dropdownOpen.set(true);
      });

    if (!this.auth.isLocationDeclined()) {
      setTimeout(() => this.checkGeolocation(), 5000);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(event: Event): void {
    const val = (event as CustomEvent).detail?.value ?? this.query;
    this.query = val;
    this.searchSubject.next(val);
  }

  selectItem(item: SearchItem): void {
    this.dropdownOpen.set(false);

    if (item.type === 'custom') {
      this.auth.setMode('custom');
      this.auth.clearSelectedBusiness();
      this.navigateToDetailsOrSignin();
      return;
    }

    if (item.type === 'prebuilt') {
      if (item.status === 'published' && item.slug) {
        window.location.href = `https://${item.slug}.projectsites.dev`;
        return;
      }
      if (item.siteId && ['building', 'queued', 'generating'].includes(item.status || '')) {
        this.router.navigate(['/waiting'], { queryParams: { id: item.siteId, slug: item.slug } });
        return;
      }
    }

    this.auth.setMode('business');
    this.auth.setSelectedBusiness({
      name: item.name,
      address: item.address,
      place_id: item.place_id,
      phone: item.phone,
      website: item.website,
      types: item.types,
      lat: item.lat,
      lng: item.lng,
    });

    if (item.place_id) {
      this.api.lookupSite(item.place_id).subscribe({
        next: (res) => {
          if (res.data) {
            this.router.navigate(['/waiting'], { queryParams: { id: res.data.id, slug: res.data.slug } });
          } else {
            this.navigateToDetailsOrSignin();
          }
        },
        error: () => this.navigateToDetailsOrSignin(),
      });
    } else {
      this.navigateToDetailsOrSignin();
    }
  }

  startBuildFlow(): void {
    this.navigateToDetailsOrSignin();
  }

  togglePricing(): void {
    this.isAnnual.update((v) => !v);
  }

  getPrice(monthly: number): string {
    if (this.isAnnual()) {
      return `$${Math.round(monthly * 0.8)}`;
    }
    return `$${monthly}`;
  }

  getPeriod(): string {
    return this.isAnnual() ? '/year' : '/month';
  }

  submitContactForm(): void {
    if (!this.contactName.trim() || !this.contactEmail.trim() || !this.contactMessage.trim()) {
      this.toast.error('Please fill in all fields');
      return;
    }
    this.contactSending.set(true);
    this.api.submitContact({
      name: this.contactName.trim(),
      email: this.contactEmail.trim(),
      message: this.contactMessage.trim(),
    }).subscribe({
      next: () => {
        this.contactSending.set(false);
        this.toast.success('Message sent! We\'ll get back to you soon.');
        this.contactName = '';
        this.contactEmail = '';
        this.contactMessage = '';
      },
      error: () => {
        this.contactSending.set(false);
        this.toast.error('Failed to send message. Please try again.');
      },
    });
  }

  private navigateToDetailsOrSignin(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/details']);
    } else {
      this.router.navigate(['/signin']);
    }
  }

  allowLocation(): void {
    this.showLocationPrompt.set(false);
    this.geo.requestLocation();
  }

  skipLocation(): void {
    this.showLocationPrompt.set(false);
    this.auth.setLocationDeclined();
  }

  closeDropdown(): void {
    setTimeout(() => this.dropdownOpen.set(false), 200);
  }

  private async checkGeolocation(): Promise<void> {
    if (this.geo.hasLocation()) return;
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') {
        this.geo.requestLocation();
      } else if (perm.state === 'prompt') {
        this.showLocationPrompt.set(true);
      }
    } catch {
      this.showLocationPrompt.set(true);
    }
  }
}
