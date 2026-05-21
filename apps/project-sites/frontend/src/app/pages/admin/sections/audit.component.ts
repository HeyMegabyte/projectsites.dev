import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridReadyEvent,
  type GridApi,
  CsvExportModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ValidationModule,
  RowSelectionModule,
  type RowSelectionOptions,
} from 'ag-grid-community';
import { ApiService } from '../../../services/api.service';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CsvExportModule,
  PaginationModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  RowSelectionModule,
  ValidationModule,
]);

interface AuditRow {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [FormsModule, AgGridAngular],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-4">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Audit Log</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Every privileged action — who, what, when, request ID. Filter, group, sort, export to CSV.
          </p>
        </div>
        <div class="flex gap-2">
          <input class="input-field" placeholder="Quick search…" [(ngModel)]="quickFilter" (ngModelChange)="onQuickFilter($event)" />
          <button class="btn-ghost" (click)="exportCsv()">Export CSV</button>
          <button class="btn-primary" (click)="reload()" [disabled]="loading()">{{ loading() ? '…' : 'Refresh' }}</button>
        </div>
      </header>

      <div class="grid grid-cols-4 gap-3 text-[0.78rem]">
        <div class="card"><div class="muted-h">Events</div><div class="text-2xl font-bold text-white">{{ rows().length }}</div></div>
        <div class="card"><div class="muted-h">Unique actions</div><div class="text-2xl font-bold text-white">{{ uniqueActions() }}</div></div>
        <div class="card"><div class="muted-h">Last 24h</div><div class="text-2xl font-bold text-white">{{ last24h() }}</div></div>
        <div class="card"><div class="muted-h">Actors</div><div class="text-2xl font-bold text-white">{{ uniqueActors() }}</div></div>
      </div>

      <div class="card p-0 overflow-hidden">
        <ag-grid-angular
          class="ag-grid-host"
          [theme]="theme"
          [rowData]="rows()"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [pagination]="true"
          [paginationPageSize]="50"
          [paginationPageSizeSelector]="[25, 50, 100, 250]"
          [rowSelection]="rowSelection"
          [animateRows]="true"
          [enableCellTextSelection]="true"
          (gridReady)="onGridReady($event)">
        </ag-grid-angular>
      </div>

      @if (selected(); as s) {
        <div class="card border border-primary/40">
          <div class="flex items-center justify-between mb-3">
            <h3 class="m-0 text-base font-semibold text-white">{{ s.action }}</h3>
            <button class="text-text-secondary hover:text-white" (click)="selected.set(null)">×</button>
          </div>
          <div class="grid md:grid-cols-2 gap-3 text-[0.72rem]">
            <div><div class="muted-h">When</div><div>{{ s.created_at }}</div></div>
            <div><div class="muted-h">Request ID</div><div class="font-mono">{{ s.request_id }}</div></div>
            <div><div class="muted-h">Actor</div><div class="font-mono">{{ s.actor_id || '—' }}</div></div>
            <div><div class="muted-h">Target</div><div class="font-mono">{{ s.target_type }}:{{ s.target_id }}</div></div>
          </div>
          <div class="mt-3">
            <div class="muted-h">Metadata</div>
            <pre class="bg-black/30 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72">{{ pretty(s.metadata) }}</pre>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; min-width: 220px; }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.5rem 1rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 0.3rem; }
    .ag-grid-host { width: 100%; height: 600px; }
  `],
})
export class AdminAuditComponent implements OnInit {
  private api = inject(ApiService);
  rows = signal<AuditRow[]>([]);
  loading = signal(false);
  selected = signal<AuditRow | null>(null);
  quickFilter = '';
  private gridApi?: GridApi<AuditRow>;

  theme = themeQuartz.withParams({
    backgroundColor: '#0a0a1a',
    foregroundColor: '#e5e7eb',
    headerBackgroundColor: '#0e0e22',
    headerTextColor: '#f5f5f7',
    rowHoverColor: 'rgba(0, 229, 255, 0.06)',
    selectedRowBackgroundColor: 'rgba(0, 229, 255, 0.14)',
    accentColor: '#00E5FF',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    rowBorder: { color: 'rgba(255, 255, 255, 0.04)' },
    headerColumnBorder: false,
    spacing: 6,
    fontSize: 12,
  });

  rowSelection: RowSelectionOptions = { mode: 'singleRow', checkboxes: false, enableClickSelection: true };

  defaultColDef: ColDef = {
    sortable: true, filter: true, resizable: true, flex: 1, minWidth: 120,
  };

  columnDefs: ColDef<AuditRow>[] = [
    {
      headerName: 'When',
      field: 'created_at',
      width: 180,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString() : '',
      sort: 'desc',
    },
    {
      headerName: 'Action',
      field: 'action',
      cellRenderer: (p: { value: string }) =>
        `<span style="font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,229,255,0.1);color:#00E5FF;">${p.value}</span>`,
    },
    { headerName: 'Target Type', field: 'target_type', width: 140 },
    { headerName: 'Target ID', field: 'target_id', cellClass: 'mono', width: 200 },
    { headerName: 'Actor', field: 'actor_id', cellClass: 'mono', width: 200 },
    {
      headerName: 'Metadata',
      field: 'metadata',
      flex: 2,
      valueFormatter: (p) => p.value ? JSON.stringify(p.value).slice(0, 200) : '',
      filter: false,
      sortable: false,
    },
    { headerName: 'Request ID', field: 'request_id', cellClass: 'mono', width: 200 },
  ];

  uniqueActions(): number { return new Set(this.rows().map((r) => r.action)).size; }
  uniqueActors(): number { return new Set(this.rows().map((r) => r.actor_id).filter(Boolean)).size; }
  last24h(): number {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return this.rows().filter((r) => Date.parse(r.created_at) >= cutoff).length;
  }

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.api.get<{ data: AuditRow[] }>('/audit/rows').subscribe({
      next: (r) => { this.rows.set(r.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onGridReady(ev: GridReadyEvent<AuditRow>): void {
    this.gridApi = ev.api;
    ev.api.addEventListener('rowSelected', () => {
      const sel = ev.api.getSelectedRows() as AuditRow[];
      this.selected.set(sel[0] ?? null);
    });
  }

  onQuickFilter(v: string): void {
    this.gridApi?.setGridOption('quickFilterText', v);
  }

  exportCsv(): void {
    this.gridApi?.exportDataAsCsv({ fileName: `audit-log-${new Date().toISOString().slice(0, 10)}.csv` });
  }

  pretty(o: unknown): string { return JSON.stringify(o, null, 2); }
}
