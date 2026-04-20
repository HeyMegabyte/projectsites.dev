import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Analytics</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Monitor your site traffic and visitor behavior.</p>
        </div>
        <div class="flex items-center gap-2">
          <select class="input-field !w-auto !py-1.5 !px-3 !text-[0.75rem]">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-[480px]:grid-cols-1">
        @for (stat of stats; track stat.label) {
          <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-4 flex flex-col gap-1.5 transition-colors hover:border-primary/[0.12]">
            <div class="flex items-center justify-between">
              <span class="text-[0.68rem] text-text-secondary uppercase tracking-wide font-semibold">{{ stat.label }}</span>
              <span class="text-[0.62rem] font-semibold px-1.5 py-0.5 rounded" [class]="stat.changePositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'">
                {{ stat.changePositive ? '+' : '' }}{{ stat.change }}
              </span>
            </div>
            <span class="text-2xl font-bold text-white">{{ stat.value }}</span>
            <span class="text-[0.68rem] text-text-secondary/60">vs. previous period</span>
          </div>
        }
      </div>

      <!-- Chart Area -->
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-[0.9rem] font-semibold text-white m-0">Page Views</h3>
          <div class="flex gap-1 p-0.5 bg-white/[0.03] rounded-lg border border-white/[0.06]">
            <button class="text-[0.68rem] py-1 px-2.5 rounded-md bg-primary/10 text-primary border-none cursor-pointer font-sans font-medium">Views</button>
            <button class="text-[0.68rem] py-1 px-2.5 rounded-md bg-transparent text-text-secondary border-none cursor-pointer font-sans font-medium hover:text-white">Visitors</button>
          </div>
        </div>
        <!-- CSS-only mini chart -->
        <div class="flex items-end gap-[3px] h-[140px] px-2">
          @for (bar of chartBars; track $index) {
            <div class="flex-1 rounded-t-[3px] transition-all duration-300"
                 [style.height.%]="bar"
                 [style.background]="'linear-gradient(to top, rgba(0,229,255,0.15), rgba(0,229,255,' + (0.25 + bar/200) + '))'">
            </div>
          }
        </div>
        <div class="flex justify-between mt-2 px-2">
          @for (day of chartLabels; track $index) {
            <span class="text-[0.6rem] text-text-secondary/50">{{ day }}</span>
          }
        </div>
      </div>

      <!-- Bottom Grid -->
      <div class="grid grid-cols-2 gap-4 max-lg:grid-cols-1">

        <!-- Traffic Sources -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
          <h3 class="text-[0.9rem] font-semibold text-white m-0 mb-4">Traffic Sources</h3>
          <div class="flex flex-col gap-2.5">
            @for (source of trafficSources; track source.name) {
              <div class="flex items-center gap-3">
                <span class="text-[0.78rem] text-white w-20 flex-shrink-0">{{ source.name }}</span>
                <div class="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-500" [style.width.%]="source.percent" [style.background]="source.color"></div>
                </div>
                <span class="text-[0.72rem] text-text-secondary w-10 text-right">{{ source.percent }}%</span>
              </div>
            }
          </div>
        </div>

        <!-- Top Pages -->
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
          <h3 class="text-[0.9rem] font-semibold text-white m-0 mb-4">Top Pages</h3>
          <div class="flex flex-col gap-0">
            @for (page of topPages; track page.path) {
              <div class="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <span class="text-[0.78rem] text-primary/80 font-mono">{{ page.path }}</span>
                <span class="text-[0.72rem] text-text-secondary">{{ page.views }} views</span>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Connect GA CTA -->
      <div class="bg-primary/[0.03] border border-primary/[0.08] rounded-[14px] p-6 flex items-center gap-4 max-md:flex-col max-md:text-center">
        <div class="w-12 h-12 rounded-xl bg-primary/[0.08] flex items-center justify-center text-primary flex-shrink-0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-white text-[0.9rem] font-semibold m-0 mb-1">Connect Google Analytics</h4>
          <p class="text-[0.78rem] text-text-secondary m-0">Link your GA4 property for real-time traffic data, conversion tracking, and audience insights.</p>
        </div>
        <button class="btn-accent whitespace-nowrap" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Connect GA4
        </button>
      </div>

    </div>
  `,
})
export class AdminAnalyticsComponent {
  stats = [
    { label: 'Page Views', value: '1,247', change: '12.3%', changePositive: true },
    { label: 'Unique Visitors', value: '438', change: '8.1%', changePositive: true },
    { label: 'Avg. Session', value: '2m 34s', change: '-3.2%', changePositive: false },
    { label: 'Bounce Rate', value: '34.2%', change: '-5.7%', changePositive: true },
  ];

  chartBars = [35, 52, 48, 65, 72, 58, 85, 78, 92, 68, 74, 88, 95, 82, 70, 63, 80, 90, 75, 68, 85, 92, 78, 65, 72, 88, 95, 82];
  chartLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  trafficSources = [
    { name: 'Direct', percent: 42, color: '#00E5FF' },
    { name: 'Search', percent: 31, color: '#22c55e' },
    { name: 'Social', percent: 18, color: '#8b5cf6' },
    { name: 'Referral', percent: 9, color: '#f59e0b' },
  ];

  topPages = [
    { path: '/', views: 523 },
    { path: '/about', views: 287 },
    { path: '/services', views: 198 },
    { path: '/contact', views: 142 },
    { path: '/blog', views: 97 },
  ];
}
