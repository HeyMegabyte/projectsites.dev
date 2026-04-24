import { Component, inject, computed } from '@angular/core';
import { AdminStateService } from '../admin-state.service';

const SOURCE_COLORS = ['#00E5FF', '#22c55e', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Analytics</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            @if (ga4Connected()) {
              Live data from Google Analytics 4
              <span class="inline-flex items-center gap-1 ml-1.5 text-green-400 text-[0.68rem]">
                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                Connected
              </span>
            } @else {
              Monitor your site traffic and visitor behavior.
            }
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select
            class="bg-white/[0.04] border border-white/[0.08] rounded-lg py-1.5 px-3 text-[0.75rem] text-white outline-none font-sans"
            [value]="state.analyticsPeriod()"
            (change)="onPeriodChange($event)"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button
            class="text-[0.72rem] text-primary/70 hover:text-primary transition-colors px-2 py-1"
            (click)="state.loadAnalytics()"
            [disabled]="state.analyticsLoading()"
          >
            @if (state.analyticsLoading()) {
              <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
            } @else {
              Refresh
            }
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
        @for (stat of statsCards(); track stat.label) {
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-4 flex flex-col gap-1.5 transition-colors hover:border-primary/[0.12]">
            <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">{{ stat.label }}</span>
            <span class="text-2xl font-bold text-white">{{ stat.value }}</span>
            <span class="text-[0.68rem] text-text-secondary/60">last {{ state.analyticsPeriod() }} days</span>
          </div>
        }
      </div>

      <!-- Chart Area -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-[0.9rem] font-semibold text-white m-0">Page Views</h3>
        </div>
        @if (chartBars().length > 0) {
          <div class="flex items-end gap-[3px] h-[140px] px-2">
            @for (bar of chartBars(); track $index) {
              <div
                class="flex-1 rounded-t-[3px] transition-all duration-300 min-h-[2px]"
                [style.height.%]="bar.height"
                [style.background]="'linear-gradient(to top, rgba(0,229,255,0.15), rgba(0,229,255,' + (0.25 + bar.height/200) + '))'"
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
              Loading chart data...
            } @else {
              No data yet — traffic will appear here once visitors arrive.
            }
          </div>
        }
      </div>

      <!-- Bottom Grid -->
      <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">

        <!-- Traffic Sources -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
          <h3 class="text-[0.9rem] font-semibold text-white m-0 mb-4">Traffic Sources</h3>
          @if (trafficSources().length > 0) {
            <div class="flex flex-col gap-2.5">
              @for (source of trafficSources(); track source.name; let i = $index) {
                <div class="flex items-center gap-3">
                  <span class="text-[0.78rem] text-white w-20 flex-shrink-0">{{ source.name }}</span>
                  <div class="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      [style.width.%]="source.percent"
                      [style.background]="sourceColor(i)"
                    ></div>
                  </div>
                  <span class="text-[0.72rem] text-text-secondary w-10 text-right">{{ source.percent }}%</span>
                </div>
              }
            </div>
          } @else {
            <p class="text-text-secondary/40 text-sm">No traffic data yet.</p>
          }
        </div>

        <!-- Top Pages -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
          <h3 class="text-[0.9rem] font-semibold text-white m-0 mb-4">Top Pages</h3>
          @if (topPages().length > 0) {
            <div class="flex flex-col gap-0">
              @for (page of topPages(); track page.path) {
                <div class="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <span class="text-[0.78rem] text-primary/80 font-mono">{{ page.path }}</span>
                  <span class="text-[0.72rem] text-text-secondary">{{ page.views }} views</span>
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
        class="border rounded-[14px] p-6 flex items-center gap-4 max-md:flex-col max-md:text-center"
        [class]="ga4Connected() ? 'bg-green-500/[0.03] border-green-500/[0.12]' : 'bg-primary/[0.03] border-primary/[0.08]'"
      >
        <div
          class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          [class]="ga4Connected() ? 'bg-green-500/[0.08] text-green-400' : 'bg-primary/[0.08] text-primary'"
        >
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
    // GA4 returns YYYYMMDD format
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    const date = new Date(`${y}-${m}-${d}`);
    if (isNaN(date.getTime())) {
      // Try ISO format
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      return dateStr;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
