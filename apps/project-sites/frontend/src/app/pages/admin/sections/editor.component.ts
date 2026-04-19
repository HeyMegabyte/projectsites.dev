import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * Editor component that embeds bolt.diy (editor.projectsites.dev) in an iframe
 * and communicates via postMessage for file exchange and deployment.
 *
 * @remarks
 * Message protocol:
 * - PS_BOLT_READY: editor iframe signals it has loaded and is ready for commands
 * - PS_REQUEST_FILES: sent TO the iframe to request current file state
 * - PS_FILES_READY: received FROM the iframe with file contents + optional chat
 * - PS_GENERATION_STATUS: received FROM the iframe with AI generation progress
 * - PS_SUBMIT_PROMPT: sent TO the iframe to trigger AI generation with a prompt
 *
 * @example
 * ```html
 * <app-admin-editor />
 * ```
 */
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
      <div class="relative w-full h-[calc(100vh-49px)]">
        <!-- Loading overlay while waiting for PS_BOLT_READY -->
        @if (!editorReady()) {
          <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0a0a1a]">
            <div class="loading-spinner"></div>
            <span class="text-text-secondary text-sm">Loading editor...</span>
          </div>
        }

        @if (iframeUrl()) {
          <iframe class="w-full h-full border-none bg-[#0a0a1a] editor-iframe"
                  [src]="iframeUrl()!"
                  allow="clipboard-read; clipboard-write; cross-origin-isolated"
                  credentialless>
          </iframe>
        }

        <!-- Save status indicator -->
        @if (saving()) {
          <div class="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm">
            <div class="loading-spinner-sm"></div>
            <span>Saving and deploying...</span>
          </div>
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
  editorReady = signal(false);

  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.buildIframeUrl();
    this.setupMessageListener();

    // Auto-dismiss loading overlay after 15s even if PS_BOLT_READY never fires
    this.readyTimeout = setTimeout(() => {
      if (!this.editorReady()) {
        this.editorReady.set(true);
      }
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
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
      hideDiff: 'true',
      hideDeploy: 'true',
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

      switch (msg.type) {
        case 'PS_BOLT_READY':
          this.editorReady.set(true);
          if (this.readyTimeout) {
            clearTimeout(this.readyTimeout);
            this.readyTimeout = null;
          }
          break;

        case 'PS_FILES_READY':
          this.uploadFiles(site, msg.files, msg.chat);
          break;

        case 'PS_GENERATION_STATUS':
          if (msg.status === 'complete') {
            this.toast.success('AI generation complete');
            this.saveAndDeploy();
          } else if (msg.status === 'error') {
            this.toast.error('AI generation failed: ' + (msg.error || 'Unknown error'));
          } else if (msg.status === 'progress') {
            // Progress updates are informational only
          }
          break;

        case 'PS_ERROR':
          this.toast.error('Editor error: ' + (msg.message || 'Unknown error'));
          this.saving.set(false);
          break;

        default:
          break;
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Request files from the editor iframe and deploy them.
   * Called from the admin shell's "Save & Deploy" button.
   */
  saveAndDeploy(): void {
    const iframe = document.querySelector('.editor-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) {
      this.toast.error('Editor not ready');
      return;
    }

    this.saving.set(true);
    const correlationId = crypto.randomUUID();
    iframe.contentWindow.postMessage({
      type: 'PS_REQUEST_FILES',
      includeChat: true,
      correlationId,
    }, '*');
    this.toast.info('Saving files from editor...');

    // Safety timeout: reset saving state if no response after 30s
    setTimeout(() => {
      if (this.saving()) {
        this.saving.set(false);
        this.toast.error('Save timed out. The editor may not have responded.');
      }
    }, 30000);
  }

  /**
   * Upload files received from the editor to the backend for deployment.
   *
   * @param site - The site being edited
   * @param files - Map of file paths to content strings
   * @param chat - Optional chat export for context preservation
   */
  private uploadFiles(site: any, files: Record<string, string>, chat?: any): void {
    const entries = Object.entries(files || {});
    if (entries.length === 0) {
      this.saving.set(false);
      this.toast.error('No files received from the editor');
      return;
    }

    const fileList = entries.map(([filePath, content]) => ({
      path: filePath.replace(/^\/home\/project\//, ''),
      content,
    }));
    const chatExport = chat || {
      messages: [],
      description: site.business_name,
      exportDate: new Date().toISOString(),
    };

    this.api.publishFromBolt(site.id, site.slug, fileList, chatExport).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toast.success(`Deployed ${fileList.length} files successfully`);
        // Refresh site data to reflect new build version
        this.state.loadData();
      },
      error: (err: any) => {
        this.saving.set(false);
        const message = err?.error?.error?.message || err?.error?.message || 'Unknown error';
        this.toast.error('Deploy failed: ' + message);
      },
    });
  }

  /**
   * Open the editor in a new tab (full-screen mode).
   */
  openFullscreen(): void {
    const site = this.state.selectedSite();
    if (site) {
      window.open(`https://editor.projectsites.dev/?slug=${site.slug}`, '_blank');
    }
  }
}
