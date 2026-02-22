import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { interval, takeWhile, switchMap } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

interface BuildStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

@Component({
  selector: 'app-waiting',
  standalone: true,
  templateUrl: './waiting.component.html',
  styleUrl: './waiting.component.scss',
})
export class WaitingComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  siteId = '';
  slug = '';
  status = signal('building');
  alive = true;
  steps = signal<BuildStep[]>([
    { label: 'Initializing build pipeline', status: 'active' },
    { label: 'Researching business profile', status: 'pending' },
    { label: 'Analyzing brand & social presence', status: 'pending' },
    { label: 'Generating website content', status: 'pending' },
    { label: 'Creating legal pages', status: 'pending' },
    { label: 'Uploading to CDN', status: 'pending' },
    { label: 'Publishing site', status: 'pending' },
  ]);

  ngOnInit(): void {
    this.siteId = this.route.snapshot.queryParams['id'] || '';
    this.slug = this.route.snapshot.queryParams['slug'] || '';

    if (!this.siteId) {
      this.router.navigate(['/']);
      return;
    }

    this.startPolling();
  }

  ngOnDestroy(): void {
    this.alive = false;
  }

  private startPolling(): void {
    interval(10000)
      .pipe(
        takeWhile(() => this.alive),
        switchMap(() => this.api.getSite(this.siteId))
      )
      .subscribe({
        next: (res) => {
          const site = res.data;
          this.status.set(site.status);
          this.updateSteps(site.status);

          if (site.status === 'published') {
            this.alive = false;
            this.toast.success('Your site is live!');
            setTimeout(() => {
              window.location.href = `https://${this.slug}-sites.megabyte.space`;
            }, 3000);
          }

          if (site.status === 'error') {
            this.alive = false;
            this.toast.error('Build failed. Please try again.');
          }
        },
        error: () => {
          this.toast.error('Lost connection. Retrying...');
        },
      });
  }

  private updateSteps(status: string): void {
    const stepMap: Record<string, number> = {
      queued: 0,
      building: 1,
      generating: 3,
      uploading: 5,
      published: 6,
      error: -1,
    };

    const activeIndex = stepMap[status] ?? 1;
    this.steps.update((steps) =>
      steps.map((s, i) => ({
        ...s,
        status: status === 'error' ? 'error' : i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
      }))
    );
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  goAdmin(): void {
    this.router.navigate(['/admin']);
  }
}
