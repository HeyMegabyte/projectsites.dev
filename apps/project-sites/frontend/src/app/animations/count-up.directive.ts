import {
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';

/**
 * Animates the host element's text content from `psCountFrom` to `psCountTo` using rAF
 * when it enters the viewport. Locale-formats the number and supports an optional suffix
 * (e.g. `+`, `%`, `K`). Snaps to the final value under `prefers-reduced-motion: reduce`.
 */
@Directive({
  selector: '[psCountUp]',
  standalone: true,
})
export class CountUpDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Target value (the final number rendered). */
  @Input({ required: true }) psCountUp!: number;
  @Input() psCountFrom = 0;
  @Input() psCountDuration = 1400;
  @Input() psCountDecimals = 0;
  @Input() psCountPrefix = '';
  @Input() psCountSuffix = '';
  @Input() psCountLocale = 'en-US';

  private observer?: IntersectionObserver;
  private rafId?: number;
  private started = false;

  ngOnInit(): void {
    const el = this.host.nativeElement;
    this.render(this.psCountFrom);

    if (typeof window === 'undefined') {
      this.render(this.psCountUp);
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      this.render(this.psCountUp);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.started) {
            this.started = true;
            this.observer?.disconnect();
            this.start();
          }
        }
      },
      { threshold: 0.3 }
    );
    this.observer.observe(el);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
  }

  private start(): void {
    const from = this.psCountFrom;
    const to = this.psCountUp;
    const duration = Math.max(120, this.psCountDuration);
    const startTime = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const value = from + (to - from) * eased;
      this.render(value);
      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.render(to);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private render(value: number): void {
    const formatted = value.toLocaleString(this.psCountLocale, {
      minimumFractionDigits: this.psCountDecimals,
      maximumFractionDigits: this.psCountDecimals,
    });
    this.host.nativeElement.textContent = `${this.psCountPrefix}${formatted}${this.psCountSuffix}`;
  }
}
