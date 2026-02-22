import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  readonly lat = signal<number | null>(null);
  readonly lng = signal<number | null>(null);
  readonly hasLocation = signal(false);

  requestLocation(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.lat.set(pos.coords.latitude);
          this.lng.set(pos.coords.longitude);
          this.hasLocation.set(true);
          resolve(true);
        },
        () => resolve(false),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  /** Haversine distance in miles */
  distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8; // Earth radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  formatDistance(miles: number): string {
    if (miles < 0.1) return '< 0.1 mi';
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
