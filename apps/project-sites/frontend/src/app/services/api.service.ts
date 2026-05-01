import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, type HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  private headers(): HttpHeaders {
    let headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    const token = this.auth.getToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  /**
   * Handles HTTP errors with user-friendly toast messages.
   * Applies a 30s timeout to prevent indefinite hangs.
   * Re-throws the error so callers can implement additional handling.
   */
  private handleError<T>(): (source: Observable<T>) => Observable<T> {
    return (source: Observable<T>) =>
      source.pipe(
        timeout(ApiService.REQUEST_TIMEOUT_MS),
        catchError((error: HttpErrorResponse | TimeoutError) => {
          if (error instanceof TimeoutError) {
            this.toast.error('Request timed out. Please try again.');
            return throwError(() => error);
          }
          const message = this.getErrorMessage(error);
          this.toast.error(message);

          if (error.status === 401) {
            this.auth.clearSession();
            this.router.navigate(['/signin']);
          }

          return throwError(() => error);
        }),
      );
  }

  private getErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 0 || error.statusText === 'Unknown Error') {
      return "Can't reach the server. Check your connection.";
    }
    switch (error.status) {
      case 401:
        return 'Your session expired. Please sign in again.';
      case 403:
        return "You don't have permission to do that.";
      case 404:
        return "That resource wasn't found.";
      case 429:
        return 'Too many requests. Please wait a moment.';
      default:
        return error.status >= 500
          ? "Something went wrong. We're looking into it."
          : 'An unexpected error occurred. Please try again.';
    }
  }

  get<T>(path: string, params?: Record<string, string>): Observable<T> {
    return this.http.get<T>(`/api${path}`, { headers: this.headers(), params }).pipe(this.handleError());
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(`/api${path}`, body, { headers: this.headers() }).pipe(this.handleError());
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(`/api${path}`, body, { headers: this.headers() }).pipe(this.handleError());
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(`/api${path}`, body, { headers: this.headers() }).pipe(this.handleError());
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`/api${path}`, { headers: this.headers() }).pipe(this.handleError());
  }

  postFormData<T>(path: string, formData: FormData): Observable<T> {
    let headers = new HttpHeaders();
    const token = this.auth.getToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.post<T>(`/api${path}`, formData, { headers }).pipe(this.handleError());
  }

  /** Search businesses via Google Places proxy */
  searchBusinesses(query: string, lat?: number, lng?: number): Observable<{ data: BusinessResult[] }> {
    const params: Record<string, string> = { q: query };
    if (lat != null && lng != null) {
      params['lat'] = lat.toString();
      params['lng'] = lng.toString();
    }
    return this.get('/search/businesses', params);
  }

  /** Search pre-built sites */
  searchSites(query: string): Observable<{ data: PreBuiltSite[] }> {
    return this.get('/sites/search', { q: query });
  }

  /** Lookup site by place_id */
  lookupSite(placeId: string): Observable<{ data: SiteLookup | null }> {
    return this.get('/sites/lookup', { place_id: placeId });
  }

  /** Send magic link */
  sendMagicLink(email: string, redirectUrl: string): Observable<{ data: { token: string; identifier: string } }> {
    return this.post('/auth/magic-link', { email, redirect_url: redirectUrl });
  }

  /** Get current user */
  getMe(): Observable<{ data: UserInfo }> {
    return this.get('/auth/me');
  }

  /** Create site from search */
  createSiteFromSearch(body: CreateSitePayload): Observable<{ data: Site }> {
    return this.post('/sites/create-from-search', body);
  }

  /** List user sites */
  listSites(): Observable<{ data: Site[] }> {
    return this.get('/sites');
  }

  /** Get single site */
  getSite(id: string): Observable<{ data: Site }> {
    return this.get(`/sites/${id}`);
  }

  /** Update site */
  updateSite(id: string, body: Partial<Site>): Observable<{ data: Site }> {
    return this.patch(`/sites/${id}`, body);
  }

  /** Delete site */
  deleteSite(id: string): Observable<void> {
    return this.delete(`/sites/${id}`);
  }

  /** Reset & rebuild */
  resetSite(id: string, body: ResetSitePayload): Observable<{ data: Site }> {
    return this.post(`/sites/${id}/reset`, body);
  }

  /** Get site logs */
  getSiteLogs(id: string, limit = 200): Observable<{ data: LogEntry[] }> {
    return this.get(`/sites/${id}/logs`, { limit: limit.toString() });
  }

  /** List hostnames */
  getHostnames(siteId: string): Observable<{ data: Hostname[] }> {
    return this.get(`/sites/${siteId}/hostnames`);
  }

  /** Add hostname */
  addHostname(siteId: string, hostname: string): Observable<{ data: Hostname }> {
    return this.post(`/sites/${siteId}/hostnames`, { hostname });
  }

  /** Set primary hostname */
  setPrimaryHostname(siteId: string, hostnameId: string): Observable<void> {
    return this.put(`/sites/${siteId}/hostnames/${hostnameId}/primary`);
  }

  /** Delete hostname */
  deleteHostname(siteId: string, hostnameId: string): Observable<void> {
    return this.delete(`/sites/${siteId}/hostnames/${hostnameId}`);
  }

  /** Check slug availability */
  checkSlug(slug: string, excludeId?: string): Observable<{ data: { available: boolean } }> {
    const params: Record<string, string> = { slug };
    if (excludeId) params['exclude_id'] = excludeId;
    return this.get('/slug/check', params);
  }

  /** Billing checkout */
  createCheckout(orgId: string, siteId: string, returnUrl: string): Observable<{ data: { client_secret: string } }> {
    return this.post('/billing/embedded-checkout', { org_id: orgId, site_id: siteId, return_url: returnUrl });
  }

  /** Billing portal */
  getBillingPortal(returnUrl: string): Observable<{ data: { portal_url: string } }> {
    return this.post('/billing/portal', { return_url: returnUrl });
  }

  /** Get subscription */
  getSubscription(): Observable<{ data: SubscriptionInfo }> {
    return this.get('/billing/subscription');
  }

  /** Domain summary */
  getDomainSummary(): Observable<{ data: DomainSummary }> {
    return this.get('/admin/domains/summary');
  }

  /** Search address */
  searchAddress(query: string, lat?: number, lng?: number): Observable<{ data: AddressResult[] }> {
    const params: Record<string, string> = { q: query };
    if (lat != null) params['lat'] = lat.toString();
    if (lng != null) params['lng'] = lng.toString();
    return this.get('/search/address', params);
  }

  /** Validate business */
  validateBusiness(body: unknown): Observable<{ data: { valid: boolean; message?: string } }> {
    return this.post('/validate-business', body);
  }

  /** Contact form */
  submitContact(body: { name: string; email: string; phone?: string; message: string }): Observable<void> {
    return this.post('/contact', body);
  }

  /** Generate an expert prompt using OpenAI research pipeline */
  generatePrompt(body: { site_id?: string; business_name: string; business_address?: string; google_place_id?: string; additional_context?: string }): Observable<{ data: { prompt: string; research: Record<string, unknown> } }> {
    return this.post('/sites/generate-prompt', body);
  }

  /** Deploy ZIP to site */
  deploySite(siteId: string, formData: FormData): Observable<{ data: { message: string } }> {
    return this.postFormData(`/sites/${siteId}/deploy`, formData);
  }

  /** Get workflow status */
  getWorkflow(siteId: string): Observable<{ data: WorkflowStatus }> {
    return this.get(`/sites/${siteId}/workflow`);
  }

  /** Delete site with options */
  deleteSiteWithOptions(id: string, cancelSubscription: boolean): Observable<void> {
    return this.http.request<void>('DELETE', `/api/sites/${id}`, {
      headers: this.headers(),
      body: { cancel_subscription: cancelSubscription },
    }).pipe(this.handleError());
  }

  /** Get entitlements */
  getEntitlements(): Observable<{ data: Entitlements }> {
    return this.get('/billing/entitlements');
  }

  /** AI-powered business categorization */
  categorize(name: string, address?: string, types?: string[]): Observable<{ data: { category: string } }> {
    return this.post('/ai/categorize', { name, address, types });
  }

  /** AI image discovery — finds logo, favicon, and images via web search */
  discoverImages(name: string, address?: string, website?: string): Observable<{ data: DiscoveredImages }> {
    return this.post('/ai/discover-images', { name, address, website });
  }

  /** AI video discovery — finds relevant videos from YouTube, Pexels, Pixabay */
  discoverVideos(name: string, address?: string, businessType?: string): Observable<{ data: DiscoveredVideos }> {
    return this.post('/ai/discover-videos', { name, address, business_type: businessType });
  }

  /** AI image edit — generates new image from a text prompt */
  editImage(prompt: string, originalUrl?: string): Observable<{ data: { url: string; prompt: string } }> {
    return this.post('/ai/edit-image', { prompt, originalUrl });
  }

  /** Upload assets (logo, favicon, images) before site creation */
  uploadAssets(formData: FormData): Observable<{ data: { upload_id: string; assets: { key: string; name: string; size: number; type: string; url: string }[] } }> {
    return this.postFormData('/assets/upload', formData);
  }

  /** Get build assets for a site (generated during workflow) */
  getBuildAssets(siteId: string): Observable<{ data: { key: string; name: string; type: string; size: number; url: string }[] }> {
    return this.get(`/sites/${siteId}/build-assets`);
  }

  /** Revert a site to a previous snapshot version */
  revertSnapshot(siteId: string, snapshotId: string): Observable<{ data: { message: string; snapshot_name: string } }> {
    return this.post(`/sites/${siteId}/snapshots/revert`, { snapshot_id: snapshotId });
  }

  /** Publish files + chat from bolt.diy to a site */
  publishFromBolt(
    siteId: string,
    slug: string,
    files: { path: string; content: string }[],
    chat: { messages: unknown[]; description?: string; exportDate?: string },
  ): Observable<{ data: { slug: string; version: string; url: string } }> {
    return this.post(`/sites/${siteId}/publish-bolt`, { files, chat, slug });
  }

  /** Get chat export for a site by slug */
  getChatExport(slug: string): Observable<{ messages: unknown[]; description?: string; exportDate?: string }> {
    return this.http.get<{ messages: unknown[]; description?: string; exportDate?: string }>(
      `/api/sites/by-slug/${slug}/chat`,
    ).pipe(this.handleError());
  }

  /** Get GA4 analytics data for a site */
  getAnalytics(siteId: string, period = '7'): Observable<{ data: AnalyticsData }> {
    return this.get(`/analytics/${siteId}`, { period });
  }

  /** List form submissions for a site */
  listFormSubmissions(siteId: string, limit = 50): Observable<{ data: FormSubmission[] }> {
    return this.get(`/sites/${siteId}/forms`, { limit: limit.toString() });
  }

  /** List newsletter integrations for a site */
  listIntegrations(siteId: string): Observable<{ data: NewsletterIntegration[] }> {
    return this.get(`/sites/${siteId}/integrations`);
  }

  /** Connect a newsletter integration to a site */
  createIntegration(
    siteId: string,
    body: { provider: NewsletterProvider; api_key: string; list_id?: string; webhook_url?: string; config?: Record<string, unknown> },
  ): Observable<{ data: NewsletterIntegration }> {
    return this.post(`/sites/${siteId}/integrations`, body);
  }

  /** Update an integration (toggle active, rotate key) */
  updateIntegration(siteId: string, id: string, body: Partial<NewsletterIntegration>): Observable<{ data: NewsletterIntegration }> {
    return this.patch(`/sites/${siteId}/integrations/${id}`, body);
  }

  /** Delete an integration */
  deleteIntegration(siteId: string, id: string): Observable<void> {
    return this.delete(`/sites/${siteId}/integrations/${id}`);
  }
}

