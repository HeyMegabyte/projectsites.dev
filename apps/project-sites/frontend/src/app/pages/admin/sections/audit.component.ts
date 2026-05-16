import { Component, inject, signal, type OnInit, type OnDestroy } from '@angular/core';
import { NgClass } from '@angular/common';
import { AdminStateService } from '../admin-state.service';
import { ApiService, type LogEntry } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [NgClass],
  template: `
    <div class="p-5 flex-1 overflow-y-auto animate-fade-in">
      <div class="audit-header flex items-center justify-between mb-3 gap-2">
        <span class="text-[0.72rem] text-text-secondary inline-flex items-center gap-1.5">
          <span class="pulse-dot" aria-hidden="true"></span>
          {{ logs().length }} log {{ logs().length === 1 ? 'entry' : 'entries' }}
        </span>
        <div class="flex items-center gap-1">
          <button class="icon-btn-sm" (click)="copyLogsForAI()" title="Copy logs for AI" aria-label="Copy logs for AI">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn-sm" (click)="refreshLogs()" title="Refresh logs" aria-label="Refresh logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>
      @if (loadingLogs()) {
        <div class="flex flex-col items-center justify-center gap-3 py-[60px] text-text-secondary text-[0.85rem]">
          <div class="audit-spinner" aria-hidden="true"></div>
          <span>Loading logs<span class="dots-ellipsis"></span></span>
        </div>
      } @else if (logs().length === 0) {
        <div class="audit-empty flex flex-col items-center justify-center text-center py-10 px-5 text-text-secondary gap-3">
          <div class="empty-glyph" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
          </div>
          <p class="m-0 text-[0.85rem]">No logs yet for this site.</p>
          <p class="m-0 text-[0.72rem] text-text-secondary/50">Actions will appear here as they happen.</p>
        </div>
      } @else {
        <div class="log-stream sidebar-scrollbar">
          @for (log of logs(); track log.id; let i = $index) {
            <div class="log-row" [ngClass]="getLogColorClass(log.action)" [style.animation-delay.ms]="i * 18">
              <div class="log-edge" aria-hidden="true"></div>
              <div class="log-icon" [innerHTML]="getLogIcon(log.action)" aria-hidden="true"></div>
              <div class="log-body">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="log-action">{{ formatLogAction(log.action) }}</span>
                  <span class="log-time">{{ formatLogTimestamp(log.created_at) }}</span>
                </div>
                @if (log.metadata_json) {
                  <div class="log-meta" [innerHTML]="formatLogMeta(log.metadata_json, log.action)"></div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ring-cyan: 0 0 0 2px #000, 0 0 0 4px rgba(0, 229, 255, 0.55);
      display: block;
    }

    .audit-header {
      animation: fadeUp 420ms var(--ease-cinematic);
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: rgba(0,229,255,0.85);
      box-shadow: 0 0 8px rgba(0,229,255,0.7);
      animation: pulseDot 1.8s ease-in-out infinite;
    }

    .audit-spinner {
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      border: 2px solid rgba(0,229,255,0.18);
      border-top-color: #00E5FF;
      animation: spin 0.9s linear infinite;
    }

    .audit-empty {
      animation: fadeUp 540ms var(--ease-cinematic);
    }

    .empty-glyph {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(0,229,255,0.08), rgba(124,58,237,0.05));
      border: 1px solid rgba(0,229,255,0.12);
      color: rgba(0,229,255,0.6);
      animation: pulseGlyph 3.6s var(--ease-cinematic) infinite;
    }

    .log-stream {
      background: rgba(6,6,18,0.85);
      border: 1px solid rgba(0,229,255,0.06);
      border-radius: 12px;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: calc(100vh - 200px);
      font-family: ui-monospace, 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      line-height: 1.55;
      animation: fadeUp 480ms var(--ease-cinematic);
    }

    .log-row {
      display: grid;
      grid-template-columns: 3px 28px 1fr;
      border-bottom: 1px solid rgba(255,255,255,0.025);
      align-items: stretch;
      animation: slideIn 360ms var(--ease-cinematic) both;
      transition: background 220ms var(--ease-cinematic), transform 220ms var(--ease-cinematic);
      position: relative;
    }
    .log-row:last-child { border-bottom: 0; }
    .log-row:hover {
      background: rgba(0,229,255,0.025);
      transform: translateX(2px);
    }
    .log-row::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, currentColor 0%, transparent 12%);
      opacity: 0;
      transition: opacity 220ms var(--ease-cinematic);
      pointer-events: none;
    }
    .log-row:hover::before { opacity: 0.05; }

    .log-edge {
      border-radius: 4px 0 0 4px;
      background: currentColor;
    }

    .log-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 0.125rem;
      opacity: 0.7;
      color: currentColor;
      transition: transform 280ms var(--ease-elastic), opacity 220ms var(--ease-cinematic);
    }
    .log-row:hover .log-icon {
      opacity: 1;
      transform: scale(1.15) rotate(-4deg);
    }

    .log-body {
      padding: 7px 12px 7px 6px;
      min-width: 0;
    }

    .log-action {
      font-weight: 600;
      font-size: 0.72rem;
      white-space: nowrap;
      color: #fff;
      transition: color 220ms var(--ease-cinematic);
    }
    .log-row:hover .log-action { color: currentColor; }

    .log-time {
      color: rgba(255,255,255,0.45);
      font-size: 0.62rem;
      white-space: nowrap;
      margin-left: auto;
      font-variant-numeric: tabular-nums;
    }

    .log-meta {
      color: rgba(255,255,255,0.55);
      font-size: 0.65rem;
      margin-top: 0.125rem;
      word-break: break-word;
      line-height: 1.4;
    }

    :host ::ng-deep .icon-btn-sm {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      color: rgba(255,255,255,0.65);
      cursor: pointer;
      transition: all 220ms var(--ease-cinematic);
    }
    :host ::ng-deep .icon-btn-sm:hover {
      color: #00E5FF;
      background: rgba(0,229,255,0.08);
      border-color: rgba(0,229,255,0.32);
      transform: translateY(-1px);
      box-shadow: 0 6px 18px -8px rgba(0,229,255,0.5);
    }
    :host ::ng-deep .icon-btn-sm:hover svg {
      transform: rotate(-8deg) scale(1.10);
    }
    :host ::ng-deep .icon-btn-sm:active { transform: scale(0.92); }
    :host ::ng-deep .icon-btn-sm:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
    }
    :host ::ng-deep .icon-btn-sm svg {
      transition: transform 320ms var(--ease-elastic);
    }

    .log-c-green { color: #4ade80; }
    .log-c-red { color: #f87171; }
    .log-c-amber { color: #fbbf24; }
    .log-c-purple { color: #c084fc; }
    .log-c-cyan { color: #00E5FF; }
    .log-c-blue { color: #60a5fa; }
    .log-c-muted { color: rgba(255,255,255,0.4); }

    .dots-ellipsis::after {
      content: '';
      display: inline-block;
      width: 1.5ch;
      text-align: left;
      animation: dotsBlink 1.4s steps(4) infinite;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-6px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulseDot {
      0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(0,229,255,0.7); }
      50% { transform: scale(1.3); box-shadow: 0 0 14px rgba(0,229,255,0.9); }
    }
    @keyframes pulseGlyph {
      0%, 100% {
        box-shadow: 0 12px 36px -16px rgba(0,229,255,0.25);
        border-color: rgba(0,229,255,0.12);
      }
      50% {
        box-shadow: 0 16px 44px -16px rgba(0,229,255,0.40);
        border-color: rgba(0,229,255,0.22);
      }
    }
    @keyframes dotsBlink {
      0%, 20% { content: ''; }
      40% { content: '.'; }
      60% { content: '..'; }
      80%, 100% { content: '...'; }
    }

    @media (prefers-reduced-motion: reduce) {
      .audit-header, .audit-empty, .log-stream, .log-row {
        animation: none !important;
      }
      .log-row:hover { transform: none; }
      .log-row:hover .log-icon { transform: none; }
      :host ::ng-deep .icon-btn-sm:hover { transform: none; }
      :host ::ng-deep .icon-btn-sm:hover svg { transform: none; }
      .pulse-dot, .empty-glyph, .audit-spinner { animation: none; }
    }
  `],
})
export class AdminAuditComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  logs = signal<LogEntry[]>([]);
  loadingLogs = signal(false);
  private logsInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    const site = this.state.selectedSite();
    if (site) {
      this.loadLogs(site.id);
      this.logsInterval = setInterval(() => {
        const s = this.state.selectedSite();
        if (s) this.loadLogs(s.id);
      }, 5000);
    }
  }

  ngOnDestroy(): void {
    if (this.logsInterval) clearInterval(this.logsInterval);
  }

  refreshLogs(): void {
    const site = this.state.selectedSite();
    if (site) this.loadLogs(site.id);
  }

  private loadLogs(siteId: string): void {
    if (this.logs().length === 0) this.loadingLogs.set(true);
    this.api.getSiteLogs(siteId).subscribe({
      next: (res) => { this.logs.set(res.data || []); this.loadingLogs.set(false); },
      error: () => { this.loadingLogs.set(false); this.toast.error('Failed to load logs'); },
    });
  }

  formatLogAction(action: string): string {
    const map: Record<string, string> = {
      'site.created': 'Site Created', 'site.created_from_search': 'Site Created',
      'site.deleted': 'Site Deleted', 'site.updated': 'Site Updated', 'site.reset': 'Site Reset',
      'site.deployed': 'Site Deployed', 'site.deploy_started': 'Deploy Started',
      'site.slug_changed': 'URL Changed', 'site.name_changed': 'Name Changed',
      'site.published_from_bolt': 'Published from Bolt', 'site.cache_invalidated': 'Cache Cleared',
      'hostname.provisioned': 'Domain Added', 'hostname.verified': 'Domain Verified',
      'hostname.deprovisioned': 'Domain Removed', 'hostname.deleted': 'Domain Deleted',
      'hostname.set_primary': 'Primary Domain Set',
      'workflow.queued': 'Build Queued', 'workflow.started': 'Build Started',
      'workflow.completed': 'Build Completed', 'workflow.failed': 'Build Failed',
      'auth.magic_link_requested': 'Sign-In Link Sent', 'auth.magic_link_verified': 'Signed In (Email)',
      'auth.google_oauth_verified': 'Signed In (Google)',
      'billing.checkout_created': 'Checkout Started', 'billing.subscription_active': 'Subscription Active',
    };
    return map[action] || action.replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  getLogColorClass(action: string): string {
    if (/created|verified|completed|published|complete|active/.test(action)) return 'log-c-green';
    if (/deleted|failed|error|canceled/.test(action)) return 'log-c-red';
    if (/reset|queued|warning|migration/.test(action)) return 'log-c-amber';
    if (/generation|deployed|upload|checkout|billing/.test(action)) return 'log-c-purple';
    if (/research|auth|hostname|dns|domain/.test(action)) return 'log-c-cyan';
    if (/updated|changed|renamed|cache|file/.test(action)) return 'log-c-blue';
    return 'log-c-muted';
  }

  getLogIcon(action: string): string {
    const s = 'width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    if (action.includes('created')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    if (action.includes('deleted')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    if (action.includes('deploy') || action.includes('upload')) return `<svg ${s}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    if (action.includes('auth')) return `<svg ${s}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    if (action.includes('hostname') || action.includes('domain')) return `<svg ${s}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    if (action.includes('billing') || action.includes('checkout')) return `<svg ${s}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
    if (action.includes('workflow') || action.includes('step')) return `<svg ${s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    return `<svg ${s}><circle cx="12" cy="12" r="3"/></svg>`;
  }

  formatLogTimestamp(iso: string): string {
    try {
      let normalized = iso;
      if (iso && !iso.includes('T') && !iso.includes('Z')) normalized = iso.replace(' ', 'T') + 'Z';
      else if (iso && !iso.includes('Z') && !iso.includes('+')) normalized = iso + 'Z';
      const d = new Date(normalized);
      const secs = Math.floor((Date.now() - d.getTime()) / 1000);
      if (isNaN(secs) || secs < 0) return iso;
      if (secs < 10) return 'just now';
      if (secs < 60) return `${secs}s ago`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs} hr ago`;
      const days = Math.floor(hrs / 24);
      return `${days} days ago`;
    } catch { return iso; }
  }

  formatLogMeta(metaJson: string, _action?: string): string {
    if (!metaJson) return '';
    let m: Record<string, unknown>;
    try { m = typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson; } catch { return ''; }
    const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts: string[] = [];
    if (m['message']) { let msg = String(m['message']); if (msg.length > 140) msg = msg.slice(0, 140) + '...'; parts.push(e(msg)); }
    if (m['error'] && !m['message']) { let err = String(m['error']); if (err.length > 100) err = err.slice(0, 100) + '...'; parts.push(`<span style="color:var(--error)">${e(err)}</span>`); }
    return parts.join(' &middot; ');
  }

  copyLogsForAI(): void {
    const logs = this.logs();
    if (!logs.length) { this.toast.info('No logs to copy'); return; }
    const site = this.state.selectedSite();
    const lines: string[] = [`# Site Logs: ${site?.business_name || 'unknown'}`, `Total: ${logs.length}`, ''];
    logs.forEach((log, i) => {
      lines.push(`${i + 1}. [${log.created_at}] ${this.formatLogAction(log.action)}`);
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      this.toast.success(`Logs copied (${logs.length} entries)`);
    });
  }
}
