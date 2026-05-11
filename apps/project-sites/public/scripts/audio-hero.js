/**
 * projectsites.dev audio-hero.js — LEGACY REDIRECT SHIM
 *
 * The audio-reactive hero widget has been merged into the unified `widgets.js`
 * bundle. This file exists only to keep already-deployed sites working — they
 * have `<script src="/scripts/audio-hero.js" defer>` baked into HTML.
 *
 * New embeds MUST use:
 *   <script src="https://projectsites.dev/widgets.js" defer></script>
 *
 * Loading widgets.js exposes the audio-hero widget plus the form-hijack and
 * Konami console behind the same `__projectsitesWidgetsBooted` guard.
 */
(function () {
  'use strict';
  if (window.__projectsitesWidgetsBooted) return;
  if (window.__projectsitesAudioHeroShimLoaded) return;
  window.__projectsitesAudioHeroShimLoaded = true;

  var s = document.createElement('script');
  s.src = 'https://projectsites.dev/widgets.js';
  s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();
