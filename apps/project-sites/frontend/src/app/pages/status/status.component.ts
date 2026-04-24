import { Component, type OnInit, type OnDestroy, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'checking';

interface ServiceEntry {
  readonly name: string;
  readonly description: string;
  status: ServiceStatus;
}

/**
 * System status page showing health of all platform services.
 *
 * @remarks
 * Fetches from /health endpoint on the API to determine API status.
 * Displays colored status indicators for each service component.
 * Auto-refreshes every 30 seconds while the page is active.
 *
 * @example
 * ```html
 * <app-status />
 * ```
 */
@Component({
  selector: 'app-status',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="status-page">
      <div class="status-inner">
        <div class="status-header">
          <h1>System Status</h1>
          <p class="status-subtitle">Real-time platform health</p>
        </div>

        <!-- Overall banner -->
        <div class="status-banner" [attr.data-state]="overallStatus()">
          <div class="banner-dot" [attr.data-state]="overallStatus()"></div>
          <span class="banner-text">{{ overallMessage() }}</span>
        </div>

        <!-- Services -->
        <div class="services-list">
          @for (svc of services(); track svc.name) {
            <div class="service-row">
              <div class="service-info">
                <span class="service-name">{{ svc.name }}</span>
                <span class="service-desc">{{ svc.description }}</span>
              </div>
              <div class="service-status">
                <span class="status-dot" [attr.data-state]="svc.status"></span>
                <span class="status-label" [attr.data-state]="svc.status">{{ statusLabel(svc.status) }}</span>
              </div>
            </div>
          }
        </div>

        <div class="status-footer-note">
          <span class="last-check">Last checked: {{ lastCheck() }}</span>
          <span class="auto-refresh">Auto-refreshes every 30 seconds</span>
        </div>
      </div>
    </section>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-bottom">
          <span>&copy; 2026 <a href="https://megabyte.space" target="_blank" rel="noopener noreferrer">Megabyte LLC</a></span>
          <span>
            <a routerLink="/privacy">Privacy</a> |
            <a routerLink="/terms">Terms</a> |
            <a routerLink="/blog">Blog</a> |
            <a routerLink="/changelog">Changelog</a> |
            <a routerLink="/status">Status</a>
          </span>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .status-page {
      min-height: calc(100vh - 60px - 120px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
    }
    .status-inner {
      max-width: 680px;
      margin: 0 auto;
    }

    .status-header {
      text-align: center;
      margin-bottom: 40px;
      animation: fadeInUp 0.5s ease;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 0 12px;
      background: linear-gradient(135deg, #fff 0%, rgba(0, 229, 255, 0.85) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .status-subtitle {
      font-size: 1.05rem;
      color: #94a3b8;
      margin: 0;
    }

    /* ── Overall banner ─────── */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 24px;
      border-radius: 14px;
      margin-bottom: 32px;
      animation: fadeInUp 0.5s ease 0.1s both;
      font-weight: 600;
      font-size: 0.95rem;
    }
    .status-banner[data-state="operational"] {
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: #4ade80;
    }
    .status-banner[data-state="degraded"] {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      color: #fbbf24;
    }
    .status-banner[data-state="down"] {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #f87171;
    }
    .status-banner[data-state="checking"] {
      background: rgba(148, 163, 184, 0.08);
      border: 1px solid rgba(148, 163, 184, 0.15);
      color: #94a3b8;
    }

    .banner-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .banner-dot[data-state="operational"] { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.5); }
    .banner-dot[data-state="degraded"] { background: #f59e0b; box-shadow: 0 0 8px rgba(245, 158, 11, 0.5); animation: pulse 2s ease infinite; }
    .banner-dot[data-state="down"] { background: #ef4444; box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); animation: pulse 1.5s ease infinite; }
    .banner-dot[data-state="checking"] { background: #94a3b8; animation: pulse 1.5s ease infinite; }

    /* ── Services list ─────── */
    .services-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.5), rgba(8, 8, 32, 0.7));
      border: 1px solid rgba(0, 229, 255, 0.06);
      border-radius: 16px;
      overflow: hidden;
      animation: fadeInUp 0.5s ease 0.2s both;
    }

    .service-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px;
      transition: background 0.2s;
    }
    .service-row:hover {
      background: rgba(0, 229, 255, 0.02);
    }
    .service-row + .service-row {
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .service-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .service-name {
      font-size: 0.92rem;
      font-weight: 600;
      color: #f0f0f8;
    }
    .service-desc {
      font-size: 0.78rem;
      color: #64748b;
    }

    .service-status {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-dot[data-state="operational"] { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
    .status-dot[data-state="degraded"] { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); animation: pulse 2s ease infinite; }
    .status-dot[data-state="down"] { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); animation: pulse 1.5s ease infinite; }
    .status-dot[data-state="checking"] { background: #94a3b8; animation: pulse 1.5s ease infinite; }

    .status-label {
      font-size: 0.78rem;
      font-weight: 600;
    }
    .status-label[data-state="operational"] { color: #4ade80; }
    .status-label[data-state="degraded"] { color: #fbbf24; }
    .status-label[data-state="down"] { color: #f87171; }
    .status-label[data-state="checking"] { color: #94a3b8; }

    /* ── Footer note ─────── */
    .status-footer-note {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 20px;
      padding: 0 4px;
      font-size: 0.75rem;
      color: #475569;
      animation: fadeInUp 0.5s ease 0.3s both;
    }

    /* ── Footer ─────── */
    .site-footer {
      padding: 36px 24px 28px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .footer-inner { max-width: 680px; margin: 0 auto; }
    .footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.8rem;
      color: #64748b;
    }
    .footer-bottom a {
      color: #64748b;
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-bottom a:hover { color: #00E5FF; }
    @media (max-width: 640px) {
      .footer-bottom { flex-direction: column; text-align: center; }
      .status-footer-note { flex-direction: column; text-align: center; }
    }
  `],
})
export class StatusComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  services = signal<ServiceEntry[]>([
    { name: 'API', description: 'Core platform API (Hono on Cloudflare Workers)', status: 'checking' },
    { name: 'Database (D1)', description: 'Cloudflare D1 SQLite — system of record', status: 'checking' },
    { name: 'Cache (KV)', description: 'Cloudflare KV — host resolution and prompt cache', status: 'checking' },
    { name: 'Storage (R2)', description: 'Cloudflare R2 — static site files and assets', status: 'checking' },
    { name: 'AI Pipeline', description: 'AI site generation workflow and LLM inference', status: 'checking' },
  ]);

  lastCheck = signal('--');
  overallStatus = signal<ServiceStatus>('checking');
  overallMessage = signal('Checking system status...');

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.checkHealth();
    if (isPlatformBrowser(this.platformId)) {
      this.refreshInterval = setInterval(() => this.checkHealth(), 30_000);
    }
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  statusLabel(s: ServiceStatus): string {
    switch (s) {
      case 'operational': return 'Operational';
      case 'degraded': return 'Degraded';
      case 'down': return 'Down';
      case 'checking': return 'Checking...';
    }
  }

  private checkHealth(): void {
    this.http.get<{ status: string; kv_latency_ms?: number; r2_latency_ms?: number }>('/health')
      .subscribe({
        next: (resp) => {
          const apiOk = resp.status === 'ok';
          const kvOk = resp.kv_latency_ms != null && resp.kv_latency_ms < 5000;
          const r2Ok = resp.r2_latency_ms != null && resp.r2_latency_ms < 5000;

          const updated: ServiceEntry[] = [
            { name: 'API', description: 'Core platform API (Hono on Cloudflare Workers)', status: apiOk ? 'operational' : 'degraded' },
            { name: 'Database (D1)', description: 'Cloudflare D1 SQLite — system of record', status: apiOk ? 'operational' : 'degraded' },
            { name: 'Cache (KV)', description: 'Cloudflare KV — host resolution and prompt cache', status: kvOk ? 'operational' : (resp.kv_latency_ms != null ? 'degraded' : 'down') },
            { name: 'Storage (R2)', description: 'Cloudflare R2 — static site files and assets', status: r2Ok ? 'operational' : (resp.r2_latency_ms != null ? 'degraded' : 'down') },
            { name: 'AI Pipeline', description: 'AI site generation workflow and LLM inference', status: apiOk ? 'operational' : 'degraded' },
          ];

          this.services.set(updated);
          this.updateOverall(updated);
          this.lastCheck.set(new Date().toLocaleTimeString());
        },
        error: () => {
          const down: ServiceEntry[] = [
            { name: 'API', description: 'Core platform API (Hono on Cloudflare Workers)', status: 'down' },
            { name: 'Database (D1)', description: 'Cloudflare D1 SQLite — system of record', status: 'down' },
            { name: 'Cache (KV)', description: 'Cloudflare KV — host resolution and prompt cache', status: 'down' },
            { name: 'Storage (R2)', description: 'Cloudflare R2 — static site files and assets', status: 'down' },
            { name: 'AI Pipeline', description: 'AI site generation workflow and LLM inference', status: 'down' },
          ];
          this.services.set(down);
          this.updateOverall(down);
          this.lastCheck.set(new Date().toLocaleTimeString());
        },
      });
  }

  private updateOverall(svcs: ServiceEntry[]): void {
    const anyDown = svcs.some((s) => s.status === 'down');
    const anyDegraded = svcs.some((s) => s.status === 'degraded');

    if (anyDown) {
      this.overallStatus.set('down');
      this.overallMessage.set('Some systems are experiencing outages');
    } else if (anyDegraded) {
      this.overallStatus.set('degraded');
      this.overallMessage.set('Some systems are experiencing issues');
    } else {
      this.overallStatus.set('operational');
      this.overallMessage.set('All systems operational');
    }
  }
}
