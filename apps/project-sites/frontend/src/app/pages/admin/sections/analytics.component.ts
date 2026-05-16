import { Component, inject, computed } from '@angular/core';
import { AdminStateService } from '../admin-state.service';

const SOURCE_COLORS = ['#00E5FF', '#22c55e', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="analytics-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="text-lg font-bold text-white m-0 flex items-center gap-2">
            <span class="header-glyph" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
            </span>
            Analytics
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            @if (ga4Connected()) {
              Live data from Google Analytics 4
              <span class="inline-flex items-center gap-1 ml-1.5 text-green-400 text-[0.68rem]">
                <span class="live-dot" aria-hidden="true"></span>
                Connected
              </span>
            } @else {
              Monitor your site traffic and visitor behavior.
            }
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select
            class="period-select"
            [value]="state.analyticsPeriod()"
            (change)="onPeriodChange($event)"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button
            class="refresh-btn"
            (click)="state.loadAnalytics()"
            [disabled]="state.analyticsLoading()"
            [attr.aria-busy]="state.analyticsLoading() ? 'true' : null"
          >
            @if (state.analyticsLoading()) {
              <span class="refresh-spinner" aria-hidden="true"></span>
              <span>Refreshing</span>
            } @else {
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
              <span>Refresh</span>
            }
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
        @for (stat of statsCards(); track stat.label; let i = $index) {
          <div class="stat-card" [style.animation-delay.ms]="i * 70">
            <span class="stat-label">{{ stat.label }}</span>
            <span class="stat-value">{{ stat.value }}</span>
            <span class="stat-foot">last {{ state.analyticsPeriod() }} days</span>
          </div>
        }
      </div>

      <!-- Chart Area -->
      <div class="analytics-card">
        <div class="flex items-center justify-between mb-5">
          <h3 class="card-title">Page Views</h3>
        </div>
        @if (chartBars().length > 0) {
          <div class="flex items-end gap-[3px] h-[140px] px-2">
            @for (bar of chartBars(); track $index; let bi = $index) {
              <div
                class="chart-bar"
                [style.height.%]="bar.height"
                [style.animation-delay.ms]="bi * 18"
                [attr.title]="bar.label + ': ' + bar.views + ' views'"
              ></div>
            }
          </div>
          <div class="flex justify-between mt-2 px-2">
            @for (bar of chartBars(); track $index) {
              @if ($index % labelSkip() === 0) {
                <span class="text-[0.6rem] text-text-secondary/50">{{ bar.label }}</span>
              }
            }
          </div>
        } @else {
          <div class="flex items-center justify-center h-[140px] text-text-secondary/40 text-sm">
            @if (state.analyticsLoading()) {
              <span class="empty-loading">Loading chart data<span class="dots"></span></span>
            } @else {
              No data yet — traffic will appear here once visitors arrive.
            }
          </div>
        }
      </div>

      <!-- Bottom Grid -->
      <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">

        <!-- Traffic Sources -->
        <div class="analytics-card">
          <h3 class="card-title mb-4">Traffic Sources</h3>
          @if (trafficSources().length > 0) {
            <div class="flex flex-col gap-2.5">
              @for (source of trafficSources(); track source.name; let i = $index) {
                <div class="source-row" [style.animation-delay.ms]="i * 60">
                  <span class="source-name">{{ source.name }}</span>
                  <div class="source-track">
                    <div
                      class="source-fill"
                      [style.width.%]="source.percent"
                      [style.background]="sourceColor(i)"
                      [style.box-shadow]="'0 0 12px ' + sourceColor(i) + '55'"
                    ></div>
                  </div>
                  <span class="source-percent">{{ source.percent }}%</span>
                </div>
              }
            </div>
          } @else {
            <p class="text-text-secondary/40 text-sm">No traffic data yet.</p>
          }
        </div>

        <!-- Top Pages -->
        <div class="analytics-card">
          <h3 class="card-title mb-4">Top Pages</h3>
          @if (topPages().length > 0) {
            <div class="flex flex-col gap-0">
              @for (page of topPages(); track page.path; let i = $index) {
                <div class="page-row" [style.animation-delay.ms]="i * 60">
                  <span class="page-path">{{ page.path }}</span>
                  <span class="page-views">{{ page.views }} views</span>
                </div>
              }
            </div>
          } @else {
            <p class="text-text-secondary/40 text-sm">No page data yet.</p>
          }
        </div>
      </div>

      <!-- GA4 Connection Status -->
      <div
        class="ga4-status"
        [class.ga4-status-connected]="ga4Connected()"
      >
        <div class="ga4-icon" [class.ga4-icon-connected]="ga4Connected()">
          @if (ga4Connected()) {
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          } @else {
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
          }
        </div>
        <div class="flex-1 min-w-0">
          @if (ga4Connected()) {
            <h4 class="text-white text-[0.9rem] font-semibold m-0 mb-1">Google Analytics Connected</h4>
            <p class="text-[0.78rem] text-text-secondary m-0">
              GA4: {{ measurementId() }}
              @if (gtmId()) {
                &middot; GTM: {{ gtmId() }}
              }
              &middot; Data refreshes every 60 seconds.
            </p>
          } @else {
            <h4 class="text-white text-[0.9rem] font-semibold m-0 mb-1">Google Analytics</h4>
            <p class="text-[0.78rem] text-text-secondary m-0">
              GA4 is automatically injected into your site. Once configured by the admin, live data will appear here.
            </p>
          }
        </div>
      </div>

    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ring-cyan: 0 0 0 2px #000, 0 0 0 4px rgba(0, 229, 255, 0.55);
      display: block;
    }

    .analytics-header {
      animation: fadeUp 480ms var(--ease-cinematic);
    }

    .header-glyph {
      display: inline-flex;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(0,229,255,0.10), rgba(124,58,237,0.08));
      color: rgba(0,229,255,0.85);
      border: 1px solid rgba(0,229,255,0.16);
      transition: transform 320ms var(--ease-elastic), color 240ms var(--ease-cinematic), box-shadow 240ms var(--ease-cinematic);
    }
    .analytics-header:hover .header-glyph {
      transform: rotate(-8deg) scale(1.10);
      color: #00E5FF;
      box-shadow: 0 8px 24px -10px rgba(0,229,255,0.45);
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,0.7);
      animation: livePulse 1.8s ease-in-out infinite;
    }

    .period-select {
      appearance: none;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 0.4rem 0.75rem;
      font-size: 0.75rem;
      color: #fff;
      font-family: inherit;
      outline: none;
      cursor: pointer;
      transition: border-color 200ms var(--ease-cinematic), background 200ms var(--ease-cinematic), box-shadow 200ms var(--ease-cinematic);
    }
    .period-select:hover {
      border-color: rgba(0,229,255,0.32);
      background: rgba(0,229,255,0.05);
    }
    .period-select:focus-visible {
      border-color: rgba(0,229,255,0.55);
      box-shadow: var(--ring-cyan);
    }

    .refresh-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      font-size: 0.72rem;
      font-weight: 600;
      color: rgba(0,229,255,0.75);
      background: rgba(0,229,255,0.04);
      border: 1px solid rgba(0,229,255,0.12);
      border-radius: 8px;
      cursor: pointer;
      transition: all 220ms var(--ease-cinematic);
    }
    .refresh-btn:hover:not(:disabled) {
      color: #00E5FF;
      background: rgba(0,229,255,0.09);
      border-color: rgba(0,229,255,0.32);
      transform: translateY(-1px);
      box-shadow: 0 6px 18px -8px rgba(0,229,255,0.5);
    }
    .refresh-btn:hover:not(:disabled) svg {
      transform: rotate(180deg);
    }
    .refresh-btn:active:not(:disabled) {
      transform: scale(0.96);
    }
    .refresh-btn:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
    }
    .refresh-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .refresh-btn svg {
      transition: transform 480ms var(--ease-cinematic);
    }

    .refresh-spinner {
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      border: 2px solid rgba(0,229,255,0.25);
      border-top-color: #00E5FF;
      animation: spin 0.9s linear infinite;
    }

    .stat-card {
      position: relative;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      overflow: hidden;
      animation: fadeUp 520ms var(--ease-cinematic) both;
      transition: transform 260ms var(--ease-cinematic), border-color 260ms var(--ease-cinematic), box-shadow 260ms var(--ease-cinematic);
    }
    .stat-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(0,229,255,0.05), transparent 60%);
      opacity: 0;
      transition: opacity 260ms var(--ease-cinematic);
      pointer-events: none;
    }
    .stat-card::after {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(180deg, #00E5FF, #7C3AED);
      transform: scaleY(0);
      transform-origin: top;
      transition: transform 320ms var(--ease-cinematic);
    }
    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(0,229,255,0.20);
      box-shadow: 0 14px 36px -16px rgba(0,229,255,0.35);
    }
    .stat-card:hover::before { opacity: 1; }
    .stat-card:hover::after { transform: scaleY(1); }
    .stat-card:focus-within {
      outline: none;
      box-shadow: var(--ring-cyan);
    }

    .stat-label {
      font-size: 0.68rem;
      color: var(--text-secondary, rgba(255,255,255,0.6));
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      position: relative;
      z-index: 1;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
      position: relative;
      z-index: 1;
      transition: color 240ms var(--ease-cinematic);
    }
    .stat-card:hover .stat-value { color: #00E5FF; }
    .stat-foot {
      font-size: 0.68rem;
      color: rgba(255,255,255,0.42);
      position: relative;
      z-index: 1;
    }

    .analytics-card {
      position: relative;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 1.5rem;
      overflow: hidden;
      animation: fadeUp 520ms var(--ease-cinematic);
      transition: border-color 260ms var(--ease-cinematic), box-shadow 260ms var(--ease-cinematic);
    }
    .analytics-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at top right, rgba(0,229,255,0.06), transparent 65%);
      opacity: 0;
      transition: opacity 320ms var(--ease-cinematic);
      pointer-events: none;
    }
    .analytics-card:hover {
      border-color: rgba(0,229,255,0.16);
      box-shadow: 0 16px 40px -20px rgba(0,229,255,0.30);
    }
    .analytics-card:hover::before { opacity: 1; }

    .card-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: #fff;
      margin: 0;
      position: relative;
      z-index: 1;
    }

    .chart-bar {
      flex: 1;
      min-height: 2px;
      border-radius: 3px 3px 0 0;
      background: linear-gradient(to top, rgba(0,229,255,0.18), rgba(0,229,255,0.55));
      transform-origin: bottom;
      animation: barRise 600ms var(--ease-cinematic) both;
      transition: filter 220ms var(--ease-cinematic), transform 220ms var(--ease-cinematic), box-shadow 220ms var(--ease-cinematic);
      cursor: pointer;
    }
    .chart-bar:hover {
      filter: brightness(1.35) saturate(1.2);
      transform: scaleY(1.04);
      box-shadow: 0 0 16px rgba(0,229,255,0.55);
    }

    .empty-loading {
      display: inline-flex;
      align-items: center;
    }
    .dots::after {
      content: '...';
      display: inline-block;
      animation: dotsBlink 1.4s steps(4) infinite;
      width: 1.5ch;
      text-align: left;
    }

    .source-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.25rem 0;
      animation: fadeUp 480ms var(--ease-cinematic) both;
      transition: transform 220ms var(--ease-cinematic);
    }
    .source-row:hover { transform: translateX(2px); }
    .source-name {
      font-size: 0.78rem;
      color: #fff;
      width: 5rem;
      flex-shrink: 0;
      transition: color 220ms var(--ease-cinematic);
    }
    .source-row:hover .source-name { color: #00E5FF; }
    .source-track {
      flex: 1;
      height: 8px;
      background: rgba(255,255,255,0.04);
      border-radius: 9999px;
      overflow: hidden;
    }
    .source-fill {
      height: 100%;
      border-radius: 9999px;
      transform-origin: left;
      animation: fillIn 700ms var(--ease-cinematic) both;
      transition: filter 220ms var(--ease-cinematic);
    }
    .source-row:hover .source-fill { filter: brightness(1.2); }
    .source-percent {
      font-size: 0.72rem;
      color: var(--text-secondary, rgba(255,255,255,0.6));
      width: 2.5rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .page-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0.5rem;
      margin: 0 -0.5rem;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      animation: fadeUp 480ms var(--ease-cinematic) both;
      border-radius: 8px;
      transition: background 200ms var(--ease-cinematic), transform 200ms var(--ease-cinematic), border-color 200ms var(--ease-cinematic);
    }
    .page-row:last-child { border-bottom: 0; }
    .page-row:hover {
      background: rgba(0,229,255,0.04);
      transform: translateX(3px);
      border-bottom-color: rgba(0,229,255,0.12);
    }
    .page-path {
      font-size: 0.78rem;
      color: rgba(0,229,255,0.85);
      font-family: ui-monospace, 'JetBrains Mono', monospace;
      transition: color 220ms var(--ease-cinematic);
    }
    .page-row:hover .page-path { color: #00E5FF; }
    .page-views {
      font-size: 0.72rem;
      color: var(--text-secondary, rgba(255,255,255,0.6));
      font-variant-numeric: tabular-nums;
    }

    .ga4-status {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem;
      border-radius: 14px;
      background: rgba(0,229,255,0.03);
      border: 1px solid rgba(0,229,255,0.08);
      animation: fadeUp 560ms var(--ease-cinematic);
      transition: border-color 260ms var(--ease-cinematic), box-shadow 260ms var(--ease-cinematic);
      overflow: hidden;
    }
    .ga4-status::before {
      content: '';
      position: absolute;
      inset: -1px;
      background: linear-gradient(135deg, rgba(0,229,255,0.10), transparent 70%);
      opacity: 0;
      transition: opacity 300ms var(--ease-cinematic);
      pointer-events: none;
      border-radius: 14px;
    }
    .ga4-status:hover { box-shadow: 0 14px 36px -18px rgba(0,229,255,0.30); }
    .ga4-status:hover::before { opacity: 1; }
    .ga4-status-connected {
      background: rgba(34,197,94,0.03);
      border-color: rgba(34,197,94,0.16);
    }
    .ga4-status-connected:hover { box-shadow: 0 14px 36px -18px rgba(34,197,94,0.35); }
    .ga4-status-connected::before {
      background: linear-gradient(135deg, rgba(34,197,94,0.10), transparent 70%);
    }

    .ga4-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: rgba(0,229,255,0.08);
      color: rgba(0,229,255,0.85);
      transition: transform 320ms var(--ease-elastic), box-shadow 260ms var(--ease-cinematic);
    }
    .ga4-status:hover .ga4-icon {
      transform: rotate(-8deg) scale(1.10);
      box-shadow: 0 8px 24px -10px rgba(0,229,255,0.55);
    }
    .ga4-icon-connected {
      background: rgba(34,197,94,0.08);
      color: #4ade80;
    }
    .ga4-status-connected:hover .ga4-icon {
      box-shadow: 0 8px 24px -10px rgba(34,197,94,0.55);
    }

    @media (max-width: 768px) {
      .ga4-status { flex-direction: column; text-align: center; }
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes barRise {
      from { transform: scaleY(0); opacity: 0.4; }
      to { transform: scaleY(1); opacity: 1; }
    }
    @keyframes fillIn {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes livePulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(34,197,94,0.7); }
      50% { transform: scale(1.3); box-shadow: 0 0 14px rgba(34,197,94,0.9); }
    }
    @keyframes dotsBlink {
      0%, 20% { content: ''; }
      40% { content: '.'; }
      60% { content: '..'; }
      80%, 100% { content: '...'; }
    }

    @media (prefers-reduced-motion: reduce) {
      .analytics-header, .stat-card, .analytics-card, .source-row, .page-row, .ga4-status,
      .chart-bar, .source-fill {
        animation: none !important;
        transition-duration: 80ms !important;
      }
      .stat-card:hover, .source-row:hover, .page-row:hover, .ga4-status:hover {
        transform: none;
      }
      .header-glyph, .ga4-icon, .refresh-btn svg {
        transform: none !important;
      }
      .live-dot, .refresh-spinner { animation: none; }
    }
  `],
})
export class AdminAnalyticsComponent {
  readonly state = inject(AdminStateService);

  readonly ga4Connected = computed(() => this.state.analytics()?.ga4_connected ?? false);
  readonly measurementId = computed(() => this.state.analytics()?.ga4_measurement_id ?? '');
  readonly gtmId = computed(() => this.state.analytics()?.gtm_container_id ?? '');

  readonly statsCards = computed(() => {
    const s = this.state.analytics()?.stats;
    if (!s) {
      return [
        { label: 'Page Views', value: '—' },
        { label: 'Unique Visitors', value: '—' },
        { label: 'Avg. Session', value: '—' },
        { label: 'Bounce Rate', value: '—' },
      ];
    }
    return [
      { label: 'Page Views', value: this.fmt(s.pageViews) },
      { label: 'Unique Visitors', value: this.fmt(s.uniqueVisitors) },
      { label: 'Avg. Session', value: s.avgSessionDuration },
      { label: 'Bounce Rate', value: `${s.bounceRate}%` },
    ];
  });

  readonly chartBars = computed(() => {
    const data = this.state.analytics()?.chartData ?? [];
    if (!data.length) return [];
    const maxViews = Math.max(...data.map(d => d.views), 1);
    return data.map(d => ({
      height: Math.max(2, (d.views / maxViews) * 100),
      views: d.views,
      label: this.formatDateLabel(d.date),
    }));
  });

  readonly labelSkip = computed(() => {
    const len = this.chartBars().length;
    if (len <= 7) return 1;
    if (len <= 14) return 2;
    return Math.ceil(len / 7);
  });

  readonly trafficSources = computed(() => this.state.analytics()?.trafficSources ?? []);
  readonly topPages = computed(() => this.state.analytics()?.topPages ?? []);

  sourceColor(index: number): string {
    return SOURCE_COLORS[index % SOURCE_COLORS.length];
  }

  onPeriodChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.state.setAnalyticsPeriod(value);
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  private formatDateLabel(dateStr: string): string {
    if (!dateStr || dateStr.length < 8) return dateStr;
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    const date = new Date(`${y}-${m}-${d}`);
    if (isNaN(date.getTime())) {
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      return dateStr;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
