import { Component, type OnInit, type OnDestroy, inject, signal, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService, type SelectedBusiness } from '../../services/auth.service';
import { GeolocationService } from '../../services/geolocation.service';
import { ToastService } from '../../services/toast.service';

/**
 * Clean a URL for display and storage — strips tracking parameters (utm_*,
 * fbclid, gclid, etc.), removes trailing slashes, and normalizes the URL
 * for a polished, professional appearance.
 */
function cleanUrl(raw: string): string {
  if (!raw || !raw.trim()) return '';
  try {
    let urlStr = raw.trim();
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr;
    }
    const url = new URL(urlStr);
    // Remove tracking / analytics query params
    const junkParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'gad_source', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
      'yclid', 'twclid', 'igshid', 'ref', 'source', 'si',
      '_ga', '_gl', '_hsenc', '_hsmi', 'hsa_cam', 'hsa_grp', 'hsa_mt',
      'hsa_src', 'hsa_ad', 'hsa_acc', 'hsa_net', 'hsa_ver', 'hsa_kw',
    ];
    for (const p of junkParams) url.searchParams.delete(p);
    // If no meaningful params remain, strip the query entirely
    let cleaned = url.origin + url.pathname;
    if (url.searchParams.toString()) cleaned += '?' + url.searchParams.toString();
    // Remove trailing slash (unless it's just the root)
    if (cleaned.endsWith('/') && cleaned !== url.origin + '/') {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  } catch {
    // If URL parsing fails, just strip obvious utm params with regex
    return raw.trim().replace(/[?&](utm_\w+|fbclid|gclid|gad_source|ref|source|si)=[^&#]*/gi, '').replace(/\?$/, '');
  }
}

/**
 * Address autocomplete suggestion from Google Places API.
 *
 * @remarks
 * Displayed in the address dropdown when the user types 3+ characters.
 * The `place_id` is used for precise geocoding if needed.
 *
 * @see {@link CreateComponent.addressSuggestions}
 */
interface AddressSuggestion {
  description: string;
  place_id?: string;
}

/**
 * Business suggestion from the Google Places business search API.
 *
 * @remarks
 * Selecting a business from the dropdown auto-populates all form fields:
 * name, address, phone, and website. The `place_id` is passed to the
 * backend for enriched research during AI site generation.
 *
 * @example
 * ```typescript
 * { name: "Vito's Mens Salon", address: "74 N Beverwyck Rd...",
 *   place_id: "ChIJ...", phone: "(973) 123-4567",
 *   website: "https://vitos-salon.com" }
 * ```
 *
 * @see {@link CreateComponent.selectBusiness}
 */
interface BusinessSuggestion {
  name: string;
  address: string;
  place_id: string;
  phone?: string;
  website?: string;
  types?: string[];
}

/**
 * Create/Reset Website page — the primary site creation form.
 *
 * @remarks
 * This component handles the complete site creation flow:
 *
 * ```
 * ┌─────────────────────────────────────────────────┐
 * │  /create                                         │
 * │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
 * │  │ Business │  │ Address  │  │ Phone/Website │  │
 * │  │ Name *   │  │ *        │  │ (auto-filled) │  │
 * │  └──────────┘  └──────────┘  └───────────────┘  │
 * │                                                   │
 * │  [Auto-Populate with AI]                          │
 * │                                                   │
 * │  ┌─────────────────────────────────────────────┐  │
 * │  │ Additional Context (optional)               │  │
 * │  └─────────────────────────────────────────────┘  │
 * │                                                   │
 * │  [Build My Website] → /waiting?id=...&slug=...    │
 * └─────────────────────────────────────────────────┘
 * ```
 *
 * **Auto-populate flow:**
 * 1. User types business name → debounced search (300ms, min 2 chars)
 * 2. Dropdown shows Google Places results with name + address
 * 3. Selecting a result fills: name, address, phone, website
 * 4. "Auto-Populate with AI" button fetches additional data
 *
 * **Submission paths:**
 * - Not logged in → store data, redirect to `/signin`
 * - Logged in, new site → `POST /api/sites/create-from-search` → `/waiting`
 * - Logged in, reset mode → `POST /api/sites/:id/reset` → `/admin`
 *
 * @see {@link WaitingComponent} — displays real-time build progress
 * @see {@link AdminComponent} — dashboard where "Reset & Rebuild" originates
 */
@Component({
  selector: 'app-create',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './create.component.html',
  styleUrl: './create.component.scss',
})
export class CreateComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  auth = inject(AuthService);
  private geo = inject(GeolocationService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);

  businessName = '';
  businessAddress = '';
  businessPhone = '';
  businessWebsite = '';
  businessCategory = '';
  additionalContext = '';
  submitting = signal(false);

  /** Industry categories for the dropdown */
  categories = [
    '', 'Restaurant / Café', 'Salon / Barbershop', 'Legal / Law Firm',
    'Medical / Healthcare', 'Retail / Shop', 'Technology / SaaS',
    'Construction / Home Services', 'Fitness / Gym', 'Real Estate',
    'Photography / Creative', 'Automotive', 'Education / Tutoring',
    'Financial / Accounting', 'Other',
  ];

  // Reset mode: when navigating from admin "Reset & Rebuild"
  resetSiteId: string | null = null;

  // Selected business from search (badge mode)
  selectedBusiness = signal<SelectedBusiness | null>(null);

  // Address autocomplete
  addressSuggestions = signal<AddressSuggestion[]>([]);
  addressDropdownOpen = signal(false);
  private addressSubject = new Subject<string>();

  // Business name autocomplete
  businessSuggestions = signal<BusinessSuggestion[]>([]);
  businessDropdownOpen = signal(false);
  private businessSubject = new Subject<string>();

  // Auto-populate AI
  autoPopulating = signal(false);

  // Per-field loading indicators for auto-populate
  loadingPhone = signal(false);
  loadingWebsite = signal(false);
  loadingCategory = signal(false);
  loadingContext = signal(false);

  // AI image discovery
  discoveringImages = signal(false);

  // Image modal
  modalImage = signal<string | null>(null);
  modalImageName = signal('');
  modalAiPrompt = '';
  modalAiProcessing = signal(false);
  aiLogoUrl: string | null = null;
  aiLogoQuality: { quality_score: number; recommendation: string; description: string } | null = null;
  aiFaviconUrl: string | null = null;
  aiFaviconQuality: { quality_score: number; recommendation: string; description: string } | null = null;
  aiImageUrls: { url: string; name: string; quality?: { quality_score: number; recommendation: string; description: string } | null }[] = [];
  brandAssessment: { brand_maturity: string; website_quality_score: number; asset_strategy: string; recommendation: string } | null = null;

  // File uploads
  logoFile: File | null = null;
  logoPreview: string | null = null;
  faviconFile: File | null = null;
  faviconPreview: string | null = null;
  additionalFiles: File[] = [];
  imagePreviews: { name: string; url: string }[] = [];

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    // Pre-fill from query params if present (e.g., /create?name=Foo&address=Bar)
    const params = this.route.snapshot.queryParams;
    if (params['name']) this.businessName = params['name'];
    if (params['address']) this.businessAddress = params['address'];
    if (params['phone']) this.businessPhone = params['phone'];
    if (params['website']) this.businessWebsite = cleanUrl(params['website']);
    if (params['reset']) this.resetSiteId = params['reset'];

    // Check if coming from search selection
    const shouldAutoCreate = this.auth.getAutoCreate();
    const hasPendingBuild = this.auth.getPendingBuild();
    const biz = this.auth.getSelectedBusiness();

    if (biz) {
      // Coming from search selection — always use stored business data
      if (this.auth.getMode() === 'business' && biz.place_id) {
        this.selectedBusiness.set(biz);
      }
      this.businessName = biz.name || this.businessName;
      this.businessAddress = biz.address || this.businessAddress;
      if (biz.phone) this.businessPhone = biz.phone;
      if (biz.website) this.businessWebsite = cleanUrl(biz.website);
      // Clear pendingBuild if it was set just for navigation (not for auto-submit)
      if (hasPendingBuild && !this.auth.isLoggedIn()) {
        // Keep pendingBuild — user needs to sign in first
      } else if (hasPendingBuild && this.auth.isLoggedIn() && !shouldAutoCreate) {
        this.auth.setPendingBuild(false);
      }
    } else if (!params['name']) {
      // No business selected and no query params — restore from localStorage draft
      this.restoreFormDraft();
    }

    // Auto-Create with AI: trigger auto-populate after a short delay to let the view settle
    if (shouldAutoCreate && this.businessName && this.businessAddress) {
      this.auth.setAutoCreate(false);
      setTimeout(() => this.autoPopulate(), 300);
    }

    // Pending build: user was redirected to signin, now logged in — auto-submit
    if (hasPendingBuild && this.auth.isLoggedIn() && this.businessName && this.businessAddress) {
      this.auth.setPendingBuild(false);
      setTimeout(() => this.submitBuild(), 500);
    }

    // Business name autocomplete
    this.businessSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) {
            this.businessSuggestions.set([]);
            this.businessDropdownOpen.set(false);
            return of(null);
          }
          const lat = this.geo.lat() ?? undefined;
          const lng = this.geo.lng() ?? undefined;
          return this.api.searchBusinesses(q, lat, lng);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (!res) return;
          this.businessSuggestions.set(res.data || []);
          this.businessDropdownOpen.set((res.data || []).length > 0);
        },
        error: () => {
          this.businessSuggestions.set([]);
          this.businessDropdownOpen.set(false);
        },
      });

    // Address autocomplete
    this.addressSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 3) {
            this.addressSuggestions.set([]);
            this.addressDropdownOpen.set(false);
            return of(null);
          }
          const lat = this.geo.lat() ?? undefined;
          const lng = this.geo.lng() ?? undefined;
          return this.api.searchAddress(q, lat, lng);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (!res) return;
          this.addressSuggestions.set(res.data || []);
          this.addressDropdownOpen.set((res.data || []).length > 0);
        },
        error: () => {
          this.addressSuggestions.set([]);
          this.addressDropdownOpen.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onAddressInput(): void {
    this.addressSubject.next(this.businessAddress);
  }

  selectAddress(suggestion: AddressSuggestion): void {
    this.businessAddress = suggestion.description;
    this.addressDropdownOpen.set(false);
  }

  closeAddressDropdown(): void {
    setTimeout(() => this.addressDropdownOpen.set(false), 200);
  }

  onBusinessInput(): void {
    this.businessSubject.next(this.businessName);
  }

  /**
   * Handles business selection from the autocomplete dropdown.
   *
   * @remarks
   * Auto-populates all form fields from the selected business:
   * - Business name (always)
   * - Business address (always)
   * - Phone number (if available from Google Places)
   * - Existing website URL (if available from Google Places)
   *
   * @param biz - The selected business suggestion from Google Places
   */
  selectBusiness(biz: BusinessSuggestion): void {
    this.businessName = biz.name;
    if (biz.address && !this.businessAddress.trim()) this.businessAddress = biz.address;
    if (biz.address) this.businessAddress = biz.address;
    if (biz.phone && !this.businessPhone.trim()) this.businessPhone = biz.phone;
    if (biz.website && !this.businessWebsite.trim()) this.businessWebsite = cleanUrl(biz.website);
    this.businessDropdownOpen.set(false);
    // Set the selected business badge
    this.selectedBusiness.set({
      name: biz.name,
      address: biz.address,
      place_id: biz.place_id,
      phone: biz.phone,
      website: biz.website,
    });
    this.saveFormDraft();
  }

  closeBusinessDropdown(): void {
    setTimeout(() => this.businessDropdownOpen.set(false), 200);
  }

  dismissBusiness(): void {
    this.selectedBusiness.set(null);
  }

  autoPopulate(): void {
    if (!this.businessName.trim()) {
      this.toast.error('Enter a business name first');
      return;
    }
    this.autoPopulating.set(true);
    this.loadingPhone.set(true);
    this.loadingWebsite.set(true);
    this.loadingCategory.set(true);
    this.loadingContext.set(true);
    const lat = this.geo.lat() ?? undefined;
    const lng = this.geo.lng() ?? undefined;
    this.api.searchBusinesses(this.businessName, lat, lng).subscribe({
      next: (res) => {
        const searchTerm = this.businessName.toLowerCase().trim();
        const match = (res.data || []).find(
          (b) => b.name.toLowerCase().includes(searchTerm) || searchTerm.includes(b.name.toLowerCase())
        );
        if (match) {
          // Always overwrite fields from match (supports switching businesses)
          this.businessPhone = match.phone || '';
          this.loadingPhone.set(false);
          this.businessWebsite = cleanUrl(match.website || '');
          this.loadingWebsite.set(false);
          if (match.address) this.businessAddress = match.address;
          // Always regenerate context prompt
          this.additionalContext = this.generateContextPrompt(match);
          this.loadingContext.set(false);
          this.cdr.detectChanges();
          this.toast.success('Auto-populated from Google Places');
          // Discover brand images in the background
          this.discoverBrandImages(match.website);
        } else {
          // No match — generate context from name + inferred category
          this.loadingPhone.set(false);
          this.loadingWebsite.set(false);
          const inferred = this.inferCategoryFromName(this.businessName);
          const design = this.getDesignRecommendations(inferred || '');
          const parts: string[] = [];
          parts.push(`Design style: ${design.style}.`);
          parts.push(`Brand colors: primary ${design.primaryColor}, accent ${design.accentColor}.`);
          parts.push(`Typography: ${design.headingFont} for headings, ${design.bodyFont} for body text.`);
          parts.push(`Target audience: ${design.audience}.`);
          parts.push('');
          parts.push(`Recommended sections: ${design.sections.join(', ')}.`);
          parts.push('');
          parts.push('Include smooth scroll animations, hover micro-interactions, and a responsive mobile-first layout.');
          parts.push('Prioritize vibrant, colorful design with bold gradients and dynamic visual elements.');
          this.additionalContext = parts.join('\n');
          this.loadingContext.set(false);
          this.cdr.detectChanges();
          this.toast.info('No exact match — populated from business name');
          this.discoverBrandImages(this.businessWebsite || undefined);
        }

        // ALWAYS set category via AI — with 8s timeout fallback
        const types = match?.types || this.selectedBusiness()?.types;
        // Set a timeout: if AI doesn't respond in 8s, use local inference
        const categoryTimeout = setTimeout(() => {
          if (this.loadingCategory()) {
            const inferred = this.inferCategory(types) || this.inferCategoryFromName(this.businessName);
            this.businessCategory = inferred || 'Other';
            this.loadingCategory.set(false);
            this.cdr.detectChanges();
          }
        }, 8000);

        this.api.categorize(
          this.businessName,
          this.businessAddress,
          types,
        ).subscribe({
          next: (catRes) => {
            clearTimeout(categoryTimeout);
            const aiCategory = catRes.data?.category;
            if (aiCategory && aiCategory !== 'Other') {
              this.businessCategory = aiCategory;
            } else {
              const inferred = this.inferCategory(types) ||
                this.inferCategoryFromName(this.businessName);
              this.businessCategory = inferred || aiCategory || 'Other';
            }
            this.loadingCategory.set(false);
            this.cdr.detectChanges();
          },
          error: () => {
            clearTimeout(categoryTimeout);
            const inferred = this.inferCategory(types) ||
              this.inferCategoryFromName(this.businessName);
            this.businessCategory = inferred || 'Other';
            this.loadingCategory.set(false);
            this.cdr.detectChanges();
          },
        });

        this.autoPopulating.set(false);
        this.saveFormDraft();
      },
      error: () => {
        // Even on search error, still try to set category locally
        const inferred = this.inferCategoryFromName(this.businessName);
        this.businessCategory = inferred || 'Other';
        this.cdr.detectChanges();
        this.autoPopulating.set(false);
        this.saveFormDraft();
        this.toast.error('Auto-populate failed — category set from business name');
      },
    });
  }

  private discoverBrandImages(website?: string): void {
    // Clear previous AI-discovered images before loading new ones
    this.aiLogoUrl = null;
    this.aiLogoQuality = null;
    this.aiFaviconUrl = null;
    this.aiFaviconQuality = null;
    this.aiImageUrls = [];
    this.brandAssessment = null;
    this.discoveringImages.set(true);
    this.cdr.detectChanges();

    this.api.discoverImages(
      this.businessName.trim(),
      this.businessAddress.trim() || undefined,
      website,
    ).subscribe({
      next: (res) => {
        const data = res.data;
        if (data.logo?.url && !this.logoFile) {
          this.aiLogoUrl = data.logo.url;
          this.aiLogoQuality = data.logo.quality || null;
        }
        if (data.favicon?.url && !this.faviconFile) {
          this.aiFaviconUrl = data.favicon.url;
          this.aiFaviconQuality = data.favicon.quality || null;
        }
        this.aiImageUrls = (data.images || []).map((img: { url: string; name: string; quality?: { quality_score: number; recommendation: string; description: string } | null }) => ({
          url: img.url,
          name: img.name,
          quality: img.quality || null,
        }));
        this.brandAssessment = data.brand_assessment || null;
        this.discoveringImages.set(false);
        this.cdr.detectChanges();
        this.saveFormDraft();
      },
      error: () => {
        this.discoveringImages.set(false);
      },
    });
  }

  private generateContextPrompt(match: BusinessSuggestion): string {
    const biz = this.selectedBusiness();
    const types = match.types || biz?.types;
    const parts: string[] = [];
    const category = this.businessCategory || this.inferCategory(types) || this.inferCategoryFromName(this.businessName);

    // Industry context (no phone/address — those are already in the form fields)
    if (types && types.length > 0) {
      const readable = types
        .filter((t) => !['point_of_interest', 'establishment'].includes(t))
        .map((t) => t.replace(/_/g, ' '))
        .slice(0, 4);
      if (readable.length > 0) {
        parts.push(`Industry: ${readable.join(', ')}.`);
      }
    }

    // Design recommendations based on category
    const design = this.getDesignRecommendations(category);
    parts.push(`Design style: ${design.style}.`);
    parts.push(`Brand colors: primary ${design.primaryColor}, accent ${design.accentColor}.`);
    parts.push(`Typography: ${design.headingFont} for headings, ${design.bodyFont} for body text.`);
    parts.push(`Target audience: ${design.audience}.`);
    parts.push('');
    parts.push(`Recommended sections: ${design.sections.join(', ')}.`);
    parts.push('');
    parts.push('Include smooth scroll animations, hover micro-interactions, and a responsive mobile-first layout.');
    parts.push('Add a professional contact form with validation.');
    parts.push('Use high-quality placeholder images with CSS gradient fallbacks.');
    parts.push('Prioritize vibrant, colorful design with bold gradients and dynamic visual elements.');
    if (design.extras) parts.push(design.extras);

    return parts.join('\n');
  }

  private inferCategory(types?: string[]): string {
    if (!types) return '';
    const t = types.join(' ').toLowerCase();
    if (t.includes('restaurant') || t.includes('food') || t.includes('cafe')) return 'Restaurant / Café';
    if (t.includes('hair') || t.includes('beauty') || t.includes('salon') || t.includes('barber')) return 'Salon / Barbershop';
    if (t.includes('lawyer') || t.includes('law')) return 'Legal / Law Firm';
    if (t.includes('doctor') || t.includes('health') || t.includes('dentist') || t.includes('medical')) return 'Medical / Healthcare';
    if (t.includes('store') || t.includes('shop') || t.includes('retail')) return 'Retail / Shop';
    if (t.includes('gym') || t.includes('fitness')) return 'Fitness / Gym';
    if (t.includes('real_estate')) return 'Real Estate';
    if (t.includes('car') || t.includes('auto')) return 'Automotive';
    return '';
  }

  private inferCategoryFromName(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('pizza') || n.includes('restaurant') || n.includes('café') || n.includes('cafe') || n.includes('grill') || n.includes('bistro') || n.includes('kitchen') || n.includes('diner') || n.includes('bakery') || n.includes('sushi')) return 'Restaurant / Café';
    if (n.includes('salon') || n.includes('barber') || n.includes('hair') || n.includes('beauty') || n.includes('shear') || n.includes('cuts')) return 'Salon / Barbershop';
    if (n.includes('law') || n.includes('legal') || n.includes('attorney') || n.includes('counsel')) return 'Legal / Law Firm';
    if (n.includes('dental') || n.includes('medical') || n.includes('clinic') || n.includes('health') || n.includes('doctor') || n.includes('chiro') || n.includes('therapy') || n.includes('pharma')) return 'Medical / Healthcare';
    if (n.includes('tech') || n.includes('software') || n.includes('digital') || n.includes('solutions') || n.includes('systems') || n.includes('cloud') || n.includes('app')) return 'Technology / SaaS';
    if (n.includes('fitness') || n.includes('gym') || n.includes('crossfit') || n.includes('yoga') || n.includes('pilates') || n.includes('forge')) return 'Fitness / Gym';
    if (n.includes('realty') || n.includes('real estate') || n.includes('properties') || n.includes('homes')) return 'Real Estate';
    if (n.includes('photo') || n.includes('studio') || n.includes('creative') || n.includes('design') || n.includes('art')) return 'Photography / Creative';
    if (n.includes('construct') || n.includes('plumb') || n.includes('electric') || n.includes('roofing') || n.includes('hvac') || n.includes('landscap')) return 'Construction / Home Services';
    if (n.includes('auto') || n.includes('motor') || n.includes('car') || n.includes('tire') || n.includes('mechanic')) return 'Automotive';
    if (n.includes('school') || n.includes('tutor') || n.includes('academy') || n.includes('learning')) return 'Education / Tutoring';
    if (n.includes('account') || n.includes('tax') || n.includes('financial') || n.includes('invest') || n.includes('insurance')) return 'Financial / Accounting';
    if (n.includes('shop') || n.includes('store') || n.includes('boutique') || n.includes('market')) return 'Retail / Shop';
    if (n.includes('pub') || n.includes('bar') || n.includes('tavern') || n.includes('lounge') || n.includes('brew')) return 'Restaurant / Café';
    if (n.includes('express') || n.includes('delivery') || n.includes('ship') || n.includes('courier') || n.includes('logistics') || n.includes('택배') || n.includes('parcel') || n.includes('freight')) return 'Retail / Shop';
    return '';
  }

  private getDesignRecommendations(category: string): {
    style: string; primaryColor: string; accentColor: string;
    headingFont: string; bodyFont: string; audience: string;
    sections: string[]; extras?: string;
  } {
    const defaults: {
      style: string; primaryColor: string; accentColor: string;
      headingFont: string; bodyFont: string; audience: string;
      sections: string[]; extras?: string;
    } = {
      style: 'Modern minimalist with bold typography',
      primaryColor: '#1a1a2e', accentColor: '#e94560',
      headingFont: 'Montserrat', bodyFont: 'Inter',
      audience: 'Local customers and online visitors',
      sections: ['Hero with CTA', 'Services', 'About', 'Testimonials', 'Gallery', 'Contact', 'Footer with social links'],
    };

    const map: Record<string, Partial<typeof defaults>> = {
      'Restaurant / Café': {
        style: 'Warm and inviting with food photography emphasis',
        primaryColor: '#2d1810', accentColor: '#d4a574',
        headingFont: 'Playfair Display', bodyFont: 'Lato',
        audience: 'Diners, food enthusiasts, and families looking for a great meal',
        sections: ['Hero with ambiance photo', 'Menu highlights', 'About the chef', 'Hours & location', 'Reservations', 'Gallery', 'Reviews', 'Contact'],
        extras: 'Include a menu section with prices. Add OpenTable or reservation widget placeholder. Show business hours prominently.',
      },
      'Salon / Barbershop': {
        style: 'Sleek and premium with dark accents',
        primaryColor: '#1a1a2e', accentColor: '#c9a96e',
        headingFont: 'Cormorant Garamond', bodyFont: 'Raleway',
        audience: 'Style-conscious clients seeking premium grooming services',
        sections: ['Hero with salon interior', 'Services & pricing', 'Meet the team', 'Before/After gallery', 'Booking CTA', 'Reviews', 'Location & hours', 'Contact'],
        extras: 'Include a booking button linking to scheduling software. Show service prices in a clean grid.',
      },
      'Legal / Law Firm': {
        style: 'Professional and trustworthy with serif typography',
        primaryColor: '#1b2a4a', accentColor: '#c0922e',
        headingFont: 'Merriweather', bodyFont: 'Source Sans Pro',
        audience: 'Individuals and businesses seeking legal representation',
        sections: ['Hero with firm name', 'Practice areas', 'Attorney profiles', 'Case results', 'Testimonials', 'Free consultation CTA', 'Blog/Resources', 'Contact'],
        extras: 'Include a "Free Consultation" CTA prominently. Add practice area icons. Professional headshots section.',
      },
      'Medical / Healthcare': {
        style: 'Clean, calming, and trustworthy',
        primaryColor: '#0a2647', accentColor: '#2196f3',
        headingFont: 'Poppins', bodyFont: 'Open Sans',
        audience: 'Patients seeking quality healthcare services',
        sections: ['Hero with facility', 'Services', 'Provider profiles', 'Patient testimonials', 'Insurance accepted', 'Online booking', 'Location & hours', 'Contact'],
        extras: 'Include HIPAA compliance notice in footer. Add a patient portal link placeholder.',
      },
      'Technology / SaaS': {
        style: 'Futuristic with gradient accents and glassmorphism',
        primaryColor: '#0f0f23', accentColor: '#6366f1',
        headingFont: 'Space Grotesk', bodyFont: 'Inter',
        audience: 'Tech-savvy professionals and businesses',
        sections: ['Hero with product demo', 'Features grid', 'How it works', 'Pricing', 'Integrations', 'Testimonials', 'FAQ', 'CTA'],
        extras: 'Include animated feature cards. Add a product screenshot or demo video placeholder.',
      },
      'Fitness / Gym': {
        style: 'Bold and energetic with high contrast',
        primaryColor: '#1a1a2e', accentColor: '#ff4444',
        headingFont: 'Oswald', bodyFont: 'Roboto',
        audience: 'Fitness enthusiasts and health-conscious individuals',
        sections: ['Hero with action shot', 'Classes & programs', 'Trainers', 'Membership plans', 'Facility gallery', 'Success stories', 'Free trial CTA', 'Contact'],
        extras: 'Include class schedule section. Bold "Join Now" CTA with pricing.',
      },
      'Real Estate': {
        style: 'Elegant with large property imagery',
        primaryColor: '#1a1a2e', accentColor: '#2ecc71',
        headingFont: 'Libre Baskerville', bodyFont: 'Nunito',
        audience: 'Home buyers, sellers, and investors',
        sections: ['Hero with featured listing', 'Featured properties', 'Agent profile', 'Services', 'Market stats', 'Testimonials', 'Search CTA', 'Contact'],
        extras: 'Include property cards with price, beds, baths. Add neighborhood guides section.',
      },
      'Construction / Home Services': {
        style: 'Rugged and reliable with strong imagery',
        primaryColor: '#2c3e50', accentColor: '#e67e22',
        headingFont: 'Roboto Slab', bodyFont: 'Roboto',
        audience: 'Homeowners and businesses needing renovation or repair services',
        sections: ['Hero with project photo', 'Services', 'Project gallery', 'Process steps', 'Testimonials', 'Certifications', 'Free estimate CTA', 'Contact'],
        extras: 'Include a "Get Free Estimate" form prominently. Show before/after project photos.',
      },
      'Photography / Creative': {
        style: 'Minimal with maximum focus on visual work',
        primaryColor: '#111111', accentColor: '#ffffff',
        headingFont: 'DM Sans', bodyFont: 'DM Sans',
        audience: 'Clients looking for professional photography or creative services',
        sections: ['Full-screen hero gallery', 'Portfolio grid', 'About', 'Services & packages', 'Client love', 'Booking', 'Contact'],
        extras: 'Use a masonry grid for the portfolio. Large, full-bleed images throughout.',
      },
    };

    const rec = map[category];
    return rec ? { ...defaults, ...rec } as typeof defaults : defaults;
  }

  // ── Form draft persistence (localStorage) ──────────────────

  private static readonly DRAFT_KEY = 'ps_create_draft';

  saveFormDraft(): void {
    const draft = {
      businessName: this.businessName,
      businessAddress: this.businessAddress,
      businessPhone: this.businessPhone,
      businessWebsite: this.businessWebsite,
      businessCategory: this.businessCategory,
      additionalContext: this.additionalContext,
      aiLogoUrl: this.aiLogoUrl,
      aiLogoQuality: this.aiLogoQuality,
      aiFaviconUrl: this.aiFaviconUrl,
      aiFaviconQuality: this.aiFaviconQuality,
      aiImageUrls: this.aiImageUrls,
      brandAssessment: this.brandAssessment,
      selectedBusiness: this.selectedBusiness(),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(CreateComponent.DRAFT_KEY, JSON.stringify(draft));
    } catch { /* quota exceeded — ignore */ }
  }

  private restoreFormDraft(): void {
    try {
      const raw = localStorage.getItem(CreateComponent.DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Only restore if saved within the last 24 hours
      if (draft.savedAt && Date.now() - draft.savedAt > 86400000) {
        localStorage.removeItem(CreateComponent.DRAFT_KEY);
        return;
      }
      if (draft.businessName) this.businessName = draft.businessName;
      if (draft.businessAddress) this.businessAddress = draft.businessAddress;
      if (draft.businessPhone) this.businessPhone = draft.businessPhone;
      if (draft.businessWebsite) this.businessWebsite = cleanUrl(draft.businessWebsite);
      if (draft.businessCategory) this.businessCategory = draft.businessCategory;
      if (draft.additionalContext) this.additionalContext = draft.additionalContext;
      if (draft.aiLogoUrl) this.aiLogoUrl = draft.aiLogoUrl;
      if (draft.aiLogoQuality) this.aiLogoQuality = draft.aiLogoQuality;
      if (draft.aiFaviconUrl) this.aiFaviconUrl = draft.aiFaviconUrl;
      if (draft.aiFaviconQuality) this.aiFaviconQuality = draft.aiFaviconQuality;
      if (draft.brandAssessment) this.brandAssessment = draft.brandAssessment;
      if (draft.aiImageUrls?.length) this.aiImageUrls = draft.aiImageUrls;
      if (draft.selectedBusiness?.place_id) this.selectedBusiness.set(draft.selectedBusiness);
      // Force Angular to pick up the category select value
      setTimeout(() => this.cdr.detectChanges(), 0);
    } catch { /* corrupt data — ignore */ }
  }

  clearFormDraft(): void {
    localStorage.removeItem(CreateComponent.DRAFT_KEY);
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && file.size <= 5 * 1024 * 1024) {
      this.logoFile = file;
      this.logoPreview = URL.createObjectURL(file);
    } else if (file) {
      this.toast.error('Logo must be under 5 MB');
    }
  }

  removeLogo(): void {
    this.logoFile = null;
    this.aiLogoUrl = null;
    if (this.logoPreview) { URL.revokeObjectURL(this.logoPreview); this.logoPreview = null; }
  }

  onFaviconSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && file.size <= 2 * 1024 * 1024 && file.type === 'image/png') {
      this.faviconFile = file;
      this.faviconPreview = URL.createObjectURL(file);
    } else if (file) {
      this.toast.error('Favicon must be a PNG under 2 MB');
    }
  }

  removeFavicon(): void {
    this.faviconFile = null;
    this.aiFaviconUrl = null;
    if (this.faviconPreview) { URL.revokeObjectURL(this.faviconPreview); this.faviconPreview = null; }
  }

  removeAiImage(url: string): void {
    this.aiImageUrls = this.aiImageUrls.filter(img => img.url !== url);
    this.saveFormDraft();
  }

  onAiLogoError(): void {
    this.aiLogoUrl = null;
    this.saveFormDraft();
  }

  onAiFaviconError(): void {
    this.aiFaviconUrl = null;
    this.saveFormDraft();
  }

  onAiImageLoad(event: Event, url: string): void {
    const img = event.target as HTMLImageElement;
    // Remove images that loaded but are actually transparent 1x1 pixels or tiny placeholders
    if (img.naturalWidth <= 2 || img.naturalHeight <= 2) {
      this.removeAiImage(url);
      return;
    }
    // JS fallback: force the correct width based on aspect ratio at 64px height
    const ratio = img.naturalWidth / img.naturalHeight;
    const targetWidth = Math.round(64 * ratio);
    img.style.width = targetWidth + 'px';
    img.style.height = '64px';
  }

  openImageModal(url: string, name: string): void {
    this.modalImage.set(url);
    this.modalImageName.set(name);
    this.modalAiPrompt = '';
    this.modalAiProcessing.set(false);
  }

  closeImageModal(): void {
    this.modalImage.set(null);
    this.modalImageName.set('');
    this.modalAiPrompt = '';
    this.modalAiProcessing.set(false);
  }

  submitImageAiEdit(): void {
    if (!this.modalAiPrompt.trim() || this.modalAiProcessing()) return;
    const currentUrl = this.modalImage();
    const currentName = this.modalImageName();
    this.modalAiProcessing.set(true);

    this.api.editImage(this.modalAiPrompt, currentUrl || undefined).subscribe({
      next: (res) => {
        const newUrl = res.data.url;
        // Preload the new image before swapping — keep processing state until loaded
        const preload = new Image();
        preload.onload = () => {
          // Replace the image in whichever slot it belongs to
          if (currentUrl === this.aiLogoUrl) {
            this.aiLogoUrl = newUrl;
          } else if (currentUrl === this.aiFaviconUrl) {
            this.aiFaviconUrl = newUrl;
          } else {
            const idx = this.aiImageUrls.findIndex(img => img.url === currentUrl);
            if (idx >= 0) {
              this.aiImageUrls[idx] = { url: newUrl, name: this.aiImageUrls[idx].name };
              this.aiImageUrls = [...this.aiImageUrls];
            }
          }
          this.modalImage.set(newUrl);
          this.modalAiProcessing.set(false);
          this.modalAiPrompt = '';
          this.saveFormDraft();
          this.cdr.detectChanges();
          this.toast.success('Image updated with AI');
        };
        preload.onerror = () => {
          this.modalAiProcessing.set(false);
          this.toast.error('Generated image failed to load');
        };
        preload.src = newUrl;
      },
      error: (err) => {
        this.modalAiProcessing.set(false);
        this.toast.error(err?.error?.error?.message || 'AI image generation failed');
      },
    });
  }

  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    const maxSize = 10 * 1024 * 1024;
    const valid = files.filter((f) => f.size <= maxSize).slice(0, 20 - this.additionalFiles.length);
    if (valid.length < files.length) {
      this.toast.info(`${files.length - valid.length} files skipped (too large or limit reached)`);
    }
    this.additionalFiles.push(...valid);
    for (const file of valid) {
      this.imagePreviews.push({ name: file.name, url: URL.createObjectURL(file) });
    }
  }

  removeImage(name: string): void {
    const idx = this.imagePreviews.findIndex((p) => p.name === name);
    if (idx >= 0) {
      URL.revokeObjectURL(this.imagePreviews[idx].url);
      this.imagePreviews.splice(idx, 1);
    }
    this.additionalFiles = this.additionalFiles.filter((f) => f.name !== name);
  }

  private hasFilesToUpload(): boolean {
    return !!(this.logoFile || this.faviconFile || this.additionalFiles.length > 0);
  }

  private buildUploadFormData(): FormData {
    const fd = new FormData();
    if (this.logoFile) fd.append('logo', this.logoFile);
    if (this.faviconFile) fd.append('favicon', this.faviconFile);
    for (const file of this.additionalFiles) fd.append('images', file);
    return fd;
  }

  submitBuild(): void {
    if (!this.businessName.trim()) {
      this.toast.error('Business name is required');
      return;
    }
    if (!this.businessAddress.trim()) {
      this.toast.error('Business address is required');
      return;
    }

    // If not logged in, store business info and redirect to signin
    if (!this.auth.isLoggedIn()) {
      this.auth.setMode('custom');
      this.auth.setSelectedBusiness({
        name: this.businessName.trim(),
        address: this.businessAddress.trim(),
        phone: this.businessPhone.trim() || undefined,
        website: this.businessWebsite.trim() || undefined,
      });
      this.auth.setPendingBuild(true);
      this.router.navigate(['/signin']);
      return;
    }

    this.submitting.set(true);

    // Reset mode: rebuild an existing site
    if (this.resetSiteId) {
      this.api.resetSite(this.resetSiteId, {
        business: { name: this.businessName.trim(), address: this.businessAddress.trim() },
        additional_context: this.additionalContext || undefined,
      }).subscribe({
        next: () => {
          this.submitting.set(false);
          this.toast.success('Reset triggered — rebuilding site...');
          this.router.navigate(['/admin']);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(err?.error?.error?.message || err?.error?.message || 'Reset failed');
        },
      });
      return;
    }

    // Upload files first if present, then create site
    if (this.hasFilesToUpload()) {
      this.toast.info('Uploading assets...');
      this.api.uploadAssets(this.buildUploadFormData()).subscribe({
        next: (uploadRes) => {
          this.createSiteWithUploadId(uploadRes.data.upload_id);
        },
        error: () => {
          this.submitting.set(false);
          this.toast.error('Failed to upload assets — try again or skip the uploads');
        },
      });
    } else {
      this.createSiteWithUploadId(undefined);
    }
  }

  private createSiteWithUploadId(uploadId?: string): void {
    const biz = this.selectedBusiness();

    const payload: any = {
      mode: biz ? 'business' : 'custom',
      additional_context: this.additionalContext || undefined,
      business: {
        name: this.businessName.trim(),
        address: this.businessAddress.trim(),
        place_id: biz?.place_id,
        phone: this.businessPhone.trim() || undefined,
        website: this.businessWebsite.trim() || undefined,
        types: biz?.types,
        category: this.businessCategory || undefined,
      },
    };
    if (uploadId) payload.upload_id = uploadId;

    this.api
      .createSiteFromSearch(payload)
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.auth.clearSelectedBusiness();
          this.auth.setPendingBuild(false);
          this.clearFormDraft();
          this.toast.success('Site build started!');
          // API returns site_id (not id) — handle both formats
          const data = res.data as any;
          const siteId = data.site_id || data.id;
          const slug = res.data.slug;
          this.router.navigate(['/waiting'], {
            queryParams: { id: siteId, slug },
          });
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(err?.error?.error?.message || err?.error?.message || 'Failed to create site');
        },
      });
  }
}
