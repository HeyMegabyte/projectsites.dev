import { Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, forkJoin, of, takeUntil } from 'rxjs';
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
  imports: [FormsModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private geo = inject(GeolocationService);
  private toast = inject(ToastService);
  private router = inject(Router);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  query = '';
  results = signal<SearchItem[]>([]);
  loading = signal(false);
  dropdownOpen = signal(false);
  showLocationPrompt = signal(false);

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

        // Pre-built sites first
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

        // Google Places results
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

        // Sort by distance if available
        items.sort((a, b) => {
          if (a.type === 'prebuilt' && b.type !== 'prebuilt') return -1;
          if (b.type === 'prebuilt' && a.type !== 'prebuilt') return 1;
          return (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
        });

        // Add custom option
        items.push({
          type: 'custom',
          name: 'Build a custom website',
          address: 'Enter your business details manually',
        });

        this.results.set(items);
        this.dropdownOpen.set(true);
      });

    // Request geolocation after delay
    if (!this.auth.isLocationDeclined()) {
      setTimeout(() => this.checkGeolocation(), 5000);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(): void {
    this.searchSubject.next(this.query);
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
        window.location.href = `https://${item.slug}-sites.megabyte.space`;
        return;
      }
      // If building, navigate to waiting
      if (item.siteId && ['building', 'queued', 'generating'].includes(item.status || '')) {
        this.router.navigate(['/waiting'], { queryParams: { id: item.siteId, slug: item.slug } });
        return;
      }
    }

    // Business or pre-built not yet published
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

    // Check if site already exists
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

  private navigateToDetailsOrSignin(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/details']);
    } else {
      this.router.navigate(['/signin']);
    }
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
      // Permissions API not supported
      this.showLocationPrompt.set(true);
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
}
