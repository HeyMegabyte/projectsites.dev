import { Component, inject, signal, type OnInit, type OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * GitHub OAuth Backup section.
 *
 * @remarks
 * Per Brian's directive: no token, no repository name field — connect via OAuth
 * and let the worker derive the repo slug from `*.projectsites.dev`. The repo
 * name is `${site.slug.replace(/\./g, '-')}` (e.g. `nyfoldingbox-projectsites-dev`).
 *
 * Backend contract (see `apps/project-sites/src/routes/api.ts`):
 *  - `GET  /api/sites/:id/github/status`     → { connected, repo, last_backup_at, commit_count, html_url }
 *  - `GET  /api/sites/:id/github/connect`    → { url } (returns OAuth redirect URL with state cookie)
 *  - `POST /api/sites/:id/github/backup`     → { ok, commit_sha, html_url }
 *  - `POST /api/sites/:id/github/disconnect` → { ok }
 */
interface GithubBackupStatus {
  connected: boolean;
  repo?: string;
  owner?: string;
  html_url?: string;
  last_backup_at?: string;
  last_commit_sha?: string;
  commit_count?: number;
  github_user?: string;
  github_avatar_url?: string;
}

@Component({
  selector: 'app-admin-github-backup',
  standalone: true,
  imports: [],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      @if (!state.selectedSite()) {
        <div class="empty-card flex flex-col items-center justify-center text-center py-20 px-5 gap-4">
          <div class="empty-glyph" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
          </div>
          <h3 class="text-white font-semibold text-lg m-0">Select a site first</h3>
          <p class="text-[0.86rem] text-text-secondary max-w-[420px] m-0 leading-relaxed">Choose a site from the sidebar to connect a GitHub backup. Every snapshot will commit to a dedicated repo named after your subdomain.</p>
        </div>
      } @else {

        <div class="gh-header">
          <h2 class="text-lg font-bold text-white m-0 flex items-center gap-2.5">
            <span class="gh-header-glyph" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
              </svg>
            </span>
            GitHub Backup
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Mirror every build to a private repo. One-click OAuth — no tokens, no copy-paste.</p>
        </div>

        @if (loading()) {
          <div class="gh-card gh-card-loading flex items-center justify-center py-16">
            <div class="orbit-spinner" aria-hidden="true">
              <div class="orbit orbit-1"></div>
              <div class="orbit orbit-2"></div>
              <div class="orbit orbit-3"></div>
            </div>
            <span class="ml-4 text-sm text-text-secondary/80 tracking-wide">Loading backup status</span>
          </div>
        } @else if (!status()?.connected) {

          <!-- ── DISCONNECTED STATE ─────────────────────── -->
          <div class="gh-card gh-card-connect group">
            <div class="gh-card-aurora" aria-hidden="true"></div>
            <div class="flex flex-col items-center text-center gap-4 py-8 px-4 relative z-[1]">
              <div class="gh-mark" aria-hidden="true">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
              </div>
              <h3 class="text-base font-semibold text-white m-0">Connect your GitHub account</h3>
              <p class="text-[0.82rem] text-text-secondary max-w-[480px] m-0 leading-relaxed">We'll create a private repo named <span class="repo-pill">{{ derivedRepoName() }}</span> and push every build version to it. You can revert from the Snapshots page any time.</p>

              <button class="btn-oauth" type="button" (click)="startOAuth()" [disabled]="connecting()">
                <span class="btn-glow" aria-hidden="true"></span>
                <span class="relative z-[1] flex items-center gap-2.5">
                  @if (connecting()) {
                    <span class="btn-spin" aria-hidden="true"></span>
                    <span>Redirecting to GitHub…</span>
                  } @else {
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                    </svg>
                    <span>Sign in with GitHub</span>
                  }
                </span>
              </button>

              <ul class="gh-bullets">
                <li><span class="bullet-dot" aria-hidden="true"></span><span>Private repo, owned by you — we never see your code after the push.</span></li>
                <li><span class="bullet-dot" aria-hidden="true"></span><span>OAuth scope <code class="scope-chip">repo</code> only. Revoke any time from GitHub.</span></li>
                <li><span class="bullet-dot" aria-hidden="true"></span><span>Every build snapshot becomes a commit with a friendly message.</span></li>
              </ul>
            </div>
          </div>
        } @else {

          <!-- ── CONNECTED STATE ────────────────────────── -->
          <div class="gh-card group">
            <div class="flex items-start justify-between gap-4 mb-5 max-md:flex-col">
              <div class="flex items-center gap-3 min-w-0">
                @if (status()?.github_avatar_url) {
                  <img class="gh-avatar" [src]="status()?.github_avatar_url" [alt]="status()?.github_user + ' avatar'" />
                } @else {
                  <div class="gh-avatar gh-avatar-fallback" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                    </svg>
                  </div>
                }
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="status-dot" aria-hidden="true"></span>
                    <span class="text-[0.7rem] uppercase tracking-[0.12em] font-bold text-emerald-400">Connected</span>
                  </div>
                  <h3 class="text-base font-semibold text-white m-0 mt-1 truncate">{{ status()?.github_user || 'GitHub user' }}</h3>
                  <a class="repo-link" [href]="repoUrl()" target="_blank" rel="noopener noreferrer">
                    <span class="truncate">{{ status()?.owner }}/{{ status()?.repo || derivedRepoName() }}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                </div>
              </div>

              <button class="pill-btn pill-btn-danger" type="button" (click)="disconnect()" [disabled]="disconnecting()">
                @if (disconnecting()) {
                  <span class="btn-spin btn-spin-sm" aria-hidden="true"></span>
                  <span>Disconnecting…</span>
                } @else {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  <span>Disconnect</span>
                }
              </button>
            </div>

            <div class="gh-stat-grid">
              <div class="gh-stat">
                <span class="gh-stat-label">Last backup</span>
                <span class="gh-stat-value">{{ status()?.last_backup_at ? state.formatRelativeTime(status()!.last_backup_at!) : 'Never' }}</span>
              </div>
              <div class="gh-stat">
                <span class="gh-stat-label">Total commits</span>
                <span class="gh-stat-value tabular-nums">{{ status()?.commit_count ?? 0 }}</span>
              </div>
              <div class="gh-stat">
                <span class="gh-stat-label">Last SHA</span>
                <span class="gh-stat-value gh-stat-mono">{{ shortSha() }}</span>
              </div>
            </div>

            <div class="flex items-center gap-3 mt-6 flex-wrap">
              <button class="btn-upgrade" type="button" (click)="backupNow()" [disabled]="backingUp()">
                <span class="btn-glow" aria-hidden="true"></span>
                <span class="relative z-[1] flex items-center gap-2">
                  @if (backingUp()) {
                    <span class="btn-spin" aria-hidden="true"></span>
                    <span>Committing…</span>
                  } @else {
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>Backup now</span>
                  }
                </span>
              </button>

              <a class="pill-btn pill-btn-ghost" [href]="repoUrl()" target="_blank" rel="noopener noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                <span>Open repo</span>
              </a>

              @if (status()?.last_commit_sha) {
                <a class="pill-btn pill-btn-ghost" [href]="commitUrl()" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>
                  <span>Last commit</span>
                </a>
              }
            </div>
          </div>

          <!-- How it works strip -->
          <div class="gh-card">
            <h3 class="text-sm font-semibold text-white m-0 mb-4 flex items-center gap-2">
              <svg class="text-primary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              How GitHub Backup works
            </h3>
            <ol class="gh-steps">
              <li>
                <span class="step-num">1</span>
                <div class="step-body">
                  <span class="step-title">Every published build commits to <code class="scope-chip">main</code></span>
                  <span class="step-desc">Snapshots map 1:1 to commits. Build {{ buildVersionLabel() }} → commit message <code class="scope-chip">build/v{{ buildVersionLabel() }}</code>.</span>
                </div>
              </li>
              <li>
                <span class="step-num">2</span>
                <div class="step-body">
                  <span class="step-title">Tag-per-version for clean rollback</span>
                  <span class="step-desc">Every build also creates an annotated tag <code class="scope-chip">v{{ buildVersionLabel() }}</code> so you can <code class="scope-chip">git checkout</code> any prior version locally.</span>
                </div>
              </li>
              <li>
                <span class="step-num">3</span>
                <div class="step-body">
                  <span class="step-title">Repo stays in sync with your subdomain</span>
                  <span class="step-desc">Repo name is derived from your subdomain: <code class="scope-chip">{{ derivedRepoName() }}</code>. Change the subdomain → we'll rename the repo automatically.</span>
                </div>
              </li>
            </ol>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ring-cyan: 0 0 0 2px #000, 0 0 0 4px rgba(0, 229, 255, 0.55);
      --ring-danger: 0 0 0 2px #000, 0 0 0 4px rgba(248, 113, 113, 0.55);
    }

    .gh-header { animation: fadeUp 500ms var(--ease-cinematic); }
    .gh-header-glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px; height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.16), rgba(124, 58, 237, 0.16));
      color: rgba(0, 229, 255, 0.95);
      transition: transform 380ms var(--ease-elastic), box-shadow 320ms var(--ease-cinematic);
    }
    .gh-header:hover .gh-header-glyph {
      transform: rotate(-8deg) scale(1.08);
      box-shadow: 0 12px 32px -16px rgba(0, 229, 255, 0.5);
    }

    .empty-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 18px;
      animation: fadeUp 600ms var(--ease-cinematic);
    }
    .empty-glyph {
      width: 88px; height: 88px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 22px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.08), rgba(124, 58, 237, 0.06));
      border: 1px solid rgba(0, 229, 255, 0.12);
      color: rgba(0, 229, 255, 0.7);
      animation: pulseGlyph 3.4s var(--ease-cinematic) infinite;
    }

    /* ── Card scaffold ─────────────────────────────── */
    .gh-card {
      position: relative;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 1.5rem;
      animation: fadeUp 520ms var(--ease-cinematic) both;
      transition: border-color 280ms var(--ease-cinematic), transform 280ms var(--ease-cinematic), box-shadow 280ms var(--ease-cinematic);
      overflow: hidden;
    }
    .gh-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.045), transparent 55%);
      opacity: 0;
      transition: opacity 320ms var(--ease-cinematic);
      pointer-events: none;
    }
    .gh-card:hover {
      border-color: rgba(0, 229, 255, 0.22);
      transform: translateY(-2px);
      box-shadow: 0 16px 40px -22px rgba(0, 229, 255, 0.28), inset 0 0 0 1px rgba(0, 229, 255, 0.04);
    }
    .gh-card:hover::before { opacity: 1; }

    .gh-card-loading {
      animation: fadeIn 320ms var(--ease-cinematic);
    }

    /* ── Connect state aurora ──────────────────────── */
    .gh-card-connect { padding: 0; }
    .gh-card-aurora {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at 20% 0%, rgba(0, 229, 255, 0.16), transparent 55%),
        radial-gradient(ellipse at 100% 100%, rgba(124, 58, 237, 0.18), transparent 60%);
      opacity: 0.85;
      transition: opacity 480ms var(--ease-cinematic), transform 600ms var(--ease-cinematic);
      pointer-events: none;
    }
    .gh-card-connect:hover .gh-card-aurora {
      opacity: 1;
      transform: scale(1.04);
    }
    .gh-mark {
      width: 72px; height: 72px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 22px;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015));
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.95);
      transition: transform 420ms var(--ease-elastic), border-color 320ms var(--ease-cinematic);
    }
    .gh-card-connect:hover .gh-mark {
      transform: scale(1.08) rotate(-6deg);
      border-color: rgba(0, 229, 255, 0.32);
    }

    /* ── OAuth CTA ─────────────────────────────────── */
    .btn-oauth {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 0.85rem 1.6rem;
      border-radius: 12px;
      font-size: 0.86rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #fff;
      background: linear-gradient(135deg, #1a1a26 0%, #0d0d18 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      cursor: pointer;
      overflow: hidden;
      transition: transform 220ms var(--ease-cinematic), border-color 220ms var(--ease-cinematic), box-shadow 280ms var(--ease-cinematic);
    }
    .btn-oauth:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(0, 229, 255, 0.45);
      box-shadow: 0 18px 40px -18px rgba(0, 229, 255, 0.55), 0 0 0 1px rgba(0, 229, 255, 0.18) inset;
    }
    .btn-oauth:active:not(:disabled) { transform: translateY(0) scale(0.99); transition-duration: 80ms; }
    .btn-oauth:focus-visible { outline: none; box-shadow: var(--ring-cyan); }
    .btn-oauth:disabled { opacity: 0.6; cursor: not-allowed; }

    .btn-glow {
      position: absolute; inset: 0;
      background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.16) 50%, transparent 70%);
      transform: translateX(-100%);
      transition: transform 700ms var(--ease-cinematic);
      pointer-events: none;
    }
    .btn-oauth:hover:not(:disabled) .btn-glow,
    .btn-upgrade:hover:not(:disabled) .btn-glow { transform: translateX(100%); }

    .btn-spin {
      width: 14px; height: 14px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 700ms linear infinite;
    }
    .btn-spin-sm { width: 11px; height: 11px; border-width: 1.6px; }

    /* ── Connected state UI ────────────────────────── */
    .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
      animation: livePulse 2.2s var(--ease-cinematic) infinite;
    }
    .gh-avatar {
      width: 42px; height: 42px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      object-fit: cover;
      transition: transform 280ms var(--ease-elastic), border-color 240ms var(--ease-cinematic);
    }
    .gh-avatar-fallback {
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.015));
      color: rgba(255, 255, 255, 0.78);
    }
    .gh-card:hover .gh-avatar {
      transform: rotate(-4deg) scale(1.06);
      border-color: rgba(0, 229, 255, 0.32);
    }

    .repo-link {
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      margin-top: 0.18rem;
      font-size: 0.74rem;
      color: rgba(0, 229, 255, 0.85);
      text-decoration: none;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      max-width: 100%;
      transition: color 200ms var(--ease-cinematic), letter-spacing 220ms var(--ease-cinematic);
    }
    .repo-link:hover { color: rgba(0, 229, 255, 1); letter-spacing: 0.005em; }
    .repo-link:focus-visible { outline: none; box-shadow: var(--ring-cyan); border-radius: 6px; }

    .repo-pill {
      display: inline-block;
      padding: 0.12rem 0.55rem;
      margin: 0 0.18rem;
      border-radius: 7px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.14), rgba(124, 58, 237, 0.14));
      border: 1px solid rgba(0, 229, 255, 0.22);
      color: rgba(0, 229, 255, 0.95);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem;
    }

    /* ── Stats grid ────────────────────────────────── */
    .gh-stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.6rem;
    }
    @media (max-width: 720px) { .gh-stat-grid { grid-template-columns: 1fr; } }
    .gh-stat {
      display: flex; flex-direction: column; gap: 0.32rem;
      padding: 0.85rem 1rem;
      background: rgba(255, 255, 255, 0.018);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 11px;
      transition: border-color 240ms var(--ease-cinematic), transform 240ms var(--ease-cinematic), background 240ms var(--ease-cinematic);
    }
    .gh-stat:hover {
      border-color: rgba(0, 229, 255, 0.22);
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.028);
    }
    .gh-stat-label {
      font-size: 0.62rem; font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255, 255, 255, 0.42);
    }
    .gh-stat-value {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
    }
    .gh-stat-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.82rem; }

    /* ── Pill / upgrade buttons ────────────────────── */
    .btn-upgrade {
      position: relative;
      display: inline-flex; align-items: center;
      padding: 0.6rem 1.1rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #000;
      background: linear-gradient(135deg, #00E5FF 0%, #7C3AED 100%);
      border: none;
      cursor: pointer;
      overflow: hidden;
      transition: transform 220ms var(--ease-cinematic), box-shadow 240ms var(--ease-cinematic), filter 240ms var(--ease-cinematic);
    }
    .btn-upgrade:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 14px 36px -16px rgba(0, 229, 255, 0.65);
      filter: brightness(1.06);
    }
    .btn-upgrade:active:not(:disabled) { transform: translateY(0) scale(0.98); transition-duration: 80ms; }
    .btn-upgrade:focus-visible { outline: none; box-shadow: var(--ring-cyan); }
    .btn-upgrade:disabled { opacity: 0.55; cursor: not-allowed; }

    .pill-btn {
      display: inline-flex; align-items: center; gap: 0.42rem;
      padding: 0.5rem 0.95rem;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.85);
      text-decoration: none;
      cursor: pointer;
      transition: border-color 200ms var(--ease-cinematic), background 200ms var(--ease-cinematic), transform 200ms var(--ease-cinematic), color 200ms var(--ease-cinematic);
    }
    .pill-btn:hover {
      border-color: rgba(0, 229, 255, 0.3);
      background: rgba(0, 229, 255, 0.06);
      color: #fff;
      transform: translateY(-1px);
    }
    .pill-btn:active { transform: translateY(0) scale(0.97); transition-duration: 80ms; }
    .pill-btn:focus-visible { outline: none; box-shadow: var(--ring-cyan); }
    .pill-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .pill-btn-ghost { /* default style above */ }

    .pill-btn-danger {
      background: rgba(248, 113, 113, 0.08);
      border-color: rgba(248, 113, 113, 0.22);
      color: rgba(252, 165, 165, 1);
    }
    .pill-btn-danger:hover {
      border-color: rgba(248, 113, 113, 0.45);
      background: rgba(248, 113, 113, 0.14);
      color: rgba(254, 202, 202, 1);
      box-shadow: 0 10px 24px -14px rgba(248, 113, 113, 0.45);
    }
    .pill-btn-danger:focus-visible { box-shadow: var(--ring-danger); }

    /* ── Bullet list + scope chip ──────────────────── */
    .gh-bullets {
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      max-width: 480px;
    }
    .gh-bullets li {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.72);
      text-align: left;
      animation: slideIn 480ms var(--ease-cinematic) backwards;
    }
    .gh-bullets li:nth-child(1) { animation-delay: 60ms; }
    .gh-bullets li:nth-child(2) { animation-delay: 140ms; }
    .gh-bullets li:nth-child(3) { animation-delay: 220ms; }
    .bullet-dot {
      width: 5px; height: 5px;
      border-radius: 50%;
      background: rgba(0, 229, 255, 0.85);
      margin-top: 0.5rem;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.12);
    }
    .scope-chip {
      display: inline-block;
      padding: 0.04rem 0.42rem;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem;
      color: rgba(255, 255, 255, 0.92);
    }

    /* ── Steps list ────────────────────────────────── */
    .gh-steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      counter-reset: step;
    }
    .gh-steps li {
      display: flex;
      gap: 0.85rem;
      padding: 0.75rem 0.9rem;
      background: rgba(255, 255, 255, 0.012);
      border: 1px solid transparent;
      border-radius: 11px;
      animation: slideIn 460ms var(--ease-cinematic) backwards;
      transition: background 220ms var(--ease-cinematic), border-color 220ms var(--ease-cinematic), transform 220ms var(--ease-cinematic);
    }
    .gh-steps li:nth-child(1) { animation-delay: 40ms; }
    .gh-steps li:nth-child(2) { animation-delay: 100ms; }
    .gh-steps li:nth-child(3) { animation-delay: 160ms; }
    .gh-steps li:hover {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(0, 229, 255, 0.18);
      transform: translateX(3px);
    }
    .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px; height: 26px;
      border-radius: 9px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.18), rgba(124, 58, 237, 0.18));
      color: rgba(0, 229, 255, 0.95);
      font-size: 0.78rem;
      font-weight: 700;
      flex-shrink: 0;
      transition: transform 280ms var(--ease-elastic);
    }
    .gh-steps li:hover .step-num { transform: rotate(-6deg) scale(1.08); }
    .step-body { display: flex; flex-direction: column; gap: 0.18rem; }
    .step-title { font-size: 0.82rem; font-weight: 600; color: #fff; }
    .step-desc { font-size: 0.74rem; color: rgba(255, 255, 255, 0.62); line-height: 1.55; }

    /* ── Loading spinner ───────────────────────────── */
    .orbit-spinner {
      position: relative;
      width: 40px; height: 40px;
    }
    .orbit {
      position: absolute; inset: 0;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgba(0, 229, 255, 0.9);
      animation: spin 1.2s var(--ease-cinematic) infinite;
    }
    .orbit-2 {
      inset: 5px;
      border-top-color: transparent;
      border-right-color: rgba(124, 58, 237, 0.75);
      animation-duration: 1.6s;
      animation-direction: reverse;
    }
    .orbit-3 {
      inset: 10px;
      border-top-color: transparent;
      border-bottom-color: rgba(0, 229, 255, 0.5);
      animation-duration: 2s;
    }

    /* ── Keyframes ─────────────────────────────────── */
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes livePulse {
      0%   { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
      70%  { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
      100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
    }
    @keyframes pulseGlyph {
      0%, 100% { box-shadow: 0 16px 48px -24px rgba(0, 229, 255, 0.3), 0 0 0 1px rgba(0, 229, 255, 0.05) inset; }
      50%      { box-shadow: 0 20px 64px -24px rgba(0, 229, 255, 0.45), 0 0 0 1px rgba(0, 229, 255, 0.12) inset; }
    }

    @media (prefers-reduced-motion: reduce) {
      .gh-header, .gh-card, .gh-bullets li, .gh-steps li, .empty-card, .empty-glyph,
      .btn-glow, .status-dot, .gh-card-loading {
        animation: none !important;
      }
      .gh-card, .gh-stat, .gh-avatar, .gh-mark, .gh-card-aurora, .gh-header-glyph,
      .repo-link, .btn-oauth, .btn-upgrade, .pill-btn, .step-num {
        transition-duration: 0ms;
      }
      .gh-card:hover, .gh-stat:hover, .gh-steps li:hover, .btn-oauth:hover:not(:disabled),
      .btn-upgrade:hover:not(:disabled), .pill-btn:hover {
        transform: none;
      }
      .orbit { animation-duration: 3s; }
    }
  `],
})
export class AdminGithubBackupComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  loading = signal(true);
  connecting = signal(false);
  backingUp = signal(false);
  disconnecting = signal(false);
  status = signal<GithubBackupStatus | null>(null);

  private statusSub?: Subscription;

  ngOnInit(): void {
    this.fetchStatus();
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
  }

  derivedRepoName(): string {
    const slug = this.state.selectedSite()?.slug ?? 'site';
    return `${slug.replace(/\./g, '-')}-projectsites-dev`;
  }

  buildVersionLabel(): string {
    return String(this.state.selectedSite()?.current_build_version ?? 1);
  }

  repoUrl(): string {
    const s = this.status();
    if (s?.html_url) return s.html_url;
    if (s?.owner && s?.repo) return `https://github.com/${s.owner}/${s.repo}`;
    return 'https://github.com';
  }

  commitUrl(): string {
    const s = this.status();
    if (!s?.last_commit_sha || !s.owner || !s.repo) return this.repoUrl();
    return `https://github.com/${s.owner}/${s.repo}/commit/${s.last_commit_sha}`;
  }

  shortSha(): string {
    const sha = this.status()?.last_commit_sha;
    return sha ? sha.slice(0, 7) : '—';
  }

  private fetchStatus(): void {
    const site = this.state.selectedSite();
    if (!site) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.statusSub = this.api.getGithubBackupStatus(site.id).subscribe({
      next: (res) => {
        this.status.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.status.set({ connected: false });
        this.loading.set(false);
      },
    });
  }

  startOAuth(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.connecting.set(true);
    const returnUrl = `${window.location.origin}/admin/github`;
    this.api.startGithubOAuth(site.id, returnUrl).subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: (err: unknown) => {
        this.connecting.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        const message = e?.error?.error?.message || e?.error?.message || 'Unable to start GitHub OAuth';
        this.toast.error(message);
      },
    });
  }

  backupNow(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.backingUp.set(true);
    this.api.triggerGithubBackup(site.id).subscribe({
      next: (res) => {
        this.backingUp.set(false);
        this.toast.success(`Pushed commit ${res.data.commit_sha.slice(0, 7)} to GitHub`);
        this.fetchStatus();
      },
      error: (err: unknown) => {
        this.backingUp.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        const message = e?.error?.error?.message || e?.error?.message || 'Backup failed';
        this.toast.error(message);
      },
    });
  }

  disconnect(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.disconnecting.set(true);
    this.api.disconnectGithub(site.id).subscribe({
      next: () => {
        this.disconnecting.set(false);
        this.toast.success('Disconnected from GitHub');
        this.status.set({ connected: false });
      },
      error: (err: unknown) => {
        this.disconnecting.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        const message = e?.error?.error?.message || e?.error?.message || 'Disconnect failed';
        this.toast.error(message);
      },
    });
  }
}
