import { Component, signal, inject, HostListener } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-feedback-widget',
  standalone: true,
  imports: [],
  template: `
    <!-- Floating feedback button -->
    @if (!isOpen()) {
      <button class="feedback-trigger" (click)="open()" aria-label="Send feedback">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </button>
    }

    <!-- Feedback modal -->
    @if (isOpen()) {
      <div class="feedback-panel">
        <div class="feedback-header">
          <h3>Send Feedback</h3>
          <button class="close-btn" (click)="close()" aria-label="Close feedback">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        @if (submitted()) {
          <div class="success-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p>Thank you for your feedback!</p>
          </div>
        } @else {
          <div class="rating-section">
            <span class="rating-label">How's your experience?</span>
            <div class="stars">
              @for (star of [1,2,3,4,5]; track star) {
                <button
                  class="star-btn"
                  [class.active]="star <= rating()"
                  (click)="setRating(star)"
                  [attr.aria-label]="star + ' star' + (star > 1 ? 's' : '')"
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" [attr.fill]="star <= rating() ? '#00E5FF' : 'none'" stroke="#00E5FF" stroke-width="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </button>
              }
            </div>
          </div>

          <textarea
            class="feedback-textarea"
            [value]="comment()"
            (input)="comment.set($any($event.target).value)"
            placeholder="Tell us more (optional)..."
            maxlength="2000"
            rows="3"
          ></textarea>
          <span class="char-count">{{ comment().length }}/2000</span>

          <button
            class="submit-btn"
            (click)="submit()"
            [disabled]="!rating() || submitting()"
          >
            @if (submitting()) {
              Sending...
            } @else {
              Send Feedback
            }
          </button>
        }
      </div>
    }
  `,
  styles: [`
    .feedback-trigger {
      position: fixed; bottom: 24px; right: 24px; z-index: 9000;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, #00E5FF, #50AAE3);
      border: none; cursor: pointer; color: #060610;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(0,229,255,0.3);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .feedback-trigger:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(0,229,255,0.4);
    }
    .feedback-panel {
      position: fixed; bottom: 24px; right: 24px; z-index: 9001;
      width: 340px; background: #0d0d1a;
      border: 1px solid rgba(0,229,255,0.15);
      border-radius: 16px; padding: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.4);
      animation: slideUp 0.2s ease;
    }
    .feedback-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px;
    }
    .feedback-header h3 {
      font-family: 'Sora', sans-serif; font-size: 16px; font-weight: 600;
      color: #f0f0f8; margin: 0;
    }
    .close-btn {
      background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px;
    }
    .close-btn:hover { color: #f0f0f8; }
    .rating-section { margin-bottom: 12px; }
    .rating-label { font-size: 13px; color: #94a3b8; display: block; margin-bottom: 8px; }
    .stars { display: flex; gap: 4px; }
    .star-btn {
      background: none; border: none; cursor: pointer; padding: 2px;
      transition: transform 0.1s ease;
    }
    .star-btn:hover { transform: scale(1.15); }
    .star-btn.active svg { filter: drop-shadow(0 0 6px rgba(0,229,255,0.4)); }
    .feedback-textarea {
      width: 100%; background: #0a0a1a; border: 1px solid #2e2e4a;
      border-radius: 8px; padding: 10px; color: #f0f0f8;
      font-family: 'Sora', sans-serif; font-size: 13px;
      resize: vertical; min-height: 60px;
    }
    .feedback-textarea:focus { border-color: #00E5FF; outline: none; }
    .char-count { font-size: 11px; color: #64748b; display: block; text-align: right; margin: 4px 0 12px; }
    .submit-btn {
      width: 100%; padding: 10px; border: none; border-radius: 8px;
      background: linear-gradient(135deg, #00E5FF, #50AAE3);
      color: #060610; font-weight: 600; font-size: 14px;
      cursor: pointer; transition: opacity 0.15s ease;
    }
    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .success-state {
      text-align: center; padding: 20px 0;
    }
    .success-state p { color: #f0f0f8; font-size: 14px; margin-top: 12px; }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class FeedbackWidgetComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }

  isOpen = signal(false);
  rating = signal(0);
  comment = signal('');
  submitting = signal(false);
  submitted = signal(false);

  open(): void { this.isOpen.set(true); }
  close(): void {
    this.isOpen.set(false);
    this.reset();
  }

  setRating(value: number): void { this.rating.set(value); }

  submit(): void {
    if (!this.rating()) return;
    this.submitting.set(true);

    this.api.post('/feedback', {
      rating: this.rating(),
      comment: this.comment() || null,
      page_url: window.location.pathname,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
        setTimeout(() => this.close(), 2000);
      },
      error: () => {
        this.submitting.set(false);
        this.toast.error('Failed to send feedback. Please try again.');
      },
    });
  }

  private reset(): void {
    this.rating.set(0);
    this.comment.set('');
    this.submitted.set(false);
  }
}
