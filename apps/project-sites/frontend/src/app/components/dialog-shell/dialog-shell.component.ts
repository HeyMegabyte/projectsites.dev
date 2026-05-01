import { Component, inject, output, HostListener, type AfterViewInit, type OnDestroy, ElementRef } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { A11yModule, ConfigurableFocusTrapFactory, type ConfigurableFocusTrap } from '@angular/cdk/a11y';

@Component({
  selector: 'app-dialog-shell',
  standalone: true,
  imports: [A11yModule],
  template: `
    <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4 animate__animated animate__fadeIn animate__faster" role="dialog" aria-modal="true" (click)="onBackdropClick($event)">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

      <!-- Dialog panel -->
      <div class="dialog-panel relative w-full bg-[rgba(10,10,30,0.97)] border border-white/[0.08] rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.5),0_0_80px_rgba(0,229,255,0.04)] overflow-hidden animate__animated animate__zoomIn animate__faster max-h-[90vh] flex flex-col"
           [style.max-width]="maxWidth">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <ng-content select="[dialogIcon]"></ng-content>
            <h2 class="text-lg font-bold text-white m-0 truncate">
              <ng-content select="[dialogTitle]"></ng-content>
            </h2>
            <ng-content select="[dialogBadge]"></ng-content>
          </div>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-white hover:bg-white/[0.06] transition-all flex-shrink-0"
            (click)="close()"
            aria-label="Close dialog"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto">
          <ng-content></ng-content>
        </div>

        <!-- Footer (optional) -->
        <ng-content select="[dialogFooter]"></ng-content>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    /* Tighter, premium timing for animate.css overrides */
    .animate__faster { --animate-duration: 0.25s; }
  `],
})
export class DialogShellComponent implements AfterViewInit, OnDestroy {
  private dialogRef = inject(DialogRef, { optional: true });
  private el = inject(ElementRef);
  private focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private focusTrap?: ConfigurableFocusTrap;

  maxWidth = '640px';
  closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  ngAfterViewInit(): void {
    const panel = this.el.nativeElement.querySelector('.dialog-panel');
    if (panel) {
      this.focusTrap = this.focusTrapFactory.create(panel);
      this.focusTrap.focusInitialElementWhenReady();
    }
  }

  ngOnDestroy(): void {
    this.focusTrap?.destroy();
  }

  close(): void {
    this.closed.emit();
    this.dialogRef?.close();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('fixed')) {
      this.close();
    }
  }
}
