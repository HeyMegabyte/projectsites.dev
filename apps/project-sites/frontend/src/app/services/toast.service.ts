import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastCtrl = inject(ToastController);

  async show(message: string, type: 'error' | 'success' | 'info' = 'info', duration = 5000): Promise<void> {
    const colorMap: Record<string, string> = {
      error: 'danger',
      success: 'success',
      info: 'primary',
    };
    const toast = await this.toastCtrl.create({
      message,
      duration,
      position: 'top',
      color: colorMap[type] || 'primary',
      cssClass: `toast-${type}`,
      buttons: [{ icon: 'close', role: 'cancel' }],
    });
    await toast.present();
  }

  error(message: string, duration = 5000): void {
    this.show(message, 'error', duration);
  }

  success(message: string, duration = 5000): void {
    this.show(message, 'success', duration);
  }

  info(message: string, duration = 5000): void {
    this.show(message, 'info', duration);
  }
}
