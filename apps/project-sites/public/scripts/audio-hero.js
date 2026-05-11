/* 1337 LAYER #8 — Audio-reactive hero (vanilla, no deps)
 * Canvas + AudioContext analyser node animates a brand-tinted spectrum
 * behind the hero. Falls back to a static gradient when:
 *   - prefers-reduced-motion: reduce
 *   - AudioContext autoplay denied (iOS / Safari)
 *   - no <audio data-hero> element on the page
 *
 * Usage in built site HTML:
 *   <div class="hero">
 *     <canvas data-hero-canvas></canvas>
 *     <audio data-hero src="/hero.mp3" preload="metadata"></audio>
 *   </div>
 *   <script src="/scripts/audio-hero.js" defer></script>
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__audioHeroBooted) return;
  window.__audioHeroBooted = true;

  function boot() {
    var canvas = document.querySelector('canvas[data-hero-canvas]');
    var audio = document.querySelector('audio[data-hero]');
    if (!canvas) return;
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var primary = canvas.getAttribute('data-primary') || '#7c3aed';
    var accent = canvas.getAttribute('data-accent') || '#64ffda';

    var ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener('resize', size, { passive: true });

    function staticGradient() {
      var rect = canvas.getBoundingClientRect();
      var g = ctx2d.createLinearGradient(0, 0, rect.width, rect.height);
      g.addColorStop(0, primary);
      g.addColorStop(1, accent);
      ctx2d.fillStyle = g;
      ctx2d.fillRect(0, 0, rect.width, rect.height);
    }

    if (reduced || !audio || !window.AudioContext) {
      staticGradient();
      return;
    }

    var ac, analyser, source, data;
    var started = false;
    var rafId = 0;

    function start() {
      if (started) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        source = ac.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(ac.destination);
        data = new Uint8Array(analyser.frequencyBinCount);
        started = true;
        draw();
      } catch (_) {
        staticGradient();
      }
    }

    function draw() {
      var rect = canvas.getBoundingClientRect();
      analyser.getByteFrequencyData(data);
      var g = ctx2d.createLinearGradient(0, 0, rect.width, rect.height);
      g.addColorStop(0, primary + 'cc');
      g.addColorStop(1, accent + 'cc');
      ctx2d.fillStyle = '#06060a';
      ctx2d.fillRect(0, 0, rect.width, rect.height);
      ctx2d.fillStyle = g;
      var bars = data.length;
      var w = rect.width / bars;
      for (var i = 0; i < bars; i++) {
        var h = (data[i] / 255) * rect.height * 0.85;
        ctx2d.fillRect(i * w, rect.height - h, w * 0.85, h);
      }
      rafId = requestAnimationFrame(draw);
    }

    audio.addEventListener('play', function () {
      if (ac && ac.state === 'suspended') ac.resume();
      start();
    });
    audio.addEventListener('pause', function () {
      cancelAnimationFrame(rafId);
      staticGradient();
    });

    audio.play().catch(function () {
      staticGradient();
    });

    staticGradient();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
