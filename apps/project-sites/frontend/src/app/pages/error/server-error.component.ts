import { Component, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-server-error',
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
        <div class="error-code" aria-hidden="true">
          <span class="digit">5</span>
          <span class="digit zero">0</span>
          <span class="digit">0</span>
        </div>

        <h1 class="heading">Something broke on our end</h1>
        <p class="message">
          We've been notified and are working on a fix.
          You can retry or head back home.
        </p>

        @if (correlationId()) {
          <div class="correlation-box" role="status">
            <span class="correlation-label">Error reference</span>
            <code class="correlation-id">{{ correlationId() }}</code>
            <button
              class="copy-btn"
              (click)="copyCorrelationId()"
              [attr.aria-label]="'Copy error reference ' + correlationId()"
            >
              @if (copied()) {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              } @else {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              }
            </button>
          </div>
        }

        <div class="actions">
          <button class="retry-btn" (click)="onRetry()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Retry
          </button>
          <a routerLink="/" class="home-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </a>
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
      background: radial-gradient(circle, #b91c1c, transparent 70%);
      top: -120px; right: -120px;
      animation: orbFloat1 20s ease-in-out infinite;
    }
    .orb-2 {
      width: 400px; height: 400px;
      background: radial-gradient(circle, #ef4444, transparent 70%);
      bottom: -80px; left: -100px;
      animation: orbFloat2 18s ease-in-out infinite;
    }
    .orb-3 {
      width: 300px; height: 300px;
      background: radial-gradient(circle, #f87171, transparent 70%);
      top: 40%; left: 50%;
      animation: orbFloat1 22s ease-in-out infinite reverse;
      opacity: 0.12;
    }

    /* Content */
    .content {
      position: relative;
      z-index: 1;
      text-align: center;
      max-width: 550px;
      width: 100%;
      animation: fadeInUp 0.6s ease-out;
    }

    /* Error code */
    .error-code {
      display: flex;
      justify-content: center;
      gap: 0.25rem;
      margin-bottom: 1.5rem;
    }
    .digit {
      font-family: 'JetBrains Mono', monospace;
      font-size: clamp(5rem, 15vw, 10rem);
      font-weight: 700;
      line-height: 1;
      color: transparent;
      background: linear-gradient(135deg, #ef4444 0%, #f97316 50%, #ef4444 100%);
      background-size: 200% 200%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: gradientShift 4s ease-in-out infinite;
    }
    .digit.zero {
      animation: gradientShift 4s ease-in-out infinite, pulse500 3s ease-in-out infinite;
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
      margin: 0 0 2rem;
    }

    /* Correlation ID */
    .correlation-box {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      background: rgba(239, 68, 68, 0.06);
      border: 1px solid rgba(239, 68, 68, 0.15);
      border-radius: 10px;
      padding: 0.75rem 1rem;
      margin-bottom: 2rem;
    }
    .correlation-label {
      font-family: 'Sora', sans-serif;
      font-size: 0.75rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .correlation-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: #f87171;
      background: rgba(239, 68, 68, 0.08);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .copy-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
      transition: color 0.2s ease;
    }
    .copy-btn:hover { color: #f0f0f8; }
    .copy-btn svg { width: 16px; height: 16px; }

    /* Actions */
    .actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
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
    .retry-btn:hover { opacity: 0.9; transform: translateY(-2px); }
    .retry-btn svg { width: 18px; height: 18px; }

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
    @keyframes gradientShift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    @keyframes pulse500 {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @media (prefers-reduced-motion: reduce) {
      .orb, .digit, .digit.zero, .content {
        animation: none !important;
      }
    }

    @media (max-width: 480px) {
      .actions { flex-direction: column; }
      .correlation-box { flex-direction: column; gap: 0.5rem; }
    }
  `],
})
export class ServerErrorComponent implements OnInit {
  correlationId = signal('');
  copied = signal(false);

  ngOnInit(): void {
    this.correlationId.set(this.generateCorrelationId());
  }

  onRetry(): void {
    window.location.reload();
  }

  async copyCorrelationId(): Promise<void> {
    const id = this.correlationId();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard API not available; silently fail
    }
  }

  private generateCorrelationId(): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `err-${result}-${Date.now().toString(36)}`;
  }
}
