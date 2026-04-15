import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { interval, takeWhile, switchMap, forkJoin, of } from 'rxjs';
import { ApiService, LogEntry } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/** Ordered pipeline steps for progress display */
const PIPELINE_STEPS = [
  { action: 'workflow.started', label: 'Starting build pipeline...', step: 1 },
  { action: 'workflow.step.profile_research_started', label: 'Researching your business...', step: 2 },
  { action: 'workflow.step.profile_research_complete', label: 'Profile research complete', step: 2 },
  { action: 'workflow.step.parallel_research_started', label: 'Analyzing brand, social presence, and images...', step: 3 },
  { action: 'workflow.step.parallel_research_complete', label: 'Research complete', step: 3 },
  { action: 'workflow.step.structure_plan_started', label: 'Planning site structure...', step: 4 },
  { action: 'workflow.step.structure_plan_complete', label: 'Structure planned', step: 4 },
  { action: 'workflow.step.multipage_generation_started', label: 'Generating pages...', step: 5 },
  { action: 'workflow.step.multipage_generation_complete', label: 'Pages generated', step: 5 },
  { action: 'workflow.step.html_generation_started', label: 'Generating website...', step: 5 },
  { action: 'workflow.step.html_generation_complete', label: 'Website generated', step: 5 },
  { action: 'workflow.step.legal_scoring_started', label: 'Running quality checks...', step: 6 },
  { action: 'workflow.step.legal_and_scoring_complete', label: 'Quality checks passed', step: 6 },
  { action: 'workflow.step.optimization_started', label: 'Optimizing and uploading...', step: 7 },
  { action: 'workflow.step.upload_started', label: 'Uploading files...', step: 7 },
  { action: 'workflow.step.upload_to_r2_complete', label: 'Files uploaded', step: 7 },
  { action: 'workflow.completed', label: 'Your site is live!', step: 8 },
] as const;

const TOTAL_STEPS = 8;

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
  statusMessage = signal('Preparing your project...');
  currentStep = signal(1);
  totalSteps = TOTAL_STEPS;
  alive = true;

  stepProgress = computed(() => {
    const current = this.currentStep();
    return `Step ${current} of ${this.totalSteps}`;
  });

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
    interval(3000)
      .pipe(
        takeWhile(() => this.alive),
        switchMap(() => {
          const site$ = this.api.getSite(this.siteId);
          const logs$ = this.api.getSiteLogs(this.siteId, 50).pipe(
            switchMap((r) => of(r)),
          );
          return forkJoin({ site: site$, logs: logs$ });
        })
      )
      .subscribe({
        next: ({ site: siteRes, logs: logsRes }) => {
          const site = siteRes.data;
          this.status.set(site.status);

          // Update status message from latest log
          const logs = logsRes?.data || [];
          this.updateStatusFromLogs(logs, site.status);

          // When site is published, show success state with action buttons
          if (site.status === 'published') {
            this.alive = false;
            this.statusMessage.set('Your site is live!');
            this.currentStep.set(TOTAL_STEPS);
            this.status.set('published');
            this.toast.success('Your site is live!');
            return;
          }

          if (site.status === 'error') {
            this.alive = false;
            this.statusMessage.set('Build failed. Please try again.');
            this.toast.error('Build failed.');
          }
        },
        error: () => { /* retry next interval */ },
      });
  }

  private updateStatusFromLogs(logs: LogEntry[], siteStatus: string): void {
    const logActions = new Set(logs.map((l) => l.action));

    // Find the latest matching pipeline step
    let latestStep = 1;
    let latestLabel = 'Preparing your project...';

    for (const pipelineStep of PIPELINE_STEPS) {
      if (logActions.has(pipelineStep.action)) {
        if (pipelineStep.step >= latestStep) {
          latestStep = pipelineStep.step;
          latestLabel = pipelineStep.label;
        }
      }
    }

    // Fallback: infer from site status
    if (latestStep === 1 && siteStatus !== 'building') {
      const statusMap: Record<string, { step: number; label: string }> = {
        collecting: { step: 2, label: 'Researching your business...' },
        imaging: { step: 3, label: 'Generating images and assets...' },
        generating: { step: 5, label: 'Generating pages...' },
        uploading: { step: 7, label: 'Uploading files...' },
        published: { step: 8, label: 'Your site is live!' },
      };
      const mapped = statusMap[siteStatus];
      if (mapped) {
        latestStep = mapped.step;
        latestLabel = mapped.label;
      }
    }

    this.currentStep.set(latestStep);
    this.statusMessage.set(latestLabel);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  goAdmin(): void {
    this.router.navigate(['/admin']);
  }

  viewSite(): void {
    window.location.href = `https://${this.slug}.projectsites.dev`;
  }

  editWithAI(): void {
    this.router.navigate(['/editor', this.slug]);
  }
}
