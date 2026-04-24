import { Component, input } from '@angular/core';

/**
 * Reusable skeleton loading placeholder with CSS shimmer animation.
 *
 * @remarks Renders appropriate placeholder shapes based on the variant
 * (text lines, cards, avatars, or table rows). Uses the shimmer keyframe
 * defined in global styles.scss with a dark theme gradient.
 *
 * @example
 * ```html
 * <app-skeleton variant="card" [count]="3" />
 * <app-skeleton variant="text" [count]="5" />
 * <app-skeleton variant="avatar" />
 * <app-skeleton variant="table" [count]="8" />
 * ```
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: `
    <div class="skeleton-container" [attr.aria-label]="'Loading content'" role="status" aria-busy="true">
      <span class="sr-only">Loading...</span>

      @switch (variant()) {
        @case ('text') {
          @for (i of items(); track i) {
            <div
              class="skeleton skeleton-text"
              [style.width]="getTextWidth(i)"
              [style.animation-delay]="(i * 0.08) + 's'"
            ></div>
          }
        }
        @case ('card') {
          <div class="skeleton-card-grid">
            @for (i of items(); track i) {
              <div class="skeleton-card" [style.animation-delay]="(i * 0.1) + 's'">
                <div class="skeleton skeleton-card-image"></div>
                <div class="skeleton-card-body">
                  <div class="skeleton skeleton-card-title"></div>
                  <div class="skeleton skeleton-card-line"></div>
                  <div class="skeleton skeleton-card-line short"></div>
                </div>
              </div>
            }
          </div>
        }
        @case ('avatar') {
          <div class="skeleton-avatar-list">
            @for (i of items(); track i) {
              <div class="skeleton-avatar-item" [style.animation-delay]="(i * 0.1) + 's'">
                <div class="skeleton skeleton-avatar-circle"></div>
                <div class="skeleton-avatar-lines">
                  <div class="skeleton skeleton-avatar-name"></div>
                  <div class="skeleton skeleton-avatar-sub"></div>
                </div>
              </div>
            }
          </div>
        }
        @case ('table') {
          <div class="skeleton-table">
            <div class="skeleton-table-header">
              <div class="skeleton skeleton-th" style="width: 30%"></div>
              <div class="skeleton skeleton-th" style="width: 20%"></div>
              <div class="skeleton skeleton-th" style="width: 25%"></div>
              <div class="skeleton skeleton-th" style="width: 15%"></div>
            </div>
            @for (i of items(); track i) {
              <div class="skeleton-table-row" [style.animation-delay]="(i * 0.06) + 's'">
                <div class="skeleton skeleton-td" style="width: 30%"></div>
                <div class="skeleton skeleton-td" style="width: 20%"></div>
                <div class="skeleton skeleton-td" style="width: 25%"></div>
                <div class="skeleton skeleton-td" style="width: 15%"></div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }

    .skeleton-container {
      width: 100%;
      animation: fadeIn 0.3s ease;
    }

    .skeleton {
      background: linear-gradient(
        90deg,
        #0a0a1a 0%,
        #1e1e3a 40%,
        #1e1e3a 60%,
        #0a0a1a 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.8s ease-in-out infinite;
      border-radius: 8px;
    }

    /* ── Text variant ── */
    .skeleton-text {
      height: 14px;
      margin-bottom: 12px;
      border-radius: 6px;
    }

    .skeleton-text:last-child {
      margin-bottom: 0;
    }

    /* ── Card variant ── */
    .skeleton-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px;
    }

    .skeleton-card {
      border-radius: 16px;
      border: 1px solid rgba(0, 229, 255, 0.06);
      background: rgba(10, 10, 26, 0.4);
      overflow: hidden;
    }

    .skeleton-card-image {
      width: 100%;
      height: 160px;
      border-radius: 0;
    }

    .skeleton-card-body {
      padding: 16px;
    }

    .skeleton-card-title {
      height: 18px;
      width: 70%;
      margin-bottom: 12px;
    }

    .skeleton-card-line {
      height: 12px;
      width: 100%;
      margin-bottom: 8px;
    }

    .skeleton-card-line.short {
      width: 55%;
      margin-bottom: 0;
    }

    /* ── Avatar variant ── */
    .skeleton-avatar-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .skeleton-avatar-item {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .skeleton-avatar-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .skeleton-avatar-lines {
      flex: 1;
      min-width: 0;
    }

    .skeleton-avatar-name {
      height: 14px;
      width: 45%;
      margin-bottom: 8px;
    }

    .skeleton-avatar-sub {
      height: 11px;
      width: 30%;
    }

    /* ── Table variant ── */
    .skeleton-table {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(0, 229, 255, 0.06);
      overflow: hidden;
      background: rgba(10, 10, 26, 0.3);
    }

    .skeleton-table-header {
      display: flex;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(0, 229, 255, 0.06);
      background: rgba(0, 229, 255, 0.02);
    }

    .skeleton-th {
      height: 12px;
      border-radius: 4px;
    }

    .skeleton-table-row {
      display: flex;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(0, 229, 255, 0.03);
    }

    .skeleton-table-row:last-child {
      border-bottom: none;
    }

    .skeleton-td {
      height: 12px;
      border-radius: 4px;
    }

    @media (max-width: 640px) {
      .skeleton-card-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class SkeletonComponent {
  /** Shape variant for the skeleton placeholders. */
  readonly variant = input<'text' | 'card' | 'avatar' | 'table'>('text');

  /** Number of skeleton items to render. */
  readonly count = input<number>(3);

  /** Generates an array of indices for the @for loop. */
  items(): number[] {
    return Array.from({ length: this.count() }, (_, i) => i);
  }

  /**
   * Returns a varied width for text skeleton lines to look natural.
   * @param index - The line index
   * @returns CSS width value
   */
  getTextWidth(index: number): string {
    const widths = ['100%', '92%', '78%', '85%', '60%', '95%', '70%', '88%'];
    return widths[index % widths.length];
  }
}