export type NewsletterProvider = 'mailchimp' | 'webhook' | 'resend' | 'sendgrid' | 'convertkit' | 'klaviyo';

export interface NewsletterIntegration {
  id: string;
  site_id: string;
  provider: NewsletterProvider;
  list_id?: string;
  webhook_url?: string;
  active: boolean;
  config?: Record<string, unknown>;
  api_key_preview?: string;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  site_id: string;
  form_name: string;
  email?: string;
  payload: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  origin_url?: string;
  forwarded_to?: string[];
  created_at: string;
}

export interface BusinessResult {
  name: string;
  address: string;
  place_id: string;
  lat?: number;
  lng?: number;
  types?: string[];
  phone?: string;
  website?: string;
}

export interface PreBuiltSite {
  id: string;
  slug: string;
  business_name: string;
  business_address: string;
  status: string;
  place_id?: string;
}

export interface SiteLookup {
  id: string;
  slug: string;
  status: string;
}

export interface UserInfo {
  id: string;
  email: string;
  org_id: string;
}

export interface Site {
  id: string;
  slug: string;
  business_name: string;
  business_address: string;
  status: string;
  plan?: string;
  current_build_version?: number;
  primary_hostname?: string;
  place_id?: string;
  business_phone?: string;
  business_website?: string;
  site_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSitePayload {
  mode: 'business' | 'custom';
  additional_context?: string;
  business: {
    name: string;
    address: string;
    place_id?: string;
    phone?: string;
    website?: string;
    types?: string[];
    category?: string;
  };
}

export interface ResetSitePayload {
  business: { name: string; address: string; place_id?: string };
  additional_context?: string;
}

export interface LogEntry {
  id: string;
  action: string;
  created_at: string;
  metadata_json?: string;
}

export interface Hostname {
  id: string;
  hostname: string;
  status: string;
  is_primary: boolean;
}

export interface SubscriptionInfo {
  plan: string;
  status: string;
}

export interface DomainSummary {
  total: number;
  active: number;
  pending: number;
  failed: number;
}

export interface AddressResult {
  description: string;
  place_id?: string;
}

export interface WorkflowStatus {
  status: string;
  current_step?: string;
  steps_completed?: number;
  total_steps?: number;
}

export interface Entitlements {
  topBarHidden: boolean;
  maxCustomDomains: number;
  chatEnabled: boolean;
  analyticsEnabled: boolean;
}

export interface ImageQualityResult {
  quality_score: number;
  is_professional: boolean;
  is_safe: boolean;
  description: string;
  recommendation: 'use_as_is' | 'use_as_inspiration' | 'enhance' | 'reject';
  issues: string[];
}

export interface DiscoveredImage {
  url: string;
  name: string;
  type: 'logo' | 'favicon' | 'image';
  source: string;
  quality?: ImageQualityResult | null;
  dimensions?: { width: number; height: number } | null;
}

export interface BrandAssessment {
  brand_maturity: 'established' | 'developing' | 'minimal';
  website_quality_score: number;
  asset_strategy: string;
  has_professional_logo: boolean;
  has_quality_favicon: boolean;
  recommendation: string;
}

export interface DiscoveredImages {
  logo?: DiscoveredImage;
  favicon?: DiscoveredImage;
  images: DiscoveredImage[];
  brand_assessment?: BrandAssessment | null;
}

export interface DiscoveredVideo {
  url: string;
  embed_url: string;
  thumbnail: string;
  title: string;
  source: 'youtube' | 'pexels' | 'pixabay';
  duration_seconds: number;
  attribution: { author: string; license: string; source_url: string };
  relevance: 'business_specific' | 'category_generic';
}

export interface DiscoveredVideos {
  videos: DiscoveredVideo[];
  attribution: { author: string; license: string; source_url: string }[];
}

export interface AnalyticsStats {
  pageViews: number;
  uniqueVisitors: number;
  avgSessionDuration: string;
  bounceRate: number;
}

export interface AnalyticsChartPoint {
  date: string;
  views: number;
}

export interface AnalyticsTrafficSource {
  name: string;
  percent: number;
}

export interface AnalyticsTopPage {
  path: string;
  views: number;
}

export interface AnalyticsData {
  period: number;
  slug?: string;
  ga4_connected: boolean;
  ga4_measurement_id?: string | null;
  gtm_container_id?: string | null;
  stats: AnalyticsStats;
  chartData: AnalyticsChartPoint[];
  trafficSources: AnalyticsTrafficSource[];
  topPages: AnalyticsTopPage[];
}
