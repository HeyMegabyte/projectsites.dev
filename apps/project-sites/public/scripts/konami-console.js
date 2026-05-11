/**
 * projectsites.dev konami-console.js — LEGACY REDIRECT SHIM
 *
 * The Konami developer console has been merged into the unified `widgets.js`
 * bundle. This file exists only to keep already-deployed sites working — they
 * have `<script src="/scripts/konami-console.js" defer>` baked into HTML.
 *
 * New embeds MUST use:
 *   <script src="https://projectsites.dev/widgets.js" defer></script>
 */
(function () {
  'use strict';
  if (window.__projectsitesWidgetsBooted) return;
  if (window.__projectsitesKonamiShimLoaded) return;
  window.__projectsitesKonamiShimLoaded = true;

  var s = document.createElement('script');
  s.src = 'https://projectsites.dev/widgets.js';
  s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();
