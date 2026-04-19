import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService, Hostname } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-domains',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <div class="bg-white/[0.02] border border-white/[0.06] rounded-[14px] p-6">
        <!-- Tabs -->
        <div class="flex gap-1 mb-5 p-1 bg-primary/[0.03] rounded-[10px] border border-white/[0.06]">
          <button class="flex-1 py-2 px-4 border-none bg-transparent text-text-secondary text-[0.78rem] font-medium font-sans cursor-pointer rounded-[7px] transition-all" [class.tab-active]="domainTab() === 'existing'" (click)="domainTab.set('existing')">Your Domains</button>
          <button class="flex-1 py-2 px-4 border-none bg-transparent text-text-secondary text-[0.78rem] font-medium font-sans cursor-pointer rounded-[7px] transition-all" [class.tab-active]="domainTab() === 'connect'" (click)="domainTab.set('connect')">Connect Domain</button>
          <button class="flex-1 py-2 px-4 border-none bg-transparent text-text-secondary text-[0.78rem] font-medium font-sans cursor-pointer rounded-[7px] transition-all" [class.tab-active]="domainTab() === 'register'" (click)="domainTab.set('register')">Register New</button>
        </div>

        @if (loadingHostnames()) {
          <div class="flex flex-col items-center justify-center gap-3 py-[60px] text-text-secondary text-[0.85rem]"><div class="loading-spinner"></div><span>Loading domains...</span></div>
        } @else {
          @if (domainTab() === 'existing') {
            <div class="flex flex-col gap-2">
              <!-- Default subdomain -->
              <div class="flex flex-col gap-2 p-3.5 px-4 bg-primary/[0.04] rounded-[10px] border border-primary/10">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)] flex-shrink-0"></span>
                  @if (editingSlug()) {
                    <div class="flex items-center gap-1">
                      <input class="text-[0.8rem] font-medium font-sans bg-black/30 border border-primary rounded-md text-white py-1 px-2.5 outline-none flex-1 min-w-0 shadow-[0_0_0_2px_rgba(0,229,255,0.1)]" [(ngModel)]="modalSlugValue" (keyup.enter)="saveSlug()" (keyup.escape)="editingSlug.set(false)" />
                      <span class="text-[0.75rem] text-text-secondary whitespace-nowrap">.projectsites.dev</span>
                      <button class="btn-ghost-sm" (click)="saveSlug()">Save</button>
                      <button class="btn-ghost-sm" (click)="editingSlug.set(false)">Cancel</button>
                    </div>
                  } @else {
                    <a [href]="'https://' + state.selectedSite()!.slug + '.projectsites.dev'" target="_blank" rel="noopener" class="text-[0.85rem] text-primary no-underline hover:text-shadow-[0_0_8px_rgba(0,229,255,0.3)]">
                      {{ state.selectedSite()!.slug }}.projectsites.dev
                    </a>
                    <span class="text-[0.58rem] font-bold py-px px-2 rounded uppercase bg-text-secondary/10 text-text-secondary">Default</span>
                    <button class="icon-btn-sm" (click)="startSlugEdit()" title="Change subdomain">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                  }
                </div>
              </div>

              @for (hn of hostnames(); track hn.id) {
                <div class="flex flex-col gap-2 p-3.5 px-4 bg-primary/[0.02] rounded-[10px] border border-white/[0.06] transition-colors hover:border-primary/[0.15]">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" [ngClass]="'hn-dot-' + hn.status"></span>
                    <a [href]="'https://' + hn.hostname" target="_blank" rel="noopener" class="text-[0.85rem] text-primary no-underline">{{ hn.hostname }}</a>
                    @if (hn.is_primary) { <span class="text-[0.58rem] font-bold py-px px-2 rounded uppercase bg-primary/[0.12] text-primary">Primary</span> }
                    <span class="text-[0.58rem] font-bold py-px px-2 rounded uppercase" [ngClass]="'hn-chip-' + hn.status">{{ hn.status }}</span>
                  </div>
                  @if (hn.status === 'pending') {
                    <div class="flex items-center gap-1.5 text-[0.75rem] text-amber-400 py-1.5 px-2.5 bg-amber-400/5 rounded-md">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Point CNAME to <code class="bg-primary/10 py-px px-1.5 rounded text-[0.72rem] text-primary">projectsites.dev</code> -- DNS may take 24-72 hours.
                    </div>
                  }
                  <div class="flex gap-1.5">
                    @if (!hn.is_primary) {
                      <button class="btn-ghost-sm" (click)="setPrimary(hn.id)">Set Primary</button>
                    }
                    <button class="btn-ghost-sm-danger" (click)="deleteHostname(hn.id)">Remove</button>
                  </div>
                </div>
              }

              @if (hostnames().length === 0) {
                <p class="text-[0.78rem] text-text-secondary my-2">No custom domains configured yet.</p>
              }
            </div>
          }

          @if (domainTab() === 'connect') {
            <div class="flex flex-col gap-4">
              <div class="p-4 bg-primary/[0.03] rounded-[10px] border border-white/[0.06]">
                <h4 class="text-white text-[0.9rem] m-0 mb-2.5">Connect your domain</h4>
                <p class="text-text-secondary text-[0.8rem] my-1">1. Go to your domain registrar's DNS settings</p>
                <p class="text-text-secondary text-[0.8rem] my-1">2. Add a <strong>CNAME</strong> record pointing to <code class="bg-primary/10 py-px px-1.5 rounded text-[0.78rem] text-primary">projectsites.dev</code></p>
                <p class="text-text-secondary text-[0.8rem] my-1">3. Enter your domain below and click "Add Domain"</p>
              </div>
              <div class="flex gap-2.5 items-center">
                <input type="text" class="input-field flex-1" placeholder="www.yourdomain.com" [(ngModel)]="newHostname" (keyup.enter)="addHostname()" />
                <button class="btn-accent" (click)="addHostname()" [disabled]="!newHostname.trim()">Add Domain</button>
              </div>
            </div>
          }

          @if (domainTab() === 'register') {
            <div class="flex flex-col gap-4">
              <div class="p-4 bg-primary/[0.03] rounded-[10px] border border-white/[0.06]">
                <h4 class="text-white text-[0.9rem] m-0 mb-2.5">Register a new domain</h4>
                <p class="text-text-secondary text-[0.8rem] my-1">Search for an available domain name and register it through Cloudflare.</p>
              </div>
              <div class="flex gap-2.5 items-center">
                <input type="text" class="input-field flex-1" placeholder="yourbusiness.com" [(ngModel)]="registerDomainQuery" (keyup.enter)="checkDomainAvailability()" />
                <button class="btn-accent" (click)="checkDomainAvailability()" [disabled]="checkingDomain() || !registerDomainQuery.trim()">
                  {{ checkingDomain() ? 'Checking...' : 'Check Availability' }}
                </button>
              </div>
              @if (domainCheckResult()) {
                <div class="p-4 rounded-[10px] border border-white/[0.06] bg-black/10" [class.domain-available]="domainCheckResult()!.available">
                  @if (domainCheckResult()!.available) {
                    <div class="flex items-center gap-2 text-green-500 text-[0.9rem] mb-2">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <strong class="text-primary">{{ domainCheckResult()!.domain }}</strong> is available!
                    </div>
                    <a class="btn-accent inline-flex mt-2" href="https://www.cloudflare.com/products/registrar/" target="_blank" rel="noopener">Register on Cloudflare</a>
                  } @else {
                    <div class="flex items-center gap-2 text-red-500 text-[0.9rem] mb-2">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <strong class="text-white">{{ domainCheckResult()!.domain }}</strong> is not available.
                    </div>
                    <p class="text-[0.78rem] text-text-secondary my-1">Try a different name or extension (.net, .co, .io).</p>
                  }
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class AdminDomainsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  domainTab = signal<'existing' | 'connect' | 'register'>('existing');
  hostnames = signal<Hostname[]>([]);
  loadingHostnames = signal(false);
  newHostname = '';
  editingSlug = signal(false);
  modalSlugValue = '';
  registerDomainQuery = '';
  checkingDomain = signal(false);
  domainCheckResult = signal<{ domain: string; available: boolean } | null>(null);

  ngOnInit(): void {
    const site = this.state.selectedSite();
    if (site) this.loadHostnames(site.id);
  }

  private loadHostnames(siteId: string): void {
    this.loadingHostnames.set(true);
    this.api.getHostnames(siteId).subscribe({
      next: (res) => { this.hostnames.set(res.data || []); this.loadingHostnames.set(false); },
      error: () => { this.loadingHostnames.set(false); this.toast.error('Failed to load domains'); },
    });
  }

  startSlugEdit(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.modalSlugValue = site.slug;
    this.editingSlug.set(true);
  }

  saveSlug(): void {
    const site = this.state.selectedSite();
    const newSlug = this.modalSlugValue.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!site || !newSlug) return;
    this.api.updateSite(site.id, { slug: newSlug } as any).subscribe({
      next: (res) => {
        this.state.sites.update(sites => sites.map(s => s.id === site.id ? { ...s, slug: res.data?.slug || newSlug } : s));
        this.editingSlug.set(false);
        this.toast.success('Subdomain updated');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Failed to update subdomain'),
    });
  }

  addHostname(): void {
    const site = this.state.selectedSite();
    if (!site || !this.newHostname.trim()) return;
    this.api.addHostname(site.id, this.newHostname.trim()).subscribe({
      next: (res) => {
        this.hostnames.update(h => [...h, res.data]);
        this.newHostname = '';
        this.toast.success('Domain added -- point your CNAME to projectsites.dev');
        this.domainTab.set('existing');
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Failed to add domain'),
    });
  }

  setPrimary(hostnameId: string): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.setPrimaryHostname(site.id, hostnameId).subscribe({
      next: () => {
        this.hostnames.update(h => h.map(hn => ({ ...hn, is_primary: hn.id === hostnameId })));
        this.toast.success('Primary domain updated');
      },
      error: () => this.toast.error('Failed to set primary'),
    });
  }

  deleteHostname(hostnameId: string): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.deleteHostname(site.id, hostnameId).subscribe({
      next: () => { this.hostnames.update(h => h.filter(hn => hn.id !== hostnameId)); this.toast.success('Domain removed'); },
      error: () => this.toast.error('Failed to remove domain'),
    });
  }

  checkDomainAvailability(): void {
    const query = this.registerDomainQuery.trim().toLowerCase();
    if (!query) return;
    const domain = query.includes('.') ? query : `${query}.com`;
    this.checkingDomain.set(true);
    this.domainCheckResult.set(null);
    this.api.checkSlug(domain.replace(/\./g, '-')).subscribe({
      next: () => { this.domainCheckResult.set({ domain, available: true }); this.checkingDomain.set(false); },
      error: () => { this.domainCheckResult.set({ domain, available: false }); this.checkingDomain.set(false); },
    });
  }
}
