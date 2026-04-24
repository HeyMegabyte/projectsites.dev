import { Component, signal, type OnInit, type OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-offline',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="error-page">
      <div class="orbs" aria-hidden="true">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>

      <div class="content">
        <div class="icon-container" aria-hidden="true">
          <svg class="offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
            <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0122.56 9" />
            <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
            <path d="M8.53 16.11a6 6 0 016.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <h1 class="heading">You're offline</h1>
        <p class="message">
          Your device lost its internet connection.
          Some cached content may still be available below.
        </p>

        <div class="status-indicator" role="status" [attr.aria-label]="isOnline() ? 'Connection restored' : 'No internet connection'">
          <span class="status-dot" [class.online]="isOnline()"></span>
          <span class="status-text">{{ isOnline() ? 'Connection restored' : 'No connection' }}</span>
        </div>

        <div class="actions">
          <button class="retry-btn" (click)="onRetry()" [disabled]="retrying()">
            <svg class="retry-icon" [class.spinning]="retrying()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            {{ retrying() ? 'Checking...' : 'Try Again' }}
          </button>
          <a routerLink="/" class="home-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </a>
        </div>

        <div class="cached-notice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <span>Previously visited pages may load from cache</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .error-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 2rem;
      overflow: hidden;
    }

    /* Orbs */
    .orbs { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .orb { position: absolute; border-radius: 50%; filter: blur(120px); opacity: 0.18; }
    .orb-1 {
      width: 500px; height: 500px;
      background: radial-gradient(circle, #6d28d9, transparent 70%);
      top: -120px; right: -120px;
      animation: orbFloat1 20s ease-in-out infinite;
    }
    .orb-2 {
      width: 400px; height: 400px;
      background: radial-gradient(circle, #7c3aed, transparent 70%);
      bottom: -80px; left: -100px;
      animation: orbFloat2 18s ease-in-out infinite;
    }
    .orb-3 {
      width: 300px; height: 300px;
      background: radial-gradient(circle, #a78bfa, transparent 70%);
      top: 40%; left: 50%;
      animation: orbFloat1 22s ease-in-out infinite reverse;
      opacity: 0.12;
    }

    /* Content */
    .content {
      position: relative;
      z-index: 1;
      text-align: center;
      max-width: 500px;
      width: 100%;
      animation: fadeInUp 0.6s ease-out;
    }

    /* Offline icon */
    .icon-container {
      margin-bottom: 1.5rem;
    }
    .offline-icon {
      width: clamp(5rem, 15vw, 8rem);
      height: clamp(5rem, 15vw, 8rem);
      color: #a78bfa;
      animation: iconPulse 3s ease-in-out infinite;
    }

    .heading {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(1.5rem, 4vw, 2rem);
      font-weight: 600;
      color: #f0f0f8;
      margin: 0 0 0.75rem;
    }

    .message {
      font-family: 'Sora', sans-serif;
      font-size: 1rem;
      color: #94a3b8;
      line-height: 1.6;
      margin: 0 0 1.5rem;
    }

    /* Status indicator */
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(100, 255, 218, 0.08);
      border-radius: 99px;
      padding: 0.5rem 1rem;
      margin-bottom: 2rem;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      animation: statusBlink 2s ease-in-out infinite;
    }
    .status-dot.online {
      background: #22c55e;
      animation: none;
    }
    .status-text {
      font-family: 'Sora', sans-serif;
      font-size: 0.8rem;
      color: #94a3b8;
    }

    /* Actions */
    .actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .retry-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: linear-gradient(135deg, #00E5FF 0%, #50AAE3 100%);
      color: #060610;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 10px;
      font-family: 'Sora', sans-serif;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .retry-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-2px); }
    .retry-btn:disabled { opacity: 0.7; cursor: default; }
    .retry-btn svg { width: 18px; height: 18px; }
    .retry-icon.spinning { animation: spin 1s linear infinite; }

    .home-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: 1px solid rgba(0, 229, 255, 0.3);
      color: #00E5FF;
      padding: 0.75rem 1.5rem;
      border-radius: 10px;
      font-family: 'Sora', sans-serif;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .home-btn:hover {
      background: rgba(0, 229, 255, 0.08);
      border-color: rgba(0, 229, 255, 0.5);
      transform: translateY(-2px);
    }
    .home-btn svg { width: 18px; height: 18px; }

    /* Cached notice */
    .cached-notice {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: #64748b;
      font-family: 'Sora', sans-serif;
      font-size: 0.8rem;
    }
    .cached-notice svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    /* Animations */
    @keyframes orbFloat1 {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(30px, -40px); }
    }
    @keyframes orbFloat2 {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(-20px, 30px); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes iconPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.7; }
    }
    @keyframes statusBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .orb, .offline-icon, .status-dot, .retry-icon.spinning, .content {
        animation: none !important;
      }
    }

    @media (max-width: 480px) {
      .actions { flex-direction: column; }
    }
  `],
})
export class OfflineComponent implements OnInit, OnDestroy {
  isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : false);
  retrying = signal(false);

  private onlineHandler = (): void => this.isOnline.set(true);
  private offlineHandler = (): void => this.isOnline.set(false);

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.offlineHandler);
    }
  }

  onRetry(): void {
    this.retrying.set(true);
    setTimeout(() => {
      if (navigator.onLine) {
        window.location.reload();
      } else {
        this.retrying.set(false);
      }
    }, 1500);
  }
}
