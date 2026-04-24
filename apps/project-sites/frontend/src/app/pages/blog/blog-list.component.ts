import { Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BlogService, type BlogPost } from '../../services/blog.service';

/**
 * Blog listing page displaying all posts as responsive cards.
 *
 * @remarks
 * Renders a grid of blog post cards with title, excerpt (150 chars),
 * date, reading time, and category tag. Responsive: 1 col mobile,
 * 2 col tablet, 3 col desktop. Dark theme with cyan accent hover.
 *
 * @example
 * ```html
 * <app-blog-list />
 * ```
 */
@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="blog-page">
      <div class="blog-inner">
        <div class="blog-header">
          <h1>Blog</h1>
          <p class="blog-subtitle">Tips, updates, and insights for small business owners</p>
        </div>

        <div class="blog-grid">
          @for (post of posts(); track post.slug) {
            <a [routerLink]="['/blog', post.slug]" class="blog-card">
              <div class="card-category">{{ post.category }}</div>
              <h2 class="card-title">{{ post.title }}</h2>
              <p class="card-excerpt">{{ truncate(post.excerpt, 150) }}</p>
              <div class="card-meta">
                <span class="card-date">{{ post.date }}</span>
                <span class="card-dot"></span>
                <span class="card-reading-time">{{ post.readingTime }}</span>
              </div>
            </a>
          }
        </div>
      </div>
    </section>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-bottom">
          <span>&copy; 2026 <a href="https://megabyte.space" target="_blank" rel="noopener noreferrer">Megabyte LLC</a></span>
          <span>
            <a routerLink="/privacy">Privacy</a> |
            <a routerLink="/terms">Terms</a> |
            <a routerLink="/blog">Blog</a> |
            <a routerLink="/changelog">Changelog</a> |
            <a routerLink="/status">Status</a>
          </span>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

    .blog-page {
      min-height: calc(100vh - 60px - 120px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
    }
    .blog-inner {
      max-width: 1100px;
      margin: 0 auto;
    }

    .blog-header {
      text-align: center;
      margin-bottom: 56px;
      animation: fadeInUp 0.5s ease;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 0 12px;
      background: linear-gradient(135deg, #fff 0%, rgba(0, 229, 255, 0.85) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .blog-subtitle {
      font-size: 1.05rem;
      color: #94a3b8;
      margin: 0;
      font-weight: 400;
    }

    .blog-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 28px;
    }
    @media (min-width: 640px) {
      .blog-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 1024px) {
      .blog-grid { grid-template-columns: repeat(3, 1fr); }
    }

    .blog-card {
      display: flex;
      flex-direction: column;
      padding: 28px 24px;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.6), rgba(8, 8, 32, 0.8));
      border: 1px solid rgba(0, 229, 255, 0.06);
      border-radius: 16px;
      text-decoration: none;
      color: inherit;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: fadeInUp 0.5s ease both;
      cursor: pointer;
    }
    .blog-card:nth-child(1) { animation-delay: 0.1s; }
    .blog-card:nth-child(2) { animation-delay: 0.2s; }
    .blog-card:nth-child(3) { animation-delay: 0.3s; }

    .blog-card:hover {
      border-color: rgba(0, 229, 255, 0.3);
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 229, 255, 0.05);
    }
    .blog-card:active { transform: translateY(-1px); }

    .card-category {
      display: inline-block;
      align-self: flex-start;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #00E5FF;
      padding: 4px 12px;
      background: rgba(0, 229, 255, 0.08);
      border: 1px solid rgba(0, 229, 255, 0.15);
      border-radius: 20px;
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #f0f0f8;
      margin: 0 0 12px;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }

    .card-excerpt {
      font-size: 0.88rem;
      color: #94a3b8;
      line-height: 1.7;
      margin: 0 0 20px;
      flex: 1;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: #64748b;
    }
    .card-dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: #475569;
    }

    /* Footer */
    .site-footer {
      padding: 36px 24px 28px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .footer-inner {
      max-width: 1100px;
      margin: 0 auto;
    }
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
    .footer-bottom a:hover {
      color: #00E5FF;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    @media (max-width: 640px) {
      .footer-bottom { flex-direction: column; text-align: center; }
    }
  `],
})
export class BlogListComponent implements OnInit {
  private blogService = inject(BlogService);
  posts = signal<readonly BlogPost[]>([]);

  ngOnInit(): void {
    this.posts.set(this.blogService.getAllPosts());
  }

  /** Truncate text to a maximum character count, appending ellipsis if needed. */
  truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max).trimEnd() + '...';
  }
}
