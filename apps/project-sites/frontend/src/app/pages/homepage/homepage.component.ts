import {
  Component,
  type OnInit,
  type OnDestroy,
  type AfterViewInit,
  inject,
  signal,
  ElementRef,
  ViewChild,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  forkJoin,
  of,
  takeUntil,
} from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';

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

/**
 * Homepage marketing page for ProjectSites.dev.
 *
 * @remarks
 * Full-viewport dark-themed landing page with hero, social proof, how-it-works,
 * features grid, pricing, FAQ accordion, and footer. All user-facing text uses
 * the ngx-translate pipe for i18n support (EN/ES).
 *
 * @example
 * ```html
 * <app-homepage />
 * ```
 */
@Component({
  selector: 'app-homepage',
  standalone: true,
  imports: [FormsModule, TranslateModule, RouterLink],
  templateUrl: './homepage.component.html',
  styleUrl: './homepage.component.scss',
})
export class HomepageComponent implements OnInit, OnDestroy, AfterViewInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private geo = inject(GeolocationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private platformId = inject(PLATFORM_ID);

  @ViewChild('heroSearch') heroSearchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('ctaSearch') ctaSearchInput!: ElementRef<HTMLInputElement>;

  heroQuery = '';
  ctaQuery = '';
  results = signal<SearchItem[]>([]);
  loading = signal(false);
  heroDropdownOpen = signal(false);
  ctaDropdownOpen = signal(false);
  currentLang = signal('en');
  navScrolled = signal(false);
  mobileMenuOpen = signal(false);
  openFaqIndex = signal<number | null>(null);

  private searchSubject = new Subject<{ query: string; source: 'hero' | 'cta' }>();
  activeSource = signal<'hero' | 'cta'>('hero');
  private destroy$ = new Subject<void>();
  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    this.currentLang.set(this.translate.currentLang || this.translate.defaultLang || 'en');

    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged((a, b) => a.query === b.query),
        switchMap(({ query, source }) => {
          this.activeSource.set(source);
          if (query.length < 2) {
            this.results.set([]);
            this.heroDropdownOpen.set(false);
            this.ctaDropdownOpen.set(false);
            return of(null);
          }
          this.loading.set(true);
          const lat = this.geo.lat() ?? undefined;
          const lng = this.geo.lng() ?? undefined;
          return forkJoin({
            businesses: this.api.searchBusinesses(query, lat, lng),
            sites: this.api.searchSites(query),
          });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((res) => {
        this.loading.set(false);
        if (!res) return;

        const items: SearchItem[] = [];
        const seen = new Set<string>();

        const placeMap = new Map<string, any>();
        for (const b of res.businesses.data || []) {
          if (b.place_id) placeMap.set(b.place_id, b);
        }

        for (const s of res.sites.data || []) {
          const key = s.place_id || s.business_name;
          if (!seen.has(key)) {
            seen.add(key);
            const placeData = s.place_id ? placeMap.get(s.place_id) : undefined;
            const item: SearchItem = {
              type: 'prebuilt',
              name: s.business_name,
              address: s.business_address,
              place_id: s.place_id,
              siteId: s.id,
              slug: s.slug,
              status: s.status,
              lat: placeData?.lat,
              lng: placeData?.lng,
              phone: placeData?.phone,
              website: placeData?.website,
              types: placeData?.types,
            };
            if (this.geo.hasLocation() && placeData?.lat && placeData?.lng) {
              const miles = this.geo.distanceMiles(this.geo.lat()!, this.geo.lng()!, placeData.lat, placeData.lng);
              item.distanceMiles = miles;
              item.distance = this.geo.formatDistance(miles);
            }
            items.push(item);
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
        if (this.activeSource() === 'hero') {
          this.heroDropdownOpen.set(true);
          this.ctaDropdownOpen.set(false);
        } else {
          this.ctaDropdownOpen.set(true);
          this.heroDropdownOpen.set(false);
        }
      });

    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('scroll', this.onScroll);
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.initScrollReveal();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('scroll', this.onScroll);
    }
    this.observer?.disconnect();
  }

  private onScroll = (): void => {
    this.navScrolled.set(window.scrollY > 40);
  };

  private initScrollReveal(): void {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('revealed');
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    els.forEach((el) => this.observer?.observe(el));
  }

  onHeroSearch(): void {
    this.searchSubject.next({ query: this.heroQuery, source: 'hero' });
  }

  onCtaSearch(): void {
    this.searchSubject.next({ query: this.ctaQuery, source: 'cta' });
  }

  selectItem(item: SearchItem): void {
    this.heroDropdownOpen.set(false);
    this.ctaDropdownOpen.set(false);

    if (item.type === 'custom') {
      this.auth.setMode('custom');
      this.auth.clearSelectedBusiness();
      this.navigateToDetailsOrSignin();
      return;
    }

    this.auth.setMode('business');
    localStorage.removeItem('ps_create_draft');
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

    this.navigateToDetailsOrSignin();
  }

  private navigateToDetailsOrSignin(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/create']);
    } else {
      this.router.navigate(['/signin']);
    }
  }

  closeHeroDropdown(): void {
    setTimeout(() => this.heroDropdownOpen.set(false), 200);
  }

  closeCtaDropdown(): void {
    setTimeout(() => this.ctaDropdownOpen.set(false), 200);
  }

  toggleFaq(index: number): void {
    this.openFaqIndex.set(this.openFaqIndex() === index ? null : index);
  }

  toggleLang(): void {
    const next = this.currentLang() === 'en' ? 'es' : 'en';
    this.translate.use(next);
    this.currentLang.set(next);
    localStorage.setItem('ps_language', next);
    // Update document lang attribute for accessibility + SEO
    document.documentElement.lang = next;
  }

  scrollTo(id: string): void {
    this.mobileMenuOpen.set(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  goSignin(): void {
    this.mobileMenuOpen.set(false);
    this.router.navigate(['/signin']);
  }

  goGetStarted(): void {
    this.mobileMenuOpen.set(false);
    if (this.heroSearchInput?.nativeElement) {
      this.heroSearchInput.nativeElement.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
