import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/homepage/homepage.component').then((m) => m.HomepageComponent),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./pages/search/search.component').then((m) => m.SearchComponent),
  },
  {
    path: 'signin',
    loadComponent: () =>
      import('./pages/signin/signin.component').then((m) => m.SigninComponent),
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/create/create.component').then((m) => m.CreateComponent),
  },
  {
    path: 'details',
    redirectTo: 'create',
  },
  {
    path: 'waiting',
    loadComponent: () =>
      import('./pages/waiting/waiting.component').then((m) => m.WaitingComponent),
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/sections/dashboard.component').then((m) => m.AdminDashboardComponent),
        pathMatch: 'full',
      },
      {
        path: 'editor',
        loadComponent: () =>
          import('./pages/admin/sections/editor.component').then((m) => m.AdminEditorComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import('./pages/admin/sections/domains.component').then((m) => m.AdminDomainsComponent),
      },
      {
        path: 'snapshots',
        loadComponent: () =>
          import('./pages/admin/sections/snapshots.component').then((m) => m.AdminSnapshotsComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/admin/sections/analytics.component').then((m) => m.AdminAnalyticsComponent),
      },
      {
        path: 'seo',
        loadComponent: () =>
          import('./pages/admin/sections/seo.component').then((m) => m.AdminSeoComponent),
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./pages/admin/sections/billing.component').then((m) => m.AdminBillingComponent),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import('./pages/admin/sections/audit.component').then((m) => m.AdminAuditComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin/sections/settings.component').then((m) => m.AdminSettingsComponent),
      },
    ],
  },
  {
    path: 'editor/:slug',
    redirectTo: 'admin/editor',
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'privacy' },
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'terms' },
  },
  {
    path: 'content',
    loadComponent: () =>
      import('./pages/legal/legal.component').then((m) => m.LegalComponent),
    data: { type: 'content' },
  },
  {
    path: 'billing',
    redirectTo: 'admin/billing',
  },
  { path: '**', redirectTo: '' },
];
