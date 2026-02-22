import { Injectable, signal, computed } from '@angular/core';

const SESSION_KEY = 'ps_session';
const BUSINESS_KEY = 'ps_selected_business';
const MODE_KEY = 'ps_mode';
const PENDING_BUILD_KEY = 'ps_pending_build';
const LOCATION_DECLINED_KEY = 'ps_location_declined';

export interface Session {
  token: string;
  identifier: string;
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
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  getToken(): string | null {
    return this.sessionSignal()?.token ?? null;
  }

  setSession(token: string, identifier: string): void {
    const session: Session = { token, identifier };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.sessionSignal.set(session);
  }

  clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
    this.sessionSignal.set(null);
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
    return (localStorage.getItem(MODE_KEY) as 'business' | 'custom') || 'business';
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
}
