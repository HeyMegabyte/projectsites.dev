import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly type: 'feat' | 'fix' | 'perf';
  readonly description: string;
}

const ENTRIES: readonly ChangelogEntry[] = [
  {
    version: 'v1.4.0',
    date: 'Apr 19, 2025',
    type: 'feat',
    description: 'Comprehensive multimedia pipeline with 7 parallel sources, DALL-E image generation, and WebP optimization.',
  },
  {
    version: 'v1.3.0',
    date: 'Apr 14, 2025',
    type: 'feat',
    description: 'Complete admin dashboard with all 11 sections polished: editor, analytics, email, social, forms, integrations, billing, audit, and settings.',
  },
  {
    version: 'v1.2.0',
    date: 'Apr 10, 2025',
    type: 'feat',
    description: '41 Playwright E2E tests across 3 user journeys. Full test coverage for golden path, admin flows, and site serving.',
  },
  {
    version: 'v1.1.0',
    date: 'Apr 9, 2025',
    type: 'feat',
    description: 'Google Sheets, PostHog analytics, and Sentry error tracking integration. Server-side event capture and structured logging.',
  },
  {
    version: 'v1.0.0',
    date: 'Mar 25, 2025',
    type: 'feat',
    description: 'Initial production launch with AI site generation, magic link auth, Stripe billing, custom domains, and Cloudflare Workers deployment.',
  },
];

/**
 * Changelog page displaying a vertical timeline of version history.
 *
 * @remarks
 * Shows each release with version number, date, type badge (feat/fix/perf),
 * and description. Uses a dark theme with a cyan accent timeline line.
 *
 * @example
 * ```html
 * <app-changelog />
 * ```
 */
@Component({
  selector: 'app-changelog',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="changelog-page">
      <div class="changelog-inner">
        <div class="changelog-header">
          <h1>Changelog</h1>
          <p class="changelog-subtitle">What we shipped, fixed, and improved</p>
        </div>

        <div class="timeline">
          @for (entry of entries; track entry.version) {
            <div class="timeline-entry">
              <div class="timeline-marker"></div>
              <div class="timeline-card">
                <div class="entry-top">
                  <span class="entry-version">{{ entry.version }}</span>
                  <span class="entry-badge" [attr.data-type]="entry.type">{{ entry.type }}</span>
                  <span class="entry-date">{{ entry.date }}</span>
                </div>
                <p class="entry-desc">{{ entry.description }}</p>
              </div>
            </div>
          }
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

    .changelog-page {
      min-height: calc(100vh - 60px - 120px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
    }
    .changelog-inner {
      max-width: 720px;
      margin: 0 auto;
    }

    .changelog-header {
      text-align: center;
      margin-bottom: 56px;
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
    .changelog-subtitle {
      font-size: 1.05rem;
      color: #94a3b8;
      margin: 0;
    }

    /* ── Timeline ─────── */
    .timeline {
      position: relative;
      padding-left: 32px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: linear-gradient(180deg, rgba(0, 229, 255, 0.4), rgba(0, 229, 255, 0.05));
      border-radius: 2px;
    }

    .timeline-entry {
      position: relative;
      margin-bottom: 28px;
      animation: fadeInUp 0.5s ease both;
    }
    .timeline-entry:nth-child(1) { animation-delay: 0.1s; }
    .timeline-entry:nth-child(2) { animation-delay: 0.18s; }
    .timeline-entry:nth-child(3) { animation-delay: 0.26s; }
    .timeline-entry:nth-child(4) { animation-delay: 0.34s; }
    .timeline-entry:nth-child(5) { animation-delay: 0.42s; }

    .timeline-marker {
      position: absolute;
      left: -28px;
      top: 20px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #00E5FF;
      border: 2px solid #060610;
      box-shadow: 0 0 10px rgba(0, 229, 255, 0.4);
    }

    .timeline-card {
      padding: 24px;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.6), rgba(8, 8, 32, 0.8));
      border: 1px solid rgba(0, 229, 255, 0.06);
      border-radius: 14px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .timeline-card:hover {
      border-color: rgba(0, 229, 255, 0.15);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 229, 255, 0.03);
    }

    .entry-top {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }

    .entry-version {
      font-size: 0.95rem;
      font-weight: 700;
      color: #f0f0f8;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .entry-badge {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 3px 10px;
      border-radius: 20px;
    }
    .entry-badge[data-type="feat"] {
      color: #00E5FF;
      background: rgba(0, 229, 255, 0.1);
      border: 1px solid rgba(0, 229, 255, 0.2);
    }
    .entry-badge[data-type="fix"] {
      color: #f59e0b;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .entry-badge[data-type="perf"] {
      color: #a78bfa;
      background: rgba(167, 139, 250, 0.1);
      border: 1px solid rgba(167, 139, 250, 0.2);
    }

    .entry-date {
      font-size: 0.78rem;
      color: #64748b;
      margin-left: auto;
    }

    .entry-desc {
      font-size: 0.9rem;
      color: #cbd5e1;
      line-height: 1.7;
      margin: 0;
    }

    /* ── Footer ─────── */
    .site-footer {
      padding: 36px 24px 28px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .footer-inner { max-width: 720px; margin: 0 auto; }
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
    }
  `],
})
export class ChangelogComponent {
  readonly entries = ENTRIES;
}
