import { Injectable, signal, computed, type Signal } from '@angular/core';

/** Max time (ms) a loading key can remain active before auto-cleanup. */
const STALE_TIMEOUT_MS = 60_000;

/**
 * Global loading state management service.
 *
 * @remarks
 * Tracks loading state globally and per-key. Components can use the global
 * `loading` signal for full-page spinners, or per-key signals for granular
 * skeleton screens. Stale keys are auto-cleaned after 60s.
 *
 * @example
 * ```typescript
 * const loading = inject(LoadingService);
 * loading.startLoading('sites-list');
 * // ... after data arrives
 * loading.stopLoading('sites-list');
 *
 * // In template: @if (loading.isLoading('sites-list')()) { <skeleton /> }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  /** Global loading state — true if ANY key is currently loading. */
  readonly loading = computed(() => {
    const map = this.loadingMap();
    for (const value of map.values()) {
      if (value) return true;
    }
    return false;
  });

  /** Internal map tracking per-key loading states. */
  readonly loadingMap = signal<Map<string, boolean>>(new Map());

  /** Cache of derived signals per key to avoid re-creation. */
  private readonly keySignals = new Map<string, Signal<boolean>>();

  /** Timers for auto-cleanup of stale loading keys. */
  private readonly staleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Mark a specific operation as loading. */
  startLoading(key: string): void {
    this.loadingMap.update((map) => {
      const next = new Map(map);
      next.set(key, true);
      return next;
    });
    // Auto-cleanup stale keys after timeout
    this.clearStaleTimer(key);
    this.staleTimers.set(key, setTimeout(() => this.stopLoading(key), STALE_TIMEOUT_MS));
  }

  /** Mark a specific operation as done loading. */
  stopLoading(key: string): void {
    this.clearStaleTimer(key);
    this.loadingMap.update((map) => {
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }

  /**
   * Get a derived signal for a specific loading key.
   * Returns a stable signal reference (same key always returns the same signal).
   */
  isLoading(key: string): Signal<boolean> {
    let existing = this.keySignals.get(key);
    if (!existing) {
      existing = computed(() => this.loadingMap().get(key) ?? false);
      this.keySignals.set(key, existing);
    }
    return existing;
  }

  private clearStaleTimer(key: string): void {
    const timer = this.staleTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.staleTimers.delete(key);
    }
  }
}
