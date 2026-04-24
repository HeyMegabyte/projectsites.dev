import {
  Component,
  type OnInit,
  type OnDestroy,
  inject,
  signal,
  NgZone,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';

/** Brand palette used across all easter egg effects */
const BRAND_COLORS = ['#00E5FF', '#50AAE3', '#FFFFFF', '#7C3AED', '#E040FB'];

/** Katakana + Latin characters for the Matrix rain effect */
const MATRIX_CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Konami code key sequence: Up Up Down Down Left Right Left Right B A */
const KONAMI_SEQUENCE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA',
];

type ActiveEffect = 'party' | 'matrix' | 'disco' | null;

/**
 * Easter eggs component that listens for URL parameters and keyboard
 * sequences to trigger fun visual effects. Respects prefers-reduced-motion.
 *
 * Triggers:
 * - `?party` URL param: confetti burst (3s)
 * - `?disco` URL param: color-cycling disco mode (5s)
 * - Konami code (Up Up Down Down Left Right Left Right B A): Matrix rain (8s)
 *
 * @example
 * ```html
 * <app-easter-eggs />
 * ```
 */
@Component({
  selector: 'app-easter-eggs',
  standalone: true,
  template: `
    @if (activeEffect()) {
      @if (reducedMotion()) {
        <div
          class="reduced-motion-overlay"
          (click)="dismiss()"
          (keydown.escape)="dismiss()"
          tabindex="0"
          role="dialog"
          aria-label="Easter egg effect active"
        >
          @switch (activeEffect()) {
            @case ('party') {
              <span class="reduced-motion-text" aria-live="polite">Party mode!</span>
            }
            @case ('disco') {
              <span class="reduced-motion-text" aria-live="polite">Disco mode!</span>
            }
            @case ('matrix') {
              <span class="reduced-motion-text" aria-live="polite">You found the Matrix!</span>
            }
          }
          <span class="dismiss-hint">Press Escape or click to dismiss</span>
        </div>
      } @else {
        @if (activeEffect() === 'disco') {
          <div
            class="disco-overlay"
            [class.active]="discoActive()"
            (click)="dismiss()"
            role="dialog"
            aria-label="Disco mode active"
          >
            <span class="dismiss-hint dismiss-hint-disco">Press Escape or click to dismiss</span>
          </div>
        }
        @if (activeEffect() === 'party' || activeEffect() === 'matrix') {
          <div class="dismiss-hint-canvas" aria-hidden="true">Press Escape or click to dismiss</div>
        }
      }
    }
  `,
  styles: [
    `
      .reduced-motion-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(6, 6, 16, 0.92);
        cursor: pointer;
      }

      .reduced-motion-text {
        font-size: 2.5rem;
        font-weight: 700;
        color: #00e5ff;
        font-family: 'Space Grotesk', 'Sora', system-ui, sans-serif;
        text-shadow: 0 0 30px rgba(0, 229, 255, 0.4);
      }

      .dismiss-hint {
        position: absolute;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.875rem;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        pointer-events: none;
        white-space: nowrap;
      }

      .dismiss-hint-canvas {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.875rem;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        z-index: 100001;
        pointer-events: none;
        white-space: nowrap;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
      }

      .dismiss-hint-disco {
        z-index: 100001;
      }

      .disco-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .disco-overlay.active {
        opacity: 1;
        animation: discoPulse 0.6s ease-in-out infinite;
      }

      @keyframes discoPulse {
        0% {
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(0, 229, 255, 0.15) 0%,
            transparent 70%
          );
        }
        25% {
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(80, 170, 227, 0.15) 0%,
            transparent 70%
          );
        }
        50% {
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(124, 58, 237, 0.15) 0%,
            transparent 70%
          );
        }
        75% {
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(224, 64, 251, 0.15) 0%,
            transparent 70%
          );
        }
        100% {
          background: radial-gradient(
            ellipse at 50% 50%,
            rgba(0, 229, 255, 0.15) 0%,
            transparent 70%
          );
        }
      }
    `,
  ],
})
export class EasterEggsComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private zone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);

  /** Currently active visual effect */
  activeEffect = signal<ActiveEffect>(null);

  /** Whether the user prefers reduced motion */
  reducedMotion = signal(false);

  /** Whether the disco overlay CSS animation is active */
  discoActive = signal(false);

  /** Tracks the Konami code key input buffer */
  private konamiBuffer: string[] = [];

  /** Reference to the canvas element used by party/matrix effects */
  private canvas: HTMLCanvasElement | null = null;

  /** requestAnimationFrame handle for canvas effects */
  private animationFrameId: number | null = null;

  /** Auto-dismiss timer handle */
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bound keyboard handler for cleanup */
  private keydownHandler = this.onKeydown.bind(this);

  /** Bound click handler for canvas dismiss */
  private canvasClickHandler = this.dismiss.bind(this);

  /** Route subscription for URL param detection */
  private routeSub: Subscription | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.reducedMotion.set(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.keydownHandler);
    });

    this.checkUrlParams();

    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.checkUrlParams());
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    document.removeEventListener('keydown', this.keydownHandler);
    this.routeSub?.unsubscribe();
    this.cleanupEffect();
  }

  /** Dismiss the current effect and clean up all resources */
  dismiss(): void {
    this.cleanupEffect();
    this.zone.run(() => {
      this.activeEffect.set(null);
      this.discoActive.set(false);
    });
  }

  /**
   * Check current URL for easter egg query parameters.
   * Cleans the params from the URL after triggering.
   */
  private checkUrlParams(): void {
    const params = new URLSearchParams(window.location.search);

    if (params.has('party')) {
      this.cleanParam('party');
      this.triggerParty();
    } else if (params.has('disco')) {
      this.cleanParam('disco');
      this.triggerDisco();
    }
  }

  /** Remove a query parameter from the URL without navigation */
  private cleanParam(param: string): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState({}, '', url.toString());
  }

  /** Handle keydown events for Konami code detection and Escape dismissal */
  private onKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && this.activeEffect()) {
      this.dismiss();
      return;
    }

    this.konamiBuffer.push(event.code);
    if (this.konamiBuffer.length > KONAMI_SEQUENCE.length) {
      this.konamiBuffer.shift();
    }

    if (
      this.konamiBuffer.length === KONAMI_SEQUENCE.length &&
      this.konamiBuffer.every((key, i) => key === KONAMI_SEQUENCE[i])
    ) {
      this.konamiBuffer = [];
      this.triggerMatrix();
    }
  }

  /** Clean up canvas, timers, and animation frames */
  private cleanupEffect(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.canvasClickHandler);
      this.canvas.remove();
      this.canvas = null;
    }
  }

  /**
   * Create a full-screen canvas overlay for particle/rain effects.
   * Canvas is positioned fixed with high z-index and auto-resizes.
   */
  private createCanvas(): HTMLCanvasElement {
    this.cleanupEffect();
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.zIndex = '100000';
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'pointer';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.addEventListener('click', this.canvasClickHandler);
    document.body.appendChild(canvas);
    this.canvas = canvas;
    return canvas;
  }

  // ---------------------------------------------------------------------------
  // Party (confetti burst)
  // ---------------------------------------------------------------------------

  /** Trigger the confetti burst effect for 3 seconds */
  private triggerParty(): void {
    if (this.activeEffect()) return;

    this.zone.run(() => this.activeEffect.set('party'));

    if (this.reducedMotion()) {
      this.dismissTimer = setTimeout(() => this.dismiss(), 3000);
      return;
    }

    const canvas = this.createCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles: ConfettiParticle[] = [];
    const startTime = performance.now();

    // Spawn 150 particles in a burst from center-top
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 12,
        vy: -(Math.random() * 14 + 4),
        color: BRAND_COLORS[Math.floor(Math.random() * BRAND_COLORS.length)],
        size: Math.random() * 8 + 3,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
      });
    }

    this.zone.runOutsideAngular(() => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        if (elapsed > 3000) {
          this.dismiss();
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const p of particles) {
          p.vy += 0.25; // gravity
          p.vx *= 0.99; // air resistance
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.rotationSpeed;
          p.opacity = Math.max(0, 1 - elapsed / 3000);

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;

          if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        }

        this.animationFrameId = requestAnimationFrame(animate);
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  // ---------------------------------------------------------------------------
  // Matrix rain
  // ---------------------------------------------------------------------------

  /** Trigger the Matrix digital rain effect for 8 seconds */
  private triggerMatrix(): void {
    if (this.activeEffect()) return;

    this.zone.run(() => this.activeEffect.set('matrix'));

    if (this.reducedMotion()) {
      this.dismissTimer = setTimeout(() => this.dismiss(), 8000);
      return;
    }

    const canvas = this.createCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontSize = 16;
    const columns = Math.ceil(canvas.width / fontSize);
    const drops: number[] = new Array(columns).fill(0).map(() => Math.random() * -50);
    const speeds: number[] = new Array(columns).fill(0).map(() => 0.3 + Math.random() * 0.7);
    const startTime = performance.now();

    this.zone.runOutsideAngular(() => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        if (elapsed > 8000) {
          this.dismiss();
          return;
        }

        // Semi-transparent black for trail effect
        ctx.fillStyle = 'rgba(6, 6, 16, 0.06)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.font = `${fontSize}px 'JetBrains Mono', 'Fira Code', monospace`;

        for (let i = 0; i < columns; i++) {
          const char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
          const y = drops[i] * fontSize;

          // Leading character is bright cyan, trail fades to green
          if (Math.random() > 0.3) {
            ctx.fillStyle = '#00E5FF';
            ctx.globalAlpha = 0.95;
          } else {
            ctx.fillStyle = '#50AAE3';
            ctx.globalAlpha = 0.7;
          }

          ctx.fillText(char, i * fontSize, y);

          // Fade-in/out at edges
          const fadeOut = Math.min(1, (8000 - elapsed) / 1000);
          ctx.globalAlpha *= fadeOut;

          drops[i] += speeds[i];

          // Reset drop to top when it goes below screen
          if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
          }
        }

        ctx.globalAlpha = 1;
        this.animationFrameId = requestAnimationFrame(animate);
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  // ---------------------------------------------------------------------------
  // Disco
  // ---------------------------------------------------------------------------

  /** Trigger the disco color-cycling effect for 5 seconds */
  private triggerDisco(): void {
    if (this.activeEffect()) return;

    this.zone.run(() => {
      this.activeEffect.set('disco');
      // Slight delay so the DOM element exists before activating animation
      setTimeout(() => this.discoActive.set(true), 50);
    });

    this.dismissTimer = setTimeout(() => this.dismiss(), 5000);
  }
}

/** Particle data for the confetti burst effect */
interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  shape: 'rect' | 'circle';
}
