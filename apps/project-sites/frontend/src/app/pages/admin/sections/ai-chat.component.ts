import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface CtxFile { id: string; filename: string; mime_type: string | null; size_bytes: number; description: string | null; enabled: 0 | 1; text_chars: number | null; created_at: string; }
interface AiSettings { chat_persona: string | null; chat_system_prompt: string | null; chat_system_prompt_default?: string | null; }

@Component({
  selector: 'app-admin-ai-chat',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white m-0">AI Chat</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          Upload knowledge files (menus, policies, FAQ, pricing) — the chat widget on your published site uses them as RAG context. Tune the persona + system prompt below.
        </p>
      </div>

      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-3">Persona &amp; system prompt</h3>
        <label class="block">
          <span class="muted-h">Tone / persona (one line)</span>
          <input type="text" class="input-field w-full mt-1" placeholder="friendly · plainspoken · never pushy" [(ngModel)]="settings.chat_persona" />
        </label>
        <label class="block mt-3">
          <span class="muted-h">System prompt (overrides default)</span>
          <textarea class="input-field w-full mt-1 font-mono text-[0.72rem]" rows="10"
                    [placeholder]="settings.chat_system_prompt_default || 'You are the AI concierge for [business]. Always be concise. Never invent prices. Cite the policy file when relevant.'"
                    [(ngModel)]="settings.chat_system_prompt"></textarea>
          @if (settings.chat_system_prompt_default) {
            <button type="button" class="text-[0.65rem] text-primary mt-1 underline"
                    (click)="settings.chat_system_prompt = settings.chat_system_prompt_default || ''">
              Use the v2 best-prompt default
            </button>
          }
        </label>
        <div class="flex justify-end mt-3">
          <button class="btn-primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save persona' }}</button>
        </div>
      </section>

      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">Knowledge files</h3>
          <input #fileInput type="file" class="hidden" (change)="upload($event)" accept=".txt,.md,.json,.csv,.html,.pdf" />
          <button class="btn-primary" (click)="fileInput.click()" [disabled]="uploading()">{{ uploading() ? 'Uploading…' : 'Upload file' }}</button>
        </div>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Plain text + Markdown + JSON are indexed automatically. PDFs are stored but not yet extracted (roadmap).
        </p>
        @if (loadingFiles()) {
          <div class="p-6 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (files().length === 0) {
          <div class="p-6 text-center text-text-secondary/70 text-sm italic">No knowledge files yet.</div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-2">Filename</th>
                <th class="text-left p-2">Type</th>
                <th class="text-right p-2">Size</th>
                <th class="text-right p-2">Indexed chars</th>
                <th class="text-left p-2">When</th>
                <th class="text-right p-2"></th>
              </tr>
            </thead>
            <tbody>
              @for (f of files(); track f.id) {
                <tr class="border-b border-white/[0.04]">
                  <td class="p-2 font-mono text-[0.72rem]">{{ f.filename }}</td>
                  <td class="p-2 text-text-secondary text-[0.7rem]">{{ f.mime_type || '—' }}</td>
                  <td class="p-2 text-right text-text-secondary">{{ bytes(f.size_bytes) }}</td>
                  <td class="p-2 text-right text-text-secondary">{{ f.text_chars || 0 }}</td>
                  <td class="p-2 text-text-secondary">{{ f.created_at | date:'short' }}</td>
                  <td class="p-2 text-right"><button class="text-red-400 hover:text-red-300 text-[0.7rem]" (click)="remove(f)">Delete</button></td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.5); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
  `],
})
export class AdminAiChatComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  files = signal<CtxFile[]>([]);
  loadingFiles = signal(false);
  uploading = signal(false);
  saving = signal(false);
  settings: AiSettings = { chat_persona: '', chat_system_prompt: '', chat_system_prompt_default: '' };

  ngOnInit(): void { this.load(); this.loadSettings(); }
  load(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.loadingFiles.set(true);
    this.api.get<{ data: CtxFile[] }>(`/sites/${s.id}/ai-chat/context-files`).subscribe({
      next: (r) => { this.files.set(r.data ?? []); this.loadingFiles.set(false); },
      error: () => this.loadingFiles.set(false),
    });
  }
  loadSettings(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: AiSettings }>(`/sites/${s.id}/ai-settings`).subscribe({
      next: (r) => { this.settings = { chat_persona: r.data?.chat_persona ?? '', chat_system_prompt: r.data?.chat_system_prompt ?? '', chat_system_prompt_default: r.data?.chat_system_prompt_default ?? '' }; },
    });
  }
  save(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.saving.set(true);
    this.api.put(`/sites/${s.id}/ai-settings`, this.settings).subscribe({
      next: () => { this.toast.success('Saved'); this.saving.set(false); },
      error: () => { this.toast.error('Failed'); this.saving.set(false); },
    });
  }
  upload(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const s = this.state.selectedSite(); if (!s) return;
    const fd = new FormData(); fd.append('file', file);
    this.uploading.set(true);
    this.api.postFormData(`/sites/${s.id}/ai-chat/context-files`, fd).subscribe({
      next: () => { this.uploading.set(false); input.value = ''; this.toast.success(`Uploaded ${file.name}`); this.load(); },
      error: (err) => { this.uploading.set(false); this.toast.error(err?.error?.error?.message || 'Upload failed'); },
    });
  }
  remove(f: CtxFile): void {
    if (!confirm(`Delete ${f.filename}?`)) return;
    const s = this.state.selectedSite(); if (!s) return;
    this.api.delete(`/sites/${s.id}/ai-chat/context-files/${f.id}`).subscribe({
      next: () => { this.toast.success('Deleted'); this.load(); },
    });
  }
  bytes(n: number): string { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`; }
}
