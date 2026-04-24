import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Reusable empty state component for zero-data screens.
 *
 * @remarks Displays a centered card with an icon, headline, description,
 * and an optional call-to-action button. Uses the app's dark theme with
 * cyan accent borders and a fadeInUp entrance animation.
 *
 * @example
 * ```html
 * <app-empty-state
 *   icon="M12 6v6m0 0v6m0-6h6m-6 0H6"
 *   headline="No sites yet"
 *   description="Create your first site to get started."
 *   ctaText="Create Site"
 *   ctaRoute="/create"
 * />
 * ```
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="empty-state" role="status">
      <div class="empty-card">
        <div class="empty-icon-wrapper">
          <svg
            class="empty-icon"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path [attr.d]="icon()" />
          </svg>
        </div>

        <h3 class="empty-headline">{{ headline() }}</h3>
        <p class="empty-description">{{ description() }}</p>

        @if (ctaText()) {
          @if (ctaRoute()) {
            <a class="empty-cta" [routerLink]="ctaRoute()">
              {{ ctaText() }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          } @else {
            <button class="empty-cta" (click)="ctaClick.emit()">
              {{ ctaText() }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      animation: fadeInUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .empty-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 420px;
      padding: 48px 32px;
      border-radius: 20px;
      background: rgba(10, 10, 26, 0.6);
      border: 1px solid rgba(0, 229, 255, 0.1);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      transition: border-color 0.3s, box-shadow 0.3s;
    }

    .empty-card:hover {
      border-color: rgba(0, 229, 255, 0.2);
      box-shadow: 0 0 40px rgba(0, 229, 255, 0.04);
    }

    .empty-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      border-radius: 20px;
      background: rgba(0, 229, 255, 0.06);
      margin-bottom: 24px;
    }

    .empty-icon {
      color: var(--accent);
      opacity: 0.7;
    }

    .empty-headline {
      margin: 0 0 8px;
      font-family: 'Space Grotesk', var(--font);
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .empty-description {
      margin: 0 0 28px;
      font-size: 0.9rem;
      color: var(--text-muted);
      line-height: 1.6;
      max-width: 320px;
    }

    .empty-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      border-radius: 12px;
      border: 1px solid rgba(0, 229, 255, 0.25);
      background: rgba(0, 229, 255, 0.08);
      color: var(--accent);
      font-family: var(--font);
      font-size: 0.88rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .empty-cta::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.12), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }

    .empty-cta:hover {
      background: rgba(0, 229, 255, 0.14);
      border-color: rgba(0, 229, 255, 0.5);
      box-shadow: 0 0 24px rgba(0, 229, 255, 0.15), inset 0 0 24px rgba(0, 229, 255, 0.05);
      transform: translateY(-2px);
    }

    .empty-cta:hover::before {
      opacity: 1;
    }

    .empty-cta:active {
      transform: translateY(0);
    }

    .empty-cta svg {
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .empty-cta:hover svg {
      transform: translateX(3px);
    }

    @media (max-width: 480px) {
      .empty-card {
        padding: 36px 24px;
      }

      .empty-icon-wrapper {
        width: 64px;
        height: 64px;
        border-radius: 16px;
        margin-bottom: 20px;
      }

      .empty-icon {
        width: 36px;
        height: 36px;
      }

      .empty-headline {
        font-size: 1.1rem;
      }

      .empty-description {
        font-size: 0.85rem;
      }
    }
  `],
})
export class EmptyStateComponent {
  /** SVG path data for the icon (d attribute). */
  readonly icon = input.required<string>();

  /** Primary heading text. */
  readonly headline = input.required<string>();

  /** Supporting description text. */
  readonly description = input.required<string>();

  /** Optional CTA button label. */
  readonly ctaText = input<string>('');

  /** Optional route for the CTA (renders as a router link). */
  readonly ctaRoute = input<string>('');

  /** Emitted when the CTA button is clicked (only when ctaRoute is empty). */
  readonly ctaClick = output<void>();
}
