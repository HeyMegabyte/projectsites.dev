import { Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';

interface DeleteConfirmData {
  siteId: string;
  siteName: string;
  hasPaidPlan: boolean;
}

@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [DialogShellComponent, FormsModule],
  template: `
    <app-dialog-shell (closed)="dialogRef.close(false)">
      <span dialogIcon>
        <svg class="text-red-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </span>
      <span dialogTitle>Delete Site</span>

      <div class="p-6 space-y-5">
        <p class="text-[0.88rem] text-text-secondary leading-relaxed">
          Are you sure you want to delete <strong class="text-white">{{ data.siteName }}</strong>?
          This action cannot be undone. All files, domains, and build history will be permanently removed.
        </p>

        @if (data.hasPaidPlan) {
          <label class="flex items-start gap-3 p-4 rounded-xl bg-red-500/[0.05] border border-red-500/[0.12] cursor-pointer hover:border-red-500/20 transition-colors">
            <input type="checkbox" [(ngModel)]="cancelSub"
                   class="mt-0.5 w-4 h-4 rounded border-white/20 bg-transparent accent-red-400" />
            <div>
              <div class="text-[0.82rem] font-medium text-white">Also cancel subscription</div>
              <div class="text-[0.72rem] text-text-secondary mt-0.5">Stop billing for this site immediately.</div>
            </div>
          </label>
        }
      </div>

      <div dialogFooter class="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3">
        <button class="btn-ghost text-sm" (click)="dialogRef.close(false)" [disabled]="deleting()">Cancel</button>
        <button
          class="px-5 py-2 rounded-xl bg-red-500/20 text-red-400 font-semibold text-sm border border-red-500/20 hover:bg-red-500/30 hover:border-red-500/30 transition-all disabled:opacity-50"
          [disabled]="deleting()"
          (click)="confirmDelete()"
        >
          @if (deleting()) { Deleting... } @else { Delete Site }
        </button>
      </div>
    </app-dialog-shell>
  `,
})
export class DeleteConfirmDialogComponent {
  data = inject<DeleteConfirmData>(DIALOG_DATA);
  dialogRef = inject(DialogRef);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  cancelSub = false;
  deleting = signal(false);

  confirmDelete(): void {
    this.deleting.set(true);
    this.api.deleteSiteWithOptions(this.data.siteId, this.cancelSub).subscribe({
      next: () => {
        this.toast.success(`"${this.data.siteName}" has been deleted.`);
        this.dialogRef.close(true);
      },
      error: () => {
        this.deleting.set(false);
      },
    });
  }
}
