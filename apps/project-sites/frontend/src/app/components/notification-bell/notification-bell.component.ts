import { Component, type OnInit, signal, inject, type OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { interval, Subscription, switchMap, filter } from 'rxjs';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  action_url: string | null;
  read: number;
  created_at: string;
}

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [],
  template: `
    <div class="notification-wrapper">
      <button
        class="bell-btn"
        (click)="toggleDropdown()"
        [attr.aria-label]="'Notifications' + (unreadCount() > 0 ? ', ' + unreadCount() + ' unread' : '')"
        aria-haspopup="true"
        [attr.aria-expanded]="isOpen()"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        @if (unreadCount() > 0) {
          <span class="badge">{{ unreadCount() > 9 ? '9+' : unreadCount() }}</span>
        }
      </button>

      @if (isOpen()) {
        <div class="dropdown" role="menu">
          <div class="dropdown-header">
            <span>Notifications</span>
            @if (unreadCount() > 0) {
              <button class="mark-all-btn" (click)="markAllRead()">Mark all read</button>
            }
          </div>

          @if (notifications().length === 0) {
            <div class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3e3e5a" stroke-width="1.5">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              <p>No notifications yet</p>
            </div>
          } @else {
            <div class="notification-list">
              @for (notif of notifications(); track notif.id) {
                <div
                  class="notification-item"
                  [class.unread]="!notif.read"
                  (click)="handleClick(notif)"
                  role="menuitem"
                >
                  <div class="notif-icon" [attr.data-type]="notif.type">
                    {{ typeIcon(notif.type) }}
                  </div>
                  <div class="notif-content">
                    <span class="notif-title">{{ notif.title }}</span>
                    <span class="notif-message">{{ notif.message }}</span>
                    <span class="notif-time">{{ timeAgo(notif.created_at) }}</span>
                  </div>
                  @if (!notif.read) {
                    <span class="unread-dot"></span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .notification-wrapper { position: relative; }
    .bell-btn {
      background: none; border: none; color: #94a3b8; cursor: pointer;
      padding: 8px; position: relative; border-radius: 8px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .bell-btn:hover { color: #f0f0f8; background: rgba(0,229,255,0.05); }
    .badge {
      position: absolute; top: 2px; right: 2px;
      background: #ef4444; color: #fff; font-size: 10px;
      font-weight: 700; min-width: 16px; height: 16px;
      border-radius: 8px; display: flex; align-items: center;
      justify-content: center; padding: 0 4px;
    }
    .dropdown {
      position: absolute; top: calc(100% + 8px); right: 0;
      width: 360px; max-height: 420px; overflow-y: auto;
      background: #0d0d1a; border: 1px solid rgba(0,229,255,0.12);
      border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.4);
      animation: slideDown 0.15s ease; z-index: 1100;
    }
    .dropdown-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 16px; border-bottom: 1px solid #1e1e3a;
      font-size: 14px; font-weight: 600; color: #f0f0f8;
    }
    .mark-all-btn {
      background: none; border: none; color: #00E5FF; font-size: 12px;
      cursor: pointer; padding: 0;
    }
    .mark-all-btn:hover { text-decoration: underline; }
    .empty-state {
      padding: 32px 16px; text-align: center;
    }
    .empty-state p { color: #64748b; font-size: 13px; margin-top: 8px; }
    .notification-list { padding: 4px 0; }
    .notification-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 16px; cursor: pointer;
      transition: background 0.1s ease;
    }
    .notification-item:hover { background: rgba(0,229,255,0.04); }
    .notification-item.unread { background: rgba(0,229,255,0.02); }
    .notif-icon {
      width: 32px; height: 32px; border-radius: 8px;
      background: rgba(0,229,255,0.08);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    .notif-content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .notif-title { font-size: 13px; font-weight: 600; color: #f0f0f8; }
    .notif-message {
      font-size: 12px; color: #94a3b8;
      overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .notif-time { font-size: 11px; color: #64748b; margin-top: 2px; }
    .unread-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #00E5FF;
      flex-shrink: 0; margin-top: 4px;
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private pollSub?: Subscription;

  isOpen = signal(false);
  notifications = signal<Notification[]>([]);
  unreadCount = signal(0);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) return;
    this.fetchNotifications();

    // Poll every 60 seconds for new notifications
    this.pollSub = interval(60_000).pipe(
      filter(() => this.auth.isLoggedIn()),
      switchMap(() => this.api.get<{ data: Notification[]; unread_count: number }>('/notifications')),
    ).subscribe({
      next: (res) => {
        this.notifications.set(res.data);
        this.unreadCount.set(res.unread_count);
      },
      error: () => { /* silent — poll failures are non-critical */ },
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  toggleDropdown(): void {
    this.isOpen.set(!this.isOpen());
    if (this.isOpen()) this.fetchNotifications();
  }

  fetchNotifications(): void {
    this.api.get<{ data: Notification[]; unread_count: number }>('/notifications').subscribe({
      next: (res) => {
        this.notifications.set(res.data);
        this.unreadCount.set(res.unread_count);
      },
      error: () => {
        // silently fail — notifications are non-critical
      },
    });
  }

  handleClick(notif: Notification): void {
    if (!notif.read) {
      this.api.patch(`/notifications/${notif.id}/read`, {}).subscribe();
      const updated = this.notifications().map((n) =>
        n.id === notif.id ? { ...n, read: 1 } : n,
      );
      this.notifications.set(updated);
      this.unreadCount.set(Math.max(0, this.unreadCount() - 1));
    }
    if (notif.action_url) {
      this.router.navigateByUrl(notif.action_url);
    }
    this.isOpen.set(false);
  }

  markAllRead(): void {
    this.api.post('/notifications/read-all', {}).subscribe();
    const updated = this.notifications().map((n) => ({ ...n, read: 1 }));
    this.notifications.set(updated);
    this.unreadCount.set(0);
  }

  typeIcon(type: string): string {
    const icons: Record<string, string> = {
      site_published: '🚀',
      billing_reminder: '💳',
      feedback_received: '💬',
      domain_verified: '🌐',
      build_failed: '⚠️',
      announcement: '📢',
    };
    return icons[type] || '🔔';
  }

  timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }
}
