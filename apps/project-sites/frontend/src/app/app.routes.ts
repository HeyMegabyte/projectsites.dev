import { type Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

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
    canActivate: [authGuard],
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
        path: 'email',
        loadComponent: () =>
          import('./pages/admin/sections/email.component').then((m) => m.AdminEmailComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin/sections/settings.component').then((m) => m.AdminSettingsComponent),
      },
      {
        path: 'domains',
        redirectTo: 'settings',
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
    path: 'contact',
    loadComponent: () =>
      import('./pages/contact/contact.component').then((m) => m.ContactComponent),
  },
  {
    path: 'billing',
    redirectTo: 'admin/billing',
  },
  {
    path: 'blog',
    loadComponent: () =>
      import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () =>
      import('./pages/blog/blog-post.component').then((m) => m.BlogPostComponent),
  },
  {
    path: 'changelog',
    loadComponent: () =>
      import('./pages/changelog/changelog.component').then((m) => m.ChangelogComponent),
  },
  {
    path: 'status',
    loadComponent: () =>
      import('./pages/status/status.component').then((m) => m.StatusComponent),
  },
  {
    path: 'error',
    loadComponent: () =>
      import('./pages/error/server-error.component').then((m) => m.ServerErrorComponent),
  },
  {
    path: 'offline',
    loadComponent: () =>
      import('./pages/error/offline.component').then((m) => m.OfflineComponent),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./pages/error/not-found.component').then((m) => m.NotFoundComponent),
  },
];
