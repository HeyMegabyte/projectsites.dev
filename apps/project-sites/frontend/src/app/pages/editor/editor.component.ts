import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Site } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);

  site = signal<Site | null>(null);
  iframeUrl = signal<SafeResourceUrl | null>(null);
  boltReady = signal(false);
  boltGenerating = signal(false);
  saving = signal(false);
  slug = '';

  private messageHandler: ((event: MessageEvent) => void) | null = null;

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }

    this.slug = this.route.snapshot.paramMap.get('slug') || '';
    if (!this.slug) {
      this.router.navigate(['/admin']);
      return;
    }

    this.loadSiteAndOpenEditor();
  }

  ngOnDestroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  private loadSiteAndOpenEditor(): void {
    // Find the site by slug from user's sites list
    this.api.listSites().subscribe({
      next: (res) => {
        const site = (res.data || []).find((s: Site) => s.slug === this.slug);
        if (!site) {
          this.toast.error('Site not found');
          this.router.navigate(['/admin']);
          return;
        }
        this.site.set(site);

        // Build the editor URL: if chat exists, use importChatFrom to restore session
        const chatUrl = `/api/sites/by-slug/${this.slug}/chat`;
        const editorBase = `https://editor.projectsites.dev`;
        const params = new URLSearchParams({
          embedded: 'true',
          slug: this.slug,
          importChatFrom: `${window.location.origin}${chatUrl}`,
        });
        const editorUrl = `${editorBase}/?${params.toString()}`;
        this.iframeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(editorUrl));

        this.setupMessageListener(site);
      },
      error: () => {
        this.toast.error('Failed to load site');
        this.router.navigate(['/admin']);
      },
    });
  }

  private setupMessageListener(site: Site): void {
    this.messageHandler = (event: MessageEvent) => {
      const allowedOrigins = ['https://editor.projectsites.dev', 'http://localhost:5173'];
      if (!allowedOrigins.includes(event.origin)) return;
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('PS_')) return;

      if (msg.type === 'PS_BOLT_READY') {
        this.boltReady.set(true);
      } else if (msg.type === 'PS_GENERATION_STATUS') {
        this.boltGenerating.set(msg.status === 'generating');
        if (msg.status === 'complete') {
          this.toast.success('AI generation complete');
          // Auto-save after generation completes
          this.saveAndDeploy();
        } else if (msg.status === 'error') {
          this.toast.error('AI generation failed: ' + (msg.error || 'Unknown error'));
        }
      } else if (msg.type === 'PS_FILES_READY') {
        this.uploadFiles(site, msg.files, msg.chat);
      }
    };
    window.addEventListener('message', this.messageHandler);
  }

  saveAndDeploy(): void {
    const iframe = document.querySelector('.editor-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) { this.toast.error('Editor not ready'); return; }

    this.saving.set(true);
    // Request files AND chat export from bolt.diy
    iframe.contentWindow.postMessage({
      type: 'PS_REQUEST_FILES',
      includeChat: true,
      correlationId: crypto.randomUUID(),
    }, '*');
    this.toast.info('Saving files from editor...');
  }

  private uploadFiles(site: Site, files: Record<string, string>, chat?: { messages: unknown[]; description?: string; exportDate?: string }): void {
    const entries = Object.entries(files);
    if (entries.length === 0) { this.saving.set(false); this.toast.error('No files to save'); return; }

    // Use the bulk publish endpoint
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

  sendPrompt(prompt: string): void {
    const iframe = document.querySelector('.editor-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) { this.toast.error('Editor not ready'); return; }

    iframe.contentWindow.postMessage({
      type: 'PS_SUBMIT_PROMPT',
      prompt,
      siteId: this.site()?.id || '',
      slug: this.slug,
      correlationId: crypto.randomUUID(),
    }, '*');
    this.boltGenerating.set(true);
  }

  openFullscreen(): void {
    window.open(`https://editor.projectsites.dev/?slug=${this.slug}`, '_blank');
  }

  goBack(): void {
    this.router.navigate(['/admin']);
  }
}
