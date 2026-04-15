import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map, mergeMap } from 'rxjs';

interface PageMeta {
  title: string;
  description: string;
  url?: string;
}

const PAGE_META: Record<string, PageMeta> = {
  '': {
    title: 'Project Sites - Your Website, Handled. Finally.',
    description: 'AI-powered websites for small businesses. Search for your business and get a professional site in minutes — hosting, updates, and everything included.',
  },
  'create': {
    title: 'Create Your Website - Project Sites',
    description: 'Tell us about your business and our AI builds a professional website in minutes. No coding required.',
  },
  'signin': {
    title: 'Sign In - Project Sites',
    description: 'Sign in to manage your AI-generated website. Magic link, no password needed.',
  },
  'waiting': {
    title: 'Building Your Site - Project Sites',
    description: 'Your AI-generated website is being built. Watch the progress in real time.',
  },
  'admin': {
    title: 'Dashboard - Project Sites',
    description: 'Manage your websites, domains, files, and billing from one dashboard.',
  },
  'privacy': {
    title: 'Privacy Policy - Project Sites',
    description: 'How Project Sites collects, uses, and protects your personal information.',
  },
  'terms': {
    title: 'Terms of Service - Project Sites',
    description: 'Terms and conditions for using the Project Sites website builder platform.',
  },
  'content': {
    title: 'Content Policy - Project Sites',
    description: 'Acceptable use and content guidelines for websites built on Project Sites.',
  },
};

const BASE_URL = 'https://projectsites.dev';
const OG_IMAGE = 'https://projectsites.dev/og-image.png';

@Injectable({ providedIn: 'root' })
export class MetaService {
  private title = inject(Title);
  private meta = inject(Meta);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  init(): void {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.route),
      map(route => {
        while (route.firstChild) route = route.firstChild;
        return route;
      }),
      mergeMap(route => route.url),
    ).subscribe(segments => {
      const path = segments.map(s => s.path).join('/') || '';
      const pageMeta = PAGE_META[path] || PAGE_META[''];
      this.updateMeta(pageMeta, path);
    });
  }

  private updateMeta(page: PageMeta, path: string): void {
    const url = `${BASE_URL}/${path}`;

    this.title.setTitle(page.title);

    // Standard SEO
    this.meta.updateTag({ name: 'description', content: page.description });

    // Open Graph (Facebook, LinkedIn, Discord, Slack, iMessage, WhatsApp, Telegram)
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: OG_IMAGE });
    this.meta.updateTag({ property: 'og:image:width', content: '1200' });
    this.meta.updateTag({ property: 'og:image:height', content: '630' });

    // Twitter / X
    this.meta.updateTag({ name: 'twitter:title', content: page.title });
    this.meta.updateTag({ name: 'twitter:description', content: page.description });
    this.meta.updateTag({ name: 'twitter:image', content: OG_IMAGE });

    // Update canonical
    const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (link) {
      link.href = url;
    }
  }
}
