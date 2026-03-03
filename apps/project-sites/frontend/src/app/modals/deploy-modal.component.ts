import { Component, inject, signal } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonProgressBar, IonSelect, IonSelectOption,
  ModalController,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-deploy-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonProgressBar,
    IonSelect, IonSelectOption,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Deploy ZIP</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="deploy-zone" (dragover)="onDragOver($event)" (drop)="onDrop($event)"
           [class.dragging]="dragging()">
        @if (!selectedFile()) {
          <div class="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Drag & drop a ZIP file here</p>
            <span class="or-text">or</span>
            <ion-button fill="outline" (click)="fileInput.click()">Browse Files</ion-button>
            <input #fileInput type="file" accept=".zip" (change)="onFileSelect($event)" hidden />
          </div>
        } @else {
          <div class="selected-file-info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
            </svg>
            <span>{{ selectedFile()!.name }}</span>
            <span class="file-size">({{ formatSize(selectedFile()!.size) }})</span>
            <ion-button size="small" fill="clear" color="danger" (click)="clearFile()">Remove</ion-button>
          </div>

          @if (folders().length > 1) {
            <div class="folder-select">
              <label>Select root folder:</label>
              <ion-select [(ngModel)]="selectedFolder" interface="popover">
                @for (folder of folders(); track folder) {
                  <ion-select-option [value]="folder">{{ folder || '(root)' }}</ion-select-option>
                }
              </ion-select>
            </div>
          }
        }
      </div>

      @if (deploying()) {
        <ion-progress-bar type="indeterminate" color="primary"></ion-progress-bar>
        <p class="deploy-status">Uploading and deploying...</p>
      }

      <ion-button
        expand="block"
        fill="solid"
        [disabled]="!selectedFile() || deploying()"
        (click)="submitDeploy()"
      >
        @if (deploying()) { Deploying... } @else { Deploy }
      </ion-button>
    </ion-content>
  `,
  styles: [`
    .deploy-zone {
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      padding: 40px 20px;
      text-align: center;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 20px;

      &.dragging {
        border-color: var(--accent);
        background: var(--accent-dim);
      }
    }
    .drop-content {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      svg { color: var(--text-muted); }
      p { color: var(--text-secondary); font-size: 0.95rem; }
      .or-text { color: var(--text-muted); font-size: 0.8rem; }
    }
    .selected-file-info {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      svg { color: var(--accent); }
      span { font-size: 0.9rem; }
      .file-size { color: var(--text-muted); font-size: 0.8rem; }
    }
    .folder-select {
      margin-top: 16px;
      label { font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px; }
    }
    .deploy-status { text-align: center; color: var(--text-muted); font-size: 0.85rem; margin: 12px 0; }
    ion-progress-bar { margin: 12px 0; }
  `],
})
export class DeployModalComponent {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  selectedFile = signal<File | null>(null);
  folders = signal<string[]>([]);
  selectedFolder = '';
  dragging = signal(false);
  deploying = signal(false);

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file && file.name.endsWith('.zip')) {
      this.setFile(file);
    } else {
      this.toast.error('Please upload a ZIP file');
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setFile(file);
  }

  private async setFile(file: File): Promise<void> {
    this.selectedFile.set(file);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      const topFolders = new Set<string>();
      topFolders.add('');
      zip.forEach((path) => {
        const parts = path.split('/');
        if (parts.length > 1) topFolders.add(parts[0]);
      });
      this.folders.set(Array.from(topFolders));
      if (this.folders().length > 1) {
        this.selectedFolder = this.folders()[1] || '';
      }
    } catch {
      this.folders.set([]);
    }
  }

  clearFile(): void {
    this.selectedFile.set(null);
    this.folders.set([]);
    this.selectedFolder = '';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  submitDeploy(): void {
    const file = this.selectedFile();
    if (!file) return;
    this.deploying.set(true);
    const formData = new FormData();
    formData.append('file', file);
    if (this.selectedFolder) {
      formData.append('folder', this.selectedFolder);
    }
    this.api.deployZip(this.site.id, formData).subscribe({
      next: () => {
        this.deploying.set(false);
        this.toast.success('Deploy successful!');
        this.modalCtrl.dismiss(true, 'deployed');
      },
      error: (err) => {
        this.deploying.set(false);
        this.toast.error(err?.error?.message || 'Deploy failed');
      },
    });
  }
}
