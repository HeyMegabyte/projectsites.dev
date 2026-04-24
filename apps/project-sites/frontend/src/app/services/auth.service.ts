import { Injectable, signal, computed } from '@angular/core';

const SESSION_KEY = 'ps_session';
const BUSINESS_KEY = 'ps_selected_business';
const MODE_KEY = 'ps_mode';
const PENDING_BUILD_KEY = 'ps_pending_build';
const LOCATION_DECLINED_KEY = 'ps_location_declined';
const AUTO_CREATE_KEY = 'ps_auto_create';

/** Session TTL in milliseconds (7 days). */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Session {
  token: string;
  identifier: string;
  /** Timestamp when the session was created (for expiry). */
  createdAt?: number;
}

export interface SelectedBusiness {
  name: string;
  address: string;
  place_id?: string;
  phone?: string;
  website?: string;
  types?: string[];
  lat?: number;
  lng?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private sessionSignal = signal<Session | null>(this.loadSession());
  readonly session = this.sessionSignal.asReadonly();
  readonly isLoggedIn = computed(() => this.sessionSignal() !== null);
  readonly email = computed(() => this.sessionSignal()?.identifier ?? '');

  private loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session: Session = JSON.parse(raw);
      // Expire sessions older than TTL
      if (session.createdAt && Date.now() - session.createdAt > SESSION_TTL_MS) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  getToken(): string | null {
    return this.sessionSignal()?.token ?? null;
  }

  setSession(token: string, identifier: string): void {
    const session: Session = { token, identifier, createdAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.sessionSignal.set(session);
  }

  clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(BUSINESS_KEY);
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(PENDING_BUILD_KEY);
    localStorage.removeItem(AUTO_CREATE_KEY);
    this.sessionSignal.set(null);
  }

  /** Full logout: clear all session data. */
  logout(): void {
    this.clearSession();
  }

  getSelectedBusiness(): SelectedBusiness | null {
    try {
      const raw = localStorage.getItem(BUSINESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  setSelectedBusiness(business: SelectedBusiness): void {
    localStorage.setItem(BUSINESS_KEY, JSON.stringify(business));
  }

  clearSelectedBusiness(): void {
    localStorage.removeItem(BUSINESS_KEY);
  }

  getMode(): 'business' | 'custom' {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'custom' ? 'custom' : 'business';
  }

  setMode(mode: 'business' | 'custom'): void {
    localStorage.setItem(MODE_KEY, mode);
  }

  getPendingBuild(): boolean {
    return localStorage.getItem(PENDING_BUILD_KEY) === 'true';
  }

  setPendingBuild(pending: boolean): void {
    if (pending) {
      localStorage.setItem(PENDING_BUILD_KEY, 'true');
    } else {
      localStorage.removeItem(PENDING_BUILD_KEY);
    }
  }

  isLocationDeclined(): boolean {
    return localStorage.getItem(LOCATION_DECLINED_KEY) === 'true';
  }

  setLocationDeclined(): void {
    localStorage.setItem(LOCATION_DECLINED_KEY, 'true');
  }

  getAutoCreate(): boolean {
    return localStorage.getItem(AUTO_CREATE_KEY) === 'true';
  }

  setAutoCreate(value: boolean): void {
    if (value) {
      localStorage.setItem(AUTO_CREATE_KEY, 'true');
    } else {
      localStorage.removeItem(AUTO_CREATE_KEY);
    }
  }
}
