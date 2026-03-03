import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, SiteFile } from '../services/api.service';
import { ToastService } from '../services/toast.service';

interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

@Component({
  selector: 'app-files-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>File Editor</ion-title>
        <ion-buttons slot="end">
          @if (selectedFile()) {
            <ion-button (click)="saveFile()" [disabled]="saving()">
              @if (saving()) { Saving... } @else { Save }
            </ion-button>
          }
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="files-layout">
        <!-- File tree -->
        <div class="file-tree">
          @if (loading()) {
            <div class="tree-loading"><ion-spinner name="crescent"></ion-spinner></div>
          } @else {
            <div class="tree-items">
              @for (node of fileTree(); track node.path) {
                <div class="tree-item" [style.padding-left.px]="getDepth(node.path) * 16 + 12">
                  @if (node.isFolder) {
                    <button class="tree-folder" (click)="toggleFolder(node)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        [style.transform]="node.expanded ? 'rotate(90deg)' : ''">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                      {{ node.name }}
                    </button>
                  } @else {
                    <button class="tree-file" [class.active]="selectedFile()?.path === node.path"
                      (click)="openFile(node)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
                      </svg>
                      {{ node.name }}
                    </button>
                  }
                </div>
              }
            </div>
            <div class="new-file-row">
              <input type="text" class="input-field" placeholder="path/to/new-file.html" [(ngModel)]="newFilePath" />
              <ion-button size="small" fill="solid" (click)="createNewFile()" [disabled]="!newFilePath.trim()">New</ion-button>
            </div>
          }
        </div>

        <!-- Editor -->
        <div class="file-editor">
          @if (selectedFile()) {
            <div class="editor-header">
              <span>{{ selectedFile()!.path }}</span>
            </div>
            <textarea
              class="code-editor"
              [(ngModel)]="editorContent"
              spellcheck="false"
            ></textarea>
          } @else {
            <div class="editor-empty">
              <p>Select a file to edit</p>
            </div>
          }
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .files-layout { display: flex; height: calc(100vh - 56px); }
    .file-tree {
      width: 280px; min-width: 280px; border-right: 1px solid var(--border);
      display: flex; flex-direction: column; overflow-y: auto;
      background: var(--bg-secondary);
    }
    .tree-loading { padding: 40px; text-align: center; }
    .tree-items { flex: 1; overflow-y: auto; padding: 8px 0; }
    .tree-item { display: flex; }
    .tree-folder, .tree-file {
      display: flex; align-items: center; gap: 6px; width: 100%;
      padding: 6px 12px; border: none; background: none;
      color: var(--text-secondary); font-size: 0.82rem; cursor: pointer;
      text-align: left; font-family: 'Menlo', 'Consolas', monospace;
      transition: background 0.15s, color 0.15s;
      &:hover { background: rgba(80, 165, 219, 0.06); color: var(--text-primary); }
    }
    .tree-folder { font-weight: 600; }
    .tree-file.active { background: var(--accent-dim); color: var(--accent); }
    .tree-file svg { flex-shrink: 0; }
    .tree-folder svg { flex-shrink: 0; transition: transform 0.15s; }
    .new-file-row {
      padding: 8px; border-top: 1px solid var(--border);
      display: flex; gap: 6px;
      .input-field { flex: 1; padding: 6px 10px; font-size: 0.78rem; }
    }
    .file-editor {
      flex: 1; display: flex; flex-direction: column;
      background: var(--bg-primary);
    }
    .editor-header {
      padding: 8px 16px; font-size: 0.78rem; color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      font-family: 'Menlo', 'Consolas', monospace;
    }
    .code-editor {
      flex: 1; width: 100%; border: none; outline: none;
      background: var(--bg-primary); color: var(--text-primary);
      font-family: 'Menlo', 'Consolas', monospace;
      font-size: 0.85rem; line-height: 1.6;
      padding: 16px; resize: none;
      tab-size: 2;
    }
    .editor-empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); font-size: 0.9rem;
    }
  `],
})
export class FilesModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  files = signal<SiteFile[]>([]);
  fileTree = signal<FileNode[]>([]);
  loading = signal(true);
  selectedFile = signal<SiteFile | null>(null);
  editorContent = '';
  saving = signal(false);
  newFilePath = '';

  ngOnInit(): void {
    this.loadFiles();
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  private loadFiles(): void {
    this.loading.set(true);
    this.api.getFiles(this.siteId).subscribe({
      next: (res) => {
        this.files.set(res.data || []);
        this.fileTree.set(this.buildTree(res.data || []));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load files');
      },
    });
  }

  private buildTree(files: SiteFile[]): FileNode[] {
    const nodes: FileNode[] = [];
    const folders = new Set<string>();

    for (const f of files) {
      const parts = f.path.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        if (!folders.has(current)) {
          folders.add(current);
          nodes.push({ name: parts[i], path: current, isFolder: true, expanded: true });
        }
      }
      nodes.push({ name: parts[parts.length - 1], path: f.path, isFolder: false });
    }

    return nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  getDepth(path: string): number {
    return path.split('/').length - 1;
  }

  toggleFolder(node: FileNode): void {
    node.expanded = !node.expanded;
    this.fileTree.update((tree) => {
      return tree.filter((n) => {
        if (n.path === node.path) return true;
        if (!node.expanded && n.path.startsWith(node.path + '/')) return false;
        return true;
      });
    });
    if (node.expanded) {
      this.fileTree.set(this.buildTree(this.files()));
    }
  }

  openFile(node: FileNode): void {
    const file = this.files().find((f) => f.path === node.path);
    if (file) {
      this.selectedFile.set(file);
      this.editorContent = file.content || '';
    }
  }

  saveFile(): void {
    const file = this.selectedFile();
    if (!file) return;
    this.saving.set(true);
    this.api.updateFile(this.siteId, file.path, this.editorContent).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('File saved');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Failed to save file');
      },
    });
  }

  createNewFile(): void {
    if (!this.newFilePath.trim()) return;
    this.saving.set(true);
    this.api.updateFile(this.siteId, this.newFilePath.trim(), '').subscribe({
      next: (res) => {
        this.saving.set(false);
        const newFile = res.data;
        this.files.update((f) => [...f, newFile]);
        this.fileTree.set(this.buildTree(this.files()));
        this.selectedFile.set(newFile);
        this.editorContent = '';
        this.newFilePath = '';
        this.toast.success('File created');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Failed to create file');
      },
    });
  }
}
