import { Component, type OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  route?: string;
  completed: boolean;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="onboarding-overlay" (click)="dismiss()">
        <div class="onboarding-card" (click)="$event.stopPropagation()">
          <div class="onboarding-header">
            <h2>Welcome to Project Sites</h2>
            <p>Get your AI-generated website live in 5 minutes</p>
            <button class="close-btn" (click)="dismiss()" aria-label="Close onboarding">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div class="progress-bar">
            <div class="progress-fill" [style.width.%]="progressPercent()"></div>
          </div>
          <span class="progress-label">{{ completedCount() }}/{{ steps().length }} complete</span>

          <div class="steps">
            @for (step of steps(); track step.id) {
              <div class="step" [class.completed]="step.completed" (click)="goToStep(step)">
                <div class="step-check">
                  @if (step.completed) {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  } @else {
                    <div class="step-circle"></div>
                  }
                </div>
                <div class="step-content">
                  <span class="step-title">{{ step.title }}</span>
                  <span class="step-desc">{{ step.description }}</span>
                </div>
                <svg class="step-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            }
          </div>

          <div class="onboarding-footer">
            <button class="dismiss-btn" (click)="dismiss()">I'll explore on my own</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .onboarding-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: fadeIn 0.2s ease;
    }
    .onboarding-card {
      background: #0d0d1a; border: 1px solid rgba(0,229,255,0.15);
      border-radius: 16px; padding: 32px; max-width: 480px; width: 90%;
      animation: fadeInScale 0.3s ease;
      position: relative;
    }
    .onboarding-header { margin-bottom: 20px; }
    .onboarding-header h2 {
      font-family: 'Sora', sans-serif; font-size: 22px; font-weight: 700;
      color: #f0f0f8; margin: 0 0 4px;
    }
    .onboarding-header p {
      font-size: 14px; color: #94a3b8; margin: 0;
    }
    .close-btn {
      position: absolute; top: 16px; right: 16px; background: none;
      border: none; color: #94a3b8; cursor: pointer; padding: 4px;
    }
    .close-btn:hover { color: #f0f0f8; }
    .progress-bar {
      height: 4px; background: #1e1e3a; border-radius: 2px;
      overflow: hidden; margin-bottom: 6px;
    }
    .progress-fill {
      height: 100%; background: linear-gradient(90deg, #00E5FF, #50AAE3);
      border-radius: 2px; transition: width 0.4s ease;
    }
    .progress-label {
      font-size: 12px; color: #64748b; margin-bottom: 16px; display: block;
    }
    .steps { display: flex; flex-direction: column; gap: 4px; }
    .step {
      display: flex; align-items: center; gap: 12px;
      padding: 12px; border-radius: 10px; cursor: pointer;
      transition: background 0.15s ease;
    }
    .step:hover { background: rgba(0,229,255,0.04); }
    .step.completed { opacity: 0.6; }
    .step-check { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-circle {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid #3e3e5a;
    }
    .step-content { flex: 1; display: flex; flex-direction: column; }
    .step-title { font-size: 14px; font-weight: 600; color: #f0f0f8; }
    .step-desc { font-size: 12px; color: #94a3b8; }
    .step-arrow { color: #3e3e5a; flex-shrink: 0; }
    .onboarding-footer { margin-top: 20px; text-align: center; }
    .dismiss-btn {
      background: none; border: 1px solid #2e2e4a; color: #94a3b8;
      padding: 8px 20px; border-radius: 8px; cursor: pointer;
      font-size: 13px; transition: all 0.15s ease;
    }
    .dismiss-btn:hover { border-color: #00E5FF; color: #00E5FF; }
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }
  `],
})
export class OnboardingComponent implements OnInit {
  private router = inject(Router);
  private readonly STORAGE_KEY = 'ps_onboarding';

  visible = signal(false);

  steps = signal<OnboardingStep[]>([
    { id: 'search', title: 'Search for your business', description: 'Find your business on Google Places', icon: 'search', route: '/search', completed: false },
    { id: 'signin', title: 'Sign in to your account', description: 'Create an account with email or Google', icon: 'login', route: '/signin', completed: false },
    { id: 'create', title: 'Create your site', description: 'Add details and let AI build it', icon: 'create', route: '/create', completed: false },
    { id: 'preview', title: 'Preview and publish', description: 'Review your generated website', icon: 'preview', route: '/admin', completed: false },
    { id: 'domain', title: 'Connect a custom domain', description: 'Point your own domain to your site', icon: 'domain', route: '/admin/settings', completed: false },
  ]);

  completedCount = signal(0);
  progressPercent = signal(0);

  ngOnInit(): void {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored === 'dismissed') return;

    if (stored) {
      try {
        const completed: string[] = JSON.parse(stored);
        const updated = this.steps().map((s) => ({ ...s, completed: completed.includes(s.id) }));
        this.steps.set(updated);
        this.updateProgress();
      } catch {
        // ignore parse errors
      }
    }

    // Show after a brief delay to not block first paint
    setTimeout(() => this.visible.set(true), 1500);
  }

  dismiss(): void {
    this.visible.set(false);
    localStorage.setItem(this.STORAGE_KEY, 'dismissed');
  }

  goToStep(step: OnboardingStep): void {
    if (step.route) {
      this.router.navigate([step.route]);
      this.markComplete(step.id);
      this.visible.set(false);
    }
  }

  markComplete(stepId: string): void {
    const updated = this.steps().map((s) =>
      s.id === stepId ? { ...s, completed: true } : s,
    );
    this.steps.set(updated);
    this.updateProgress();
    const completedIds = updated.filter((s) => s.completed).map((s) => s.id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(completedIds));
  }

  private updateProgress(): void {
    const count = this.steps().filter((s) => s.completed).length;
    this.completedCount.set(count);
    this.progressPercent.set((count / this.steps().length) * 100);
  }
}
