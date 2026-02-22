import { Component } from '@angular/core';

@Component({
  selector: 'app-bg-orbs',
  standalone: true,
  template: `
    <div class="bg-orbs">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
    </div>
  `,
  styles: [`
    .bg-orbs { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .orb { position: absolute; border-radius: 50%; filter: blur(100px); opacity: 0.18; }
    .orb-1 {
      width: 500px; height: 500px;
      background: radial-gradient(circle, var(--secondary), transparent 70%);
      top: -120px; right: -120px; animation: orbFloat1 20s ease-in-out infinite;
    }
    .orb-2 {
      width: 400px; height: 400px;
      background: radial-gradient(circle, var(--accent), transparent 70%);
      bottom: -80px; left: -100px; animation: orbFloat2 18s ease-in-out infinite;
    }
    .orb-3 {
      width: 300px; height: 300px;
      background: radial-gradient(circle, #f472b6, transparent 70%);
      top: 40%; left: 50%; animation: orbFloat1 22s ease-in-out infinite reverse;
    }
  `],
})
export class BgOrbsComponent {}
