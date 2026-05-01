import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
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
          <span class="digit">4</span>
          <span class="digit zero">0</span>
          <span class="digit">4</span>
        </div>

        <h1 class="heading">This page doesn't exist</h1>
        <p class="message">
          The page you're looking for may have moved or been removed.
          Try searching or visit one of the links below.
        </p>

        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search for a business or site..."
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            (keydown.enter)="onSearch()"
            aria-label="Search for a business or site"
          />
          <button
            class="search-btn"
            (click)="onSearch()"
            [disabled]="!searchQuery().trim()"
            aria-label="Submit search"
          >
            Search
          </button>
        </div>

        <nav class="popular-links" aria-label="Popular pages">
          <h2 class="links-heading">Popular pages</h2>
          <div class="links-grid">
            <a routerLink="/" class="link-card">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
              </svg>
              <span>Home</span>
            </a>
            <a routerLink="/search" class="link-card">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Search</span>
            </a>
            <a routerLink="/create" class="link-card">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M12 4v16m8-8H4" />
              </svg>
              <span>Create</span>
            </a>
            <a routerLink="/admin" class="link-card">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Admin</span>
            </a>
          </div>
        </nav>

        <a routerLink="/" class="cta-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Home
        </a>
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
      background: radial-gradient(circle, #0891b2, transparent 70%);
      top: -120px; right: -120px;
      animation: orbFloat1 20s ease-in-out infinite;
    }
    .orb-2 {
      width: 400px; height: 400px;
      background: radial-gradient(circle, #00d4ff, transparent 70%);
      bottom: -80px; left: -100px;
      animation: orbFloat2 18s ease-in-out infinite;
    }
    .orb-3 {
      width: 300px; height: 300px;
      background: radial-gradient(circle, #67e8f9, transparent 70%);
      top: 40%; left: 50%;
      animation: orbFloat1 22s ease-in-out infinite reverse;
      opacity: 0.12;
    }

    /* Content */
    .content {
      position: relative;
      z-index: 1;
      text-align: center;
      max-width: 600px;
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
      background: linear-gradient(135deg, #00E5FF 0%, #50AAE3 50%, #00E5FF 100%);
      background-size: 200% 200%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: gradientShift 4s ease-in-out infinite;
    }
    .digit.zero {
      animation: gradientShift 4s ease-in-out infinite, pulse404 2s ease-in-out infinite;
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

    /* Search box */
    .search-box {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(0, 229, 255, 0.15);
      border-radius: 12px;
      padding: 0.25rem 0.25rem 0.25rem 1rem;
      margin-bottom: 2rem;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .search-box:focus-within {
      border-color: rgba(0, 229, 255, 0.4);
      box-shadow: 0 0 20px rgba(0, 229, 255, 0.08);
    }
    .search-icon {
      width: 18px;
      height: 18px;
      color: #94a3b8;
      flex-shrink: 0;
    }
    .search-box input {
      flex: 1;
      background: transparent;
      border: none;
      color: #f0f0f8;
      font-family: 'Sora', sans-serif;
      font-size: 0.95rem;
      padding: 0.75rem 0.75rem;
      outline: none;
    }
    .search-box input::placeholder { color: #64748b; }
    .search-btn {
      background: linear-gradient(135deg, #00E5FF 0%, #50AAE3 100%);
      color: #060610;
      border: none;
      border-radius: 8px;
      padding: 0.6rem 1.25rem;
      font-family: 'Sora', sans-serif;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .search-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .search-btn:disabled { opacity: 0.5; cursor: default; }

    /* Popular links */
    .links-heading {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.875rem;
      font-weight: 500;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 1rem;
    }
    .links-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.75rem;
      margin-bottom: 2rem;
    }
    .link-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 1rem 0.5rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(100, 255, 218, 0.08);
      border-radius: 12px;
      color: #94a3b8;
      text-decoration: none;
      font-family: 'Sora', sans-serif;
      font-size: 0.8rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    .link-card:hover {
      background: rgba(0, 229, 255, 0.06);
      border-color: rgba(0, 229, 255, 0.2);
      color: #00E5FF;
      transform: translateY(-2px);
    }
    .link-card svg {
      width: 22px;
      height: 22px;
    }

    /* CTA */
    .cta-btn {
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
    .cta-btn:hover {
      background: rgba(0, 229, 255, 0.08);
      border-color: rgba(0, 229, 255, 0.5);
      transform: translateY(-2px);
    }
    .cta-btn svg {
      width: 18px;
      height: 18px;
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
    @keyframes gradientShift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    @keyframes pulse404 {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(0.95); }
    }

    @media (prefers-reduced-motion: reduce) {
      .orb, .digit, .digit.zero, .content {
        animation: none !important;
      }
    }

    @media (max-width: 480px) {
      .links-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `],
})
export class NotFoundComponent {
  private router = inject(Router);
  searchQuery = signal('');

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  onSearch(): void {
    const q = this.searchQuery().trim();
    if (q) {
      this.router.navigate(['/search'], { queryParams: { q } });
    }
  }
}
