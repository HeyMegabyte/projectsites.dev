import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private headers(): HttpHeaders {
    let headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    const token = this.auth.getToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  get<T>(path: string, params?: Record<string, string>): Observable<T> {
    return this.http.get<T>(`/api${path}`, { headers: this.headers(), params });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(`/api${path}`, body, { headers: this.headers() });
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(`/api${path}`, body, { headers: this.headers() });
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(`/api${path}`, body, { headers: this.headers() });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`/api${path}`, { headers: this.headers() });
  }

  postFormData<T>(path: string, formData: FormData): Observable<T> {
    let headers = new HttpHeaders();
    const token = this.auth.getToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.post<T>(`/api${path}`, formData, { headers });
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
