import { Component, inject, signal, type OnInit, type OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../admin-state.service';
import { ApiService, type LogEntry } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-5 flex-1 overflow-y-auto animate-fade-in">
      <div class="flex items-center justify-between mb-3 gap-2">
        <span class="text-[0.72rem] text-text-secondary">{{ logs().length }} log {{ logs().length === 1 ? 'entry' : 'entries' }}</span>
        <div class="flex items-center gap-1">
          <button class="icon-btn-sm" (click)="copyLogsForAI()" title="Copy logs for AI">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn-sm" (click)="refreshLogs()" title="Refresh logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>
      @if (loadingLogs()) {
        <div class="flex flex-col items-center justify-center gap-3 py-[60px] text-text-secondary text-[0.85rem]"><div class="loading-spinner"></div><span>Loading logs...</span></div>
      } @else if (logs().length === 0) {
        <div class="flex flex-col items-center justify-center text-center py-10 px-5 text-text-secondary"><p class="m-0">No logs yet for this site.</p></div>
      } @else {
        <div class="bg-[rgba(6,6,18,0.85)] border border-primary/[0.06] rounded-xl overflow-y-auto overflow-x-hidden max-h-[calc(100vh-200px)] font-mono text-[0.72rem] leading-relaxed sidebar-scrollbar">
          @for (log of logs(); track log.id) {
            <div class="grid grid-cols-[3px_28px_1fr] border-b border-white/[0.025] items-stretch transition-colors hover:bg-primary/[0.025] last:border-b-0" [ngClass]="getLogColorClass(log.action)">
              <div class="log-edge rounded-l"></div>
              <div class="flex items-center justify-center py-2 px-0.5 opacity-70" [innerHTML]="getLogIcon(log.action)"></div>
              <div class="py-[7px] pr-3 pl-1.5 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-semibold text-[0.72rem] whitespace-nowrap log-action">{{ formatLogAction(log.action) }}</span>
                  <span class="text-text-secondary/50 text-[0.62rem] whitespace-nowrap ml-auto">{{ formatLogTimestamp(log.created_at) }}</span>
                </div>
                @if (log.metadata_json) {
                  <div class="text-text-secondary/[0.55] text-[0.65rem] mt-0.5 break-words leading-snug log-meta-html" [innerHTML]="formatLogMeta(log.metadata_json, log.action)"></div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
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

  formatLogMeta(metaJson: string, action?: string): string {
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
