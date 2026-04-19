import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-editor',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (!state.selectedSite()) {
      <div class="flex flex-col items-center justify-center text-center py-20 px-5 text-text-secondary gap-3 h-full">
        <svg class="opacity-40" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        <h3 class="text-white font-semibold text-base m-0">Select a site first</h3>
        <p class="text-[0.9rem] max-w-[400px] m-0">Choose a site from the sidebar to open it in the AI editor.</p>
      </div>
    } @else {
      <div class="relative w-full h-[calc(100vh-49px)] flex flex-col">
        <!-- Toolbar -->
        <div class="flex items-center justify-between px-4 py-2 bg-dark/80 border-b border-white/[0.06] flex-shrink-0">
          <div class="flex items-center gap-2 text-[0.82rem]">
            <span class="text-primary font-semibold">{{ state.selectedSite()!.business_name }}</span>
            <span class="text-text-secondary">-</span>
            <span class="text-text-secondary">{{ state.selectedSite()!.slug }}.projectsites.dev</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-ghost-sm" (click)="saveAndDeploy()" [disabled]="saving()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {{ saving() ? 'Saving...' : 'Save & Deploy' }}
            </button>
            <button class="btn-ghost-sm" (click)="openFullscreen()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              Fullscreen
            </button>
          </div>
        </div>
        <!-- Iframe -->
        @if (iframeUrl()) {
          <iframe class="flex-1 w-full border-none bg-[#0a0a1a] editor-iframe"
                  [src]="iframeUrl()!"
                  allow="clipboard-read; clipboard-write; cross-origin-isolated"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals">
          </iframe>
        }
      </div>
    }
  `,
})
export class AdminEditorComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private sanitizer = inject(DomSanitizer);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  iframeUrl = signal<SafeResourceUrl | null>(null);
  saving = signal(false);

  private messageHandler: ((event: MessageEvent) => void) | null = null;

  ngOnInit(): void {
    this.buildIframeUrl();
    this.setupMessageListener();
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  private buildIframeUrl(): void {
    const site = this.state.selectedSite();
    if (!site) return;

    const slug = site.slug;
    const chatUrl = `/api/sites/by-slug/${slug}/chat`;
    const editorBase = 'https://editor.projectsites.dev';
    const params = new URLSearchParams({
      embedded: 'true',
      hideHeader: 'true',
      slug,
      importChatFrom: `${window.location.origin}${chatUrl}`,
    });
    this.iframeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`${editorBase}/?${params.toString()}`));
  }

  private setupMessageListener(): void {
    const site = this.state.selectedSite();
    if (!site) return;

    this.messageHandler = (event: MessageEvent) => {
      const allowedOrigins = ['https://editor.projectsites.dev', 'http://localhost:5173'];
      if (!allowedOrigins.includes(event.origin)) return;
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('PS_')) return;

      if (msg.type === 'PS_FILES_READY') {
        this.uploadFiles(site, msg.files, msg.chat);
      } else if (msg.type === 'PS_GENERATION_STATUS') {
        if (msg.status === 'complete') {
          this.toast.success('AI generation complete');
          this.saveAndDeploy();
        } else if (msg.status === 'error') {
          this.toast.error('AI generation failed: ' + (msg.error || 'Unknown error'));
        }
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  saveAndDeploy(): void {
    const iframe = document.querySelector('.editor-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) { this.toast.error('Editor not ready'); return; }

    this.saving.set(true);
    iframe.contentWindow.postMessage({
      type: 'PS_REQUEST_FILES',
      includeChat: true,
      correlationId: crypto.randomUUID(),
    }, '*');
    this.toast.info('Saving files from editor...');
  }

  private uploadFiles(site: any, files: Record<string, string>, chat?: any): void {
    const entries = Object.entries(files);
    if (entries.length === 0) { this.saving.set(false); this.toast.error('No files to save'); return; }

    const fileList = entries.map(([filePath, content]) => ({
      path: filePath.replace(/^\/home\/project\//, ''),
      content,
    }));
    const chatExport = chat || { messages: [], description: site.business_name, exportDate: new Date().toISOString() };

    this.api.publishFromBolt(site.id, site.slug, fileList, chatExport).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(`Deployed ${fileList.length} files successfully`);
      },
      error: (err: any) => {
        this.saving.set(false);
        this.toast.error('Deploy failed: ' + (err?.error?.message || 'Unknown error'));
      },
    });
  }

  openFullscreen(): void {
    const site = this.state.selectedSite();
    if (site) window.open(`https://editor.projectsites.dev/?slug=${site.slug}`, '_blank');
  }
}
