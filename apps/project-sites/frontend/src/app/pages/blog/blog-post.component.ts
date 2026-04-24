import { Component, type OnInit, type OnDestroy, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogService, type BlogPost } from '../../services/blog.service';

interface TocItem {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

/**
 * Individual blog post page with rendered markdown, table of contents,
 * share buttons, and BlogPosting JSON-LD structured data.
 *
 * @remarks
 * Converts markdown-style content to HTML using a lightweight parser.
 * Injects BlogPosting JSON-LD into the document head for SEO.
 * Table of contents is extracted from H2/H3 headings on desktop.
 *
 * @example
 * ```html
 * <app-blog-post />
 * ```
 */
@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (post()) {
      <section class="post-page">
        <div class="post-layout">
          <!-- Table of Contents (desktop sidebar) -->
          <aside class="toc-sidebar">
            <div class="toc-sticky">
              <h3 class="toc-title">Contents</h3>
              <nav class="toc-nav">
                @for (item of toc(); track item.id) {
                  <a
                    [href]="'#' + item.id"
                    class="toc-link"
                    [class.toc-h3]="item.level === 3"
                  >{{ item.text }}</a>
                }
              </nav>
            </div>
          </aside>

          <!-- Main content -->
          <article class="post-main">
            <a routerLink="/blog" class="back-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              Back to Blog
            </a>

            <header class="post-header">
              <div class="post-category">{{ post()!.category }}</div>
              <h1>{{ post()!.title }}</h1>
              <div class="post-meta">
                <span class="post-author">{{ post()!.author }}</span>
                <span class="meta-dot"></span>
                <span>{{ post()!.date }}</span>
                <span class="meta-dot"></span>
                <span>{{ post()!.readingTime }}</span>
              </div>
            </header>

            <div class="post-content" [innerHTML]="renderedHtml()"></div>

            <!-- Share buttons -->
            <div class="share-section">
              <span class="share-label">Share this article</span>
              <div class="share-buttons">
                <button class="share-btn" (click)="copyLink()" [attr.aria-label]="'Copy link'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  {{ copied() ? 'Copied' : 'Copy Link' }}
                </button>
                <a [href]="twitterUrl()" target="_blank" rel="noopener noreferrer" class="share-btn" aria-label="Share on X">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  X / Twitter
                </a>
                <a [href]="linkedinUrl()" target="_blank" rel="noopener noreferrer" class="share-btn" aria-label="Share on LinkedIn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  LinkedIn
                </a>
              </div>
            </div>
          </article>
        </div>
      </section>
    } @else {
      <section class="post-page">
        <div class="not-found">
          <h1>Post not found</h1>
          <p>The blog post you are looking for does not exist.</p>
          <a routerLink="/blog" class="back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            Back to Blog
          </a>
        </div>
      </section>
    }

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-bottom">
          <span>&copy; 2026 <a href="https://megabyte.space" target="_blank" rel="noopener noreferrer">Megabyte LLC</a></span>
          <span>
            <a routerLink="/privacy">Privacy</a> |
            <a routerLink="/terms">Terms</a> |
            <a routerLink="/blog">Blog</a>
          </span>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

