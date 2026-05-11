import { Component, inject, signal, type OnInit, type OnDestroy } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
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
 * - PS_APP_RUNNING: editor signals WebContainer's Start Application completed and preview is live
 * - PS_REQUEST_FILES: sent TO the iframe to request current file state
 * - PS_FILES_READY: received FROM the iframe with file contents + optional chat
 * - PS_GENERATION_STATUS: received FROM the iframe with AI generation progress (status: 'app_ready' also dismisses veil)
 * - PS_SUBMIT_PROMPT: sent TO the iframe to trigger AI generation with a prompt
 *
 * Loading veil lifecycle:
 * - Shows immediately on component init (covers bolt.diy's own "Loading..." flicker)
 * - Dismisses on PS_APP_RUNNING (preferred) or PS_GENERATION_STATUS:'app_ready'
 * - Hard fallback timeout: 60s (covers cold WebContainer boot + npm install + dev server start)
 * - Soft fallback timeout: 30s — if PS_BOLT_READY fired but no app_running, dismiss anyway
 *
 * @example
 * ```html
 * <app-admin-editor />
 * ```
 */
@Component({
  selector: 'app-admin-editor',
  standalone: true,
  imports: [],
  template: `
    @if (!state.selectedSite()) {
      <div class="empty-state flex flex-col items-center justify-center text-center py-20 px-5 text-text-secondary gap-4 h-full">
        <div class="empty-glyph">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          </svg>
        </div>
        <h3 class="text-white font-semibold text-lg m-0">Select a site first</h3>
        <p class="text-[0.9rem] max-w-[420px] m-0 leading-relaxed">Choose a site from the sidebar to open it in the AI editor.</p>
      </div>
    } @else {
      <div class="relative w-full h-[calc(100vh-49px)]">
        <!-- Cinematic loading overlay while waiting for PS_BOLT_READY -->
        @if (!editorReady()) {
          <div class="loading-veil absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0a1a]">
            <div class="orbit-spinner" aria-hidden="true">
              <div class="orbit orbit-1"></div>
              <div class="orbit orbit-2"></div>
              <div class="orbit orbit-3"></div>
            </div>
            <span class="text-white/70 text-sm font-medium tracking-wide">Loading</span>
            <span class="text-text-secondary/60 text-xs">{{ loadingStage() }}</span>
          </div>
        }

        @if (iframeUrl()) {
          <iframe class="w-full h-full border-none bg-[#0a0a1a] editor-iframe transition-opacity duration-500"
                  [class.opacity-0]="!editorReady()"
                  [class.opacity-100]="editorReady()"
                  [src]="iframeUrl()!"
                  allow="clipboard-read; clipboard-write; cross-origin-isolated"
                  credentialless>
          </iframe>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
    }

    .empty-state {
      animation: fadeUp 600ms var(--ease-cinematic);
    }
    .empty-glyph {
      width: 88px;
      height: 88px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 20px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.08), rgba(124, 58, 237, 0.05));
      border: 1px solid rgba(0, 229, 255, 0.12);
      color: rgba(0, 229, 255, 0.7);
      box-shadow:
        0 16px 48px -24px rgba(0, 229, 255, 0.3),
        0 0 0 1px rgba(0, 229, 255, 0.05) inset;
      animation: pulseGlow 3.6s var(--ease-cinematic) infinite;
    }

    .loading-veil {
      animation: fadeIn 240ms var(--ease-cinematic);
      background:
        radial-gradient(ellipse at center, rgba(0, 229, 255, 0.04) 0%, transparent 60%),
        #0a0a1a;
    }

    .orbit-spinner {
      position: relative;
      width: 56px;
      height: 56px;
    }
    .orbit {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgba(0, 229, 255, 0.9);
      animation: spin 1.2s var(--ease-cinematic) infinite;
    }
    .orbit-2 {
      inset: 6px;
      border-top-color: transparent;
      border-right-color: rgba(124, 58, 237, 0.7);
      animation-duration: 1.6s;
      animation-direction: reverse;
    }
    .orbit-3 {
      inset: 12px;
      border-top-color: transparent;
      border-bottom-color: rgba(0, 229, 255, 0.5);
      animation-duration: 2.0s;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulseGlow {
      0%, 100% {
        box-shadow:
          0 16px 48px -24px rgba(0, 229, 255, 0.3),
          0 0 0 1px rgba(0, 229, 255, 0.05) inset;
      }
      50% {
        box-shadow:
          0 20px 64px -24px rgba(0, 229, 255, 0.45),
          0 0 0 1px rgba(0, 229, 255, 0.12) inset;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .empty-state, .loading-veil, .empty-glyph { animation: none; }
      .orbit { animation-duration: 3s; }
    }
  `],
})
export class AdminEditorComponent implements OnInit, OnDestroy {
  state = inject(AdminStateService);
  private sanitizer = inject(DomSanitizer);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  iframeUrl = signal<SafeResourceUrl | null>(null);
  saving = signal(false);
  editorReady = signal(false);
  loadingStage = signal('Booting bolt.diy');

  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private hardTimeout: ReturnType<typeof setTimeout> | null = null;
  private softTimeout: ReturnType<typeof setTimeout> | null = null;
  private boltReady = false;

  ngOnInit(): void {
    this.buildIframeUrl();
    this.setupMessageListener();

    this.hardTimeout = setTimeout(() => this.dismissVeil('timeout'), 60000);
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    if (this.hardTimeout) clearTimeout(this.hardTimeout);
    if (this.softTimeout) clearTimeout(this.softTimeout);
    this.hardTimeout = null;
    this.softTimeout = null;
  }

  private dismissVeil(_reason: 'app_running' | 'timeout' | 'soft_timeout'): void {
    if (this.editorReady()) return;
    this.editorReady.set(true);
    if (this.hardTimeout) { clearTimeout(this.hardTimeout); this.hardTimeout = null; }
    if (this.softTimeout) { clearTimeout(this.softTimeout); this.softTimeout = null; }
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
          this.boltReady = true;
          this.loadingStage.set('Running Start Application');
          if (!this.softTimeout) {
            this.softTimeout = setTimeout(() => this.dismissVeil('soft_timeout'), 30000);
          }
          break;

        case 'PS_APP_RUNNING':
          this.dismissVeil('app_running');
          break;

        case 'PS_FILES_READY':
          this.uploadFiles(site, msg.files, msg.chat);
          break;

        case 'PS_GENERATION_STATUS':
          if (msg.status === 'complete') {
            this.toast.success('AI generation complete');
            this.saveAndDeploy();
          } else if (msg.status === 'app_ready' || msg.status === 'preview_ready') {
            this.dismissVeil('app_running');
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
  private uploadFiles(site: { id: string; slug: string; business_name: string }, files: Record<string, string>, chat?: { messages: unknown[]; description?: string; exportDate?: string }): void {
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
      error: (err: unknown) => {
        this.saving.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        const message = e?.error?.error?.message || e?.error?.message || 'Unknown error';
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
