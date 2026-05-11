/**
 * projectsites.dev forms.js — LEGACY REDIRECT SHIM
 *
 * The form widget has been merged into the unified `widgets.js` bundle along
 * with the audio-reactive hero and Konami developer console. This file exists
 * only to keep already-deployed sites working — they have
 * `<script src="https://projectsites.dev/forms.js" defer>` baked into HTML.
 *
 * New embeds MUST use:
 *   <script src="https://projectsites.dev/widgets.js" data-slug="my-site" defer></script>
 *
 * This shim copies the `data-slug` and `data-endpoint` attributes onto a new
 * <script> pointing at widgets.js and inserts it before itself, then early-
 * returns. Idempotent: if widgets.js is already loaded (`__projectsitesWidgetsBooted`),
 * we no-op so we don't double-bind submit handlers.
 */
(function () {
  'use strict';
  if (window.__projectsitesWidgetsBooted) return;
  if (window.__projectsitesFormsShimLoaded) return;
  window.__projectsitesFormsShimLoaded = true;

  var self = document.currentScript;
  var slug = self && self.getAttribute('data-slug');
  var endpoint = self && self.getAttribute('data-endpoint');

  var s = document.createElement('script');
  s.src = 'https://projectsites.dev/widgets.js';
  s.defer = true;
  if (slug) s.setAttribute('data-slug', slug);
  if (endpoint) s.setAttribute('data-endpoint', endpoint);

  if (self && self.parentNode) {
    self.parentNode.insertBefore(s, self);
  } else {
    (document.head || document.documentElement).appendChild(s);
  }
})();