    .post-page {
      min-height: calc(100vh - 60px - 120px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
    }

    .post-layout {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 48px;
    }
    @media (min-width: 1024px) {
      .post-layout {
        grid-template-columns: 220px 1fr;
      }
    }

    /* ── Table of Contents ─────── */
    .toc-sidebar {
      display: none;
    }
    @media (min-width: 1024px) {
      .toc-sidebar { display: block; }
    }
    .toc-sticky {
      position: sticky;
      top: 100px;
    }
    .toc-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #64748b;
      margin: 0 0 16px;
    }
    .toc-nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-left: 1px solid rgba(0, 229, 255, 0.1);
      padding-left: 16px;
    }
    .toc-link {
      font-size: 0.8rem;
      color: #94a3b8;
      text-decoration: none;
      line-height: 1.5;
      transition: color 0.2s;
    }
    .toc-link:hover {
      color: #00E5FF;
    }
    .toc-h3 {
      padding-left: 12px;
      font-size: 0.76rem;
    }

    /* ── Back link ─────── */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: #00E5FF;
      text-decoration: none;
      margin-bottom: 32px;
      transition: all 0.2s;
      font-weight: 500;
    }
    .back-link:hover {
      opacity: 0.8;
      transform: translateX(-3px);
    }

    /* ── Post header ─────── */
    .post-header {
      margin-bottom: 40px;
      animation: fadeInUp 0.5s ease;
    }
    .post-category {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #00E5FF;
      padding: 4px 12px;
      background: rgba(0, 229, 255, 0.08);
      border: 1px solid rgba(0, 229, 255, 0.15);
      border-radius: 20px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.3;
      margin: 0 0 16px;
      color: #f0f0f8;
    }
    .post-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 0.82rem;
      color: #94a3b8;
    }
    .post-author { font-weight: 600; color: #cbd5e1; }
    .meta-dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: #475569;
    }

    /* ── Post content ─────── */
    .post-content {
      color: #cbd5e1;
      line-height: 1.85;
      font-size: 0.95rem;
      animation: fadeInUp 0.6s ease 0.1s both;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.5), rgba(8, 8, 32, 0.7));
      border: 1px solid rgba(0, 229, 255, 0.06);
      border-radius: 20px;
      padding: 40px 36px;
    }
    @media (max-width: 640px) {
      .post-content { padding: 24px 20px; border-radius: 14px; }
    }

    :host ::ng-deep .post-content h2 {
      color: #fff;
      font-size: 1.3rem;
      font-weight: 800;
      margin-top: 40px;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(0, 229, 255, 0.1);
      letter-spacing: -0.01em;
    }
    :host ::ng-deep .post-content h2:first-child {
      margin-top: 0;
    }
    :host ::ng-deep .post-content h3 {
      color: #f0f0f8;
      font-size: 1.08rem;
      font-weight: 700;
      margin-top: 28px;
      margin-bottom: 12px;
      padding-left: 14px;
      border-left: 2px solid rgba(0, 229, 255, 0.25);
    }
    :host ::ng-deep .post-content p {
      margin-bottom: 16px;
    }
    :host ::ng-deep .post-content ul, :host ::ng-deep .post-content ol {
      margin-bottom: 20px;
      padding-left: 0;
      list-style: none;
    }
    :host ::ng-deep .post-content li {
      margin-bottom: 6px;
      padding: 8px 14px 8px 30px;
      position: relative;
      line-height: 1.7;
      background: rgba(0, 229, 255, 0.015);
      border-radius: 8px;
    }
    :host ::ng-deep .post-content li::before {
      content: '';
      position: absolute;
      left: 12px;
      top: 16px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00E5FF;
      box-shadow: 0 0 6px rgba(0, 229, 255, 0.4);
    }
    :host ::ng-deep .post-content strong {
      color: #f0f0f8;
      font-weight: 700;
    }
    :host ::ng-deep .post-content a {
      color: #00E5FF;
      text-decoration: none;
      border-bottom: 1px solid rgba(0, 229, 255, 0.2);
      transition: border-color 0.2s;
    }
    :host ::ng-deep .post-content a:hover {
      border-bottom-color: #00E5FF;
    }

    /* ── Share section ─────── */
    .share-section {
      margin-top: 40px;
      padding-top: 32px;
      border-top: 1px solid rgba(0, 229, 255, 0.08);
      animation: fadeInUp 0.6s ease 0.2s both;
    }
    .share-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 14px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .share-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .share-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      font-size: 0.82rem;
      font-weight: 500;
      color: #cbd5e1;
      background: rgba(0, 229, 255, 0.05);
      border: 1px solid rgba(0, 229, 255, 0.12);
      border-radius: 10px;
      text-decoration: none;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.2s;
    }
    .share-btn:hover {
      border-color: rgba(0, 229, 255, 0.3);
      background: rgba(0, 229, 255, 0.08);
      color: #fff;
    }
    .share-btn:active { opacity: 0.7; }

    /* ── Not found ─────── */
    .not-found {
      text-align: center;
      padding: 80px 0;
    }
    .not-found h1 {
      background: none;
      -webkit-text-fill-color: #f0f0f8;
    }
    .not-found p {
      color: #94a3b8;
      margin-bottom: 24px;
    }

    /* ── Footer ─────── */
    .site-footer {
      padding: 36px 24px 28px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .footer-inner { max-width: 1100px; margin: 0 auto; }
    .footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.8rem;
      color: #64748b;
    }
    .footer-bottom a {
      color: #64748b;
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-bottom a:hover { color: #00E5FF; }
    @media (max-width: 640px) {
      .footer-bottom { flex-direction: column; text-align: center; }
    }
  `],
})
export class BlogPostComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private blogService = inject(BlogService);
  private platformId = inject(PLATFORM_ID);

  post = signal<BlogPost | undefined>(undefined);
  renderedHtml = signal('');
  toc = signal<TocItem[]>([]);
  copied = signal(false);

  private jsonLdScript: HTMLScriptElement | null = null;

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const foundPost = this.blogService.getPostBySlug(slug);
    this.post.set(foundPost);

    if (foundPost) {
      const html = this.markdownToHtml(foundPost.content);
      this.renderedHtml.set(html);
      this.toc.set(this.extractToc(html));
      this.injectJsonLd(foundPost);
    }
  }

  ngOnDestroy(): void {
    if (this.jsonLdScript && isPlatformBrowser(this.platformId)) {
      this.jsonLdScript.remove();
    }
  }

  /** Build the current page URL for sharing. */
  private currentUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      return window.location.href;
    }
    return `https://projectsites.dev/blog/${this.post()?.slug ?? ''}`;
  }

  twitterUrl(): string {
    const p = this.post();
    if (!p) return '#';
    const text = encodeURIComponent(p.title);
    const url = encodeURIComponent(this.currentUrl());
    return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
  }

  linkedinUrl(): string {
    const url = encodeURIComponent(this.currentUrl());
    return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
  }

  copyLink(): void {
    if (isPlatformBrowser(this.platformId)) {
      navigator.clipboard.writeText(this.currentUrl()).then(() => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      });
    }
  }

  /**
   * Convert markdown-style content to sanitized HTML.
   *
   * @remarks
   * Handles headings (##, ###), bold (**text**), lists (- item),
   * links, and paragraphs. Each heading gets a stable id for TOC anchoring.
   */
  private markdownToHtml(md: string): string {
    const lines = md.split('\n');
    const result: string[] = [];
    let inList = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        if (inList) { result.push('</ul>'); inList = false; }
        continue;
      }

      // Headings
      if (line.startsWith('### ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        const text = line.slice(4);
        const id = this.slugify(text);
        result.push(`<h3 id="${id}">${this.inlineFormat(text)}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        const text = line.slice(3);
        const id = this.slugify(text);
        result.push(`<h2 id="${id}">${this.inlineFormat(text)}</h2>`);
        continue;
      }

      // Unordered lists
      if (line.startsWith('- ')) {
        if (!inList) { result.push('<ul>'); inList = true; }
        result.push(`<li>${this.inlineFormat(line.slice(2))}</li>`);
        continue;
      }

      // Paragraph
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<p>${this.inlineFormat(line)}</p>`);
    }
    if (inList) result.push('</ul>');
    return result.join('\n');
  }

  /** Apply inline formatting: bold, links. */
  private inlineFormat(text: string): string {
    // Bold
    let out = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Links
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  /** Generate a URL-safe slug from heading text. */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Extract table of contents items from rendered HTML heading tags. */
  private extractToc(html: string): TocItem[] {
    const items: TocItem[] = [];
    const regex = /<h([23]) id="([^"]+)">(.+?)<\/h[23]>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      items.push({
        level: parseInt(match[1], 10),
        id: match[2],
        text: match[3].replace(/<[^>]+>/g, ''),
      });
    }
    return items;
  }

  /** Inject BlogPosting JSON-LD structured data into the document head. */
  private injectJsonLd(p: BlogPost): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.excerpt,
      datePublished: p.date,
      author: {
        '@type': 'Person',
        name: p.author,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Project Sites',
        url: 'https://projectsites.dev',
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `https://projectsites.dev/blog/${p.slug}`,
      },
    };

    this.jsonLdScript = document.createElement('script');
    this.jsonLdScript.type = 'application/ld+json';
    this.jsonLdScript.textContent = JSON.stringify(ld);
    document.head.appendChild(this.jsonLdScript);
  }
}
