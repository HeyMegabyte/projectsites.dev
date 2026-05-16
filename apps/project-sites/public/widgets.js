/**
 * projectsites.dev unified widget bundle
 *
 * Single drop-in script bundling:
 *   1. Form capture            — every <form> on the page auto-captures inputs on submit
 *                                and POSTs them to /api/v1/forms/submit (fire-and-forget,
 *                                does NOT block native form action). Forms with
 *                                `data-projectsites-form="name"` ALSO get hijack mode
 *                                (preventDefault, status text, reset on success).
 *   2. Audio-reactive hero     — <canvas data-hero-canvas> + <audio data-hero> spectrum visualizer
 *   3. Konami dev console      — sequence ↑↑↓↓←→←→BA opens a build/routes/perf/delight inspector
 *
 * Each widget feature-detects its required DOM. Missing required nodes = silent no-op.
 * The legacy entry points `/forms.js`, `/scripts/audio-hero.js`, `/scripts/konami-console.js`
 * remain available as thin redirects to this bundle.
 *
 * Embed:
 *   <script src="https://projectsites.dev/widgets.js" data-slug="my-site" defer></script>
 *
 * Opt-out per form: `<form data-projectsites-ignore>` skips capture entirely.
 *
 * Service worker stays in /sw.js — SW scoping rules require it as a top-level file, NOT bundled here.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__projectsitesWidgetsBooted) return;
  window.__projectsitesWidgetsBooted = true;

  var script = document.currentScript;

  // ───────────────────────────────────────────────────────────
  // Widget 1: Form capture + hijack
  //
  // Default behavior: EVERY <form> on the page has its inputs captured
  // when it submits, then POSTed asynchronously to /api/v1/forms/submit.
  // Native form action proceeds normally (no preventDefault).
  //
  // Hijack mode: forms with `data-projectsites-form="name"` get the
  // preventDefault + status text + reset + button-busy flow.
  //
  // Opt-out: `<form data-projectsites-ignore>` skips capture entirely.
  // ───────────────────────────────────────────────────────────
  (function forms() {
    var slug = script && script.getAttribute('data-slug');
    var endpoint =
      (script && script.getAttribute('data-endpoint')) ||
      'https://projectsites.dev/api/v1/forms/submit';

    if (!slug) {
      // No slug = forms widget cannot send; other widgets still boot.
      return;
    }

    var SUCCESS_TEXT = 'Thanks! We received your submission.';
    var ERROR_TEXT = 'Something went wrong. Please try again.';
    var EMAIL_KEYS = ['email', 'email_address', 'e_mail', 'mail', 'user_email', 'contact_email'];
    var NAME_KEYS = ['name', 'full_name', 'first_name', 'fullName', 'firstName'];
    var PHONE_KEYS = ['phone', 'tel', 'telephone', 'mobile', 'phone_number'];

    function setStatus(form, kind, text) {
      var el = form.querySelector('[data-projectsites-status]');
      if (!el) return;
      el.textContent = text;
      el.setAttribute('data-state', kind);
    }

    function setBusy(form, busy) {
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) btn.disabled = !!busy;
      if (busy) form.setAttribute('aria-busy', 'true');
      else form.removeAttribute('aria-busy');
    }

    // Collect every named field's value, preserving group semantics:
    //  - text/email/number/textarea/hidden  → string
    //  - select-one                         → { value, label }
    //  - select-multiple                    → array of { value, label }
    //  - checkbox group (same name)         → array of values
    //  - single checkbox                    → boolean (checked) or string (value if non-default)
    //  - radio group                        → selected value or null
    //  - file                               → array of { name, size, type, lastModified }
    function collectFields(form) {
      var fields = {};
      var elements = form.elements;
      var radioSeen = {};
      var checkboxBuckets = {};

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el.name) continue;
        if (el.disabled) continue;
        if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') continue;

        if (el.type === 'file') {
          var files = [];
          if (el.files) {
            for (var f = 0; f < el.files.length; f++) {
              var file = el.files[f];
              files.push({
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
              });
            }
          }
          fields[el.name] = files;
          continue;
        }

        if (el.type === 'radio') {
          if (radioSeen[el.name]) continue;
          if (el.checked) {
            fields[el.name] = el.value;
            radioSeen[el.name] = true;
          } else if (!(el.name in fields)) {
            fields[el.name] = null;
          }
          continue;
        }

        if (el.type === 'checkbox') {
          // Group by name. Inputs sharing a name become an array of values.
          var bucket = checkboxBuckets[el.name] || (checkboxBuckets[el.name] = []);
          bucket.push(el);
          continue;
        }

        if (el.tagName === 'SELECT') {
          if (el.multiple) {
            var picks = [];
            for (var s = 0; s < el.options.length; s++) {
              var opt = el.options[s];
              if (opt.selected) picks.push({ value: opt.value, label: opt.text });
            }
            fields[el.name] = picks;
          } else {
            var sel = el.options[el.selectedIndex];
            fields[el.name] = sel
              ? { value: sel.value, label: sel.text }
              : { value: el.value, label: el.value };
          }
          continue;
        }

        fields[el.name] = el.value;
      }

      // Resolve checkbox buckets
      for (var n in checkboxBuckets) {
        if (!Object.prototype.hasOwnProperty.call(checkboxBuckets, n)) continue;
        var group = checkboxBuckets[n];
        if (group.length === 1) {
          var box = group[0];
          fields[n] = box.value && box.value !== 'on' ? (box.checked ? box.value : null) : box.checked;
        } else {
          var values = [];
          for (var g = 0; g < group.length; g++) {
            if (group[g].checked) values.push(group[g].value);
          }
          fields[n] = values;
        }
      }

      return fields;
    }

    function pickByKeys(fields, keys, validate) {
      for (var i = 0; i < keys.length; i++) {
        var v = fields[keys[i]];
        if (typeof v === 'object' && v && 'value' in v) v = v.value;
        if (typeof v === 'string' && (!validate || validate(v))) return v;
      }
      return undefined;
    }

    function pickEmail(fields) {
      return pickByKeys(fields, EMAIL_KEYS, function (v) {
        return v.indexOf('@') > 0;
      });
    }

    function buildPayload(form, fields) {
      var formName =
        form.getAttribute('data-projectsites-form') ||
        form.getAttribute('name') ||
        form.id ||
        'unnamed';
      return {
        form_name: formName,
        email: pickEmail(fields),
        name: pickByKeys(fields, NAME_KEYS),
        phone: pickByKeys(fields, PHONE_KEYS),
        fields: fields,
        meta: {
          origin_url: window.location.href,
          referrer: document.referrer || null,
          user_agent: navigator.userAgent,
          locale: navigator.language || null,
          timezone:
            (typeof Intl !== 'undefined' &&
              Intl.DateTimeFormat &&
              Intl.DateTimeFormat().resolvedOptions().timeZone) ||
            null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          submitted_at: new Date().toISOString(),
          form_action: form.getAttribute('action') || null,
          form_method: (form.getAttribute('method') || 'GET').toUpperCase(),
        },
      };
    }

    function dispatch(form, name, detail) {
      form.dispatchEvent(
        new CustomEvent('projectsites:form:' + name, { detail: detail, bubbles: true }),
      );
    }

    // Fire-and-forget capture: never blocks native submit, never throws upstream.
    function passiveCapture(form) {
      try {
        var fields = collectFields(form);
        var payload = buildPayload(form, fields);
        var body = JSON.stringify(payload);

        // Prefer sendBeacon when leaving the page (form action navigates away).
        if (navigator.sendBeacon) {
          var blob = new Blob([body], { type: 'application/json' });
          var sent = navigator.sendBeacon(endpoint + '?slug=' + encodeURIComponent(slug), blob);
          if (sent) {
            dispatch(form, 'captured', { transport: 'beacon', form_name: payload.form_name });
            return;
          }
        }

        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Site-Slug': slug },
          body: body,
          keepalive: true,
        }).catch(function () {
          // Swallow — capture is best-effort.
        });
        dispatch(form, 'captured', { transport: 'fetch', form_name: payload.form_name });
      } catch (err) {
        // Capture must never break the host page.
        if (window.console && window.console.warn) {
          window.console.warn('[projectsites] capture failed:', err);
        }
      }
    }

    // Hijack mode: full UX takeover for forms that opt in with data-projectsites-form.
    async function hijackSubmit(form, ev) {
      ev.preventDefault();
      var fields = collectFields(form);
      var payload = buildPayload(form, fields);

      setBusy(form, true);
      setStatus(form, 'pending', form.getAttribute('data-pending-text') || 'Sending…');

      try {
        var res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Site-Slug': slug },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () {
          return null;
        });

        if (!res.ok) {
          var msg =
            (data && data.error && data.error.message) ||
            form.getAttribute('data-error-text') ||
            ERROR_TEXT;
          setStatus(form, 'error', msg);
          dispatch(form, 'error', { status: res.status, body: data });
          return;
        }

        setStatus(form, 'success', form.getAttribute('data-success-text') || SUCCESS_TEXT);
        form.reset();
        dispatch(form, 'success', { result: data && data.data });
      } catch (err) {
        setStatus(form, 'error', form.getAttribute('data-error-text') || ERROR_TEXT);
        dispatch(form, 'error', { error: String(err && err.message ? err.message : err) });
      } finally {
        setBusy(form, false);
      }
    }

    function attach(form) {
      if (form.__projectsitesAttached) return;
      if (form.hasAttribute('data-projectsites-ignore')) return;
      form.__projectsitesAttached = true;

      var hijack = form.hasAttribute('data-projectsites-form');
      form.addEventListener(
        'submit',
        function (ev) {
          if (hijack) {
            hijackSubmit(form, ev);
          } else {
            // Passive capture — native submission proceeds normally.
            passiveCapture(form);
          }
        },
        // Capture phase so we run even if the form stops propagation.
        true,
      );
    }

    function attachAll(root) {
      var forms = (root || document).querySelectorAll('form');
      for (var i = 0; i < forms.length; i++) attach(forms[i]);
    }

    function ready(fn) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else fn();
    }

    ready(function () {
      attachAll(document);
    });

    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'FORM') attach(node);
            if (node.querySelectorAll) attachAll(node);
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  })();

  // ───────────────────────────────────────────────────────────
  // Widget 2: Audio-reactive hero (1337 LAYER #8)
  // ───────────────────────────────────────────────────────────
  (function audioHero() {
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
    } else boot();
  })();

  // ───────────────────────────────────────────────────────────
  // Widget 3: Konami dev console (1337 LAYER #1)
  // ───────────────────────────────────────────────────────────
  (function konami() {
    var SEQ = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
    var DEBOUNCE_MS = 2500;
    var idx = 0;
    var lastTs = 0;
    var open = false;
    var panel = null;

    function key(e) {
      return e.key.length === 1 ? e.key.toLowerCase() : e.key;
    }
    function reset() { idx = 0; }

    document.addEventListener(
      'keydown',
      function (e) {
        if (open && e.key === 'Escape') {
          closePanel();
          return;
        }
        var now = Date.now();
        if (now - lastTs > DEBOUNCE_MS) idx = 0;
        lastTs = now;
        var want = SEQ[idx];
        if (key(e) === want) {
          idx++;
          if (idx === SEQ.length) {
            idx = 0;
            openPanel();
          }
        } else if (idx > 0) {
          reset();
          if (key(e) === SEQ[0]) idx = 1;
        }
      },
      true,
    );

    function closePanel() {
      if (!panel) return;
      panel.remove();
      panel = null;
      open = false;
    }

    function el(tag, attrs, kids) {
      var n = document.createElement(tag);
      if (attrs)
        for (var k in attrs) {
          if (k === 'style') n.style.cssText = attrs[k];
          else if (k === 'text') n.textContent = attrs[k];
          else n.setAttribute(k, attrs[k]);
        }
      if (kids) for (var i = 0; i < kids.length; i++) n.appendChild(kids[i]);
      return n;
    }

    function fmt(num) {
      if (num == null) return '—';
      if (num > 1000) return (num / 1000).toFixed(1) + 'k';
      return String(Math.round(num));
    }

    function buildInfo() {
      var meta = {
        hostname: location.hostname,
        pathname: location.pathname,
        userAgent: navigator.userAgent.slice(0, 80),
        pixelRatio: window.devicePixelRatio,
        viewport: window.innerWidth + '×' + window.innerHeight,
        cookies: navigator.cookieEnabled ? 'yes' : 'no',
        online: navigator.onLine ? 'yes' : 'no',
        lang: navigator.language,
      };
      return tab('build', meta);
    }

    function routesInfo() {
      var anchors = [].slice.call(document.querySelectorAll('a[href]'));
      var internal = {};
      anchors.forEach(function (a) {
        try {
          var u = new URL(a.href, location.href);
          if (u.host === location.host) internal[u.pathname] = (internal[u.pathname] || 0) + 1;
        } catch (_) {}
      });
      var keys = Object.keys(internal).sort();
      var data = { count: keys.length };
      keys.slice(0, 24).forEach(function (k) {
        data[k] = internal[k];
      });
      return tab('routes', data);
    }

    function perfInfo() {
      var nav = performance.getEntriesByType('navigation')[0] || {};
      var paints = performance.getEntriesByType('paint');
      var fcp = paints.find(function (p) {
        return p.name === 'first-contentful-paint';
      });
      var data = {
        ttfb: fmt(nav.responseStart - nav.requestStart) + 'ms',
        dom_ready: fmt(nav.domContentLoadedEventEnd) + 'ms',
        load: fmt(nav.loadEventEnd) + 'ms',
        fcp: fcp ? fmt(fcp.startTime) + 'ms' : '—',
        transfer: fmt((nav.transferSize || 0) / 1024) + 'kb',
        requests: performance.getEntriesByType('resource').length,
      };
      return tab('perf', data);
    }

    function delightInfo() {
      var src = window.__delightLog || [];
      var data = { count: src.length };
      src.slice(-12).forEach(function (entry, i) {
        data[(i + 1) + '. ' + (entry.slug || entry.route || '?')] = (
          entry.description ||
          entry.label ||
          ''
        ).slice(0, 60);
      });
      if (src.length === 0) data.tip = 'set window.__delightLog = [{slug,description}]';
      return tab('delight', data);
    }

    function tab(name, data) {
      var rows = [];
      for (var k in data) {
        rows.push(
          el(
            'div',
            { style: 'display:flex;gap:1rem;border-bottom:1px solid rgba(100,255,218,.08);padding:.35rem 0' },
            [
              el('span', { style: 'color:#64ffda;min-width:11rem;font-weight:600', text: k }),
              el('span', { style: 'color:#cfe', text: String(data[k]) }),
            ],
          ),
        );
      }
      return el('div', { 'data-pane': name, style: 'display:none;max-height:60vh;overflow:auto;padding:1rem' }, rows);
    }

    function activate(name) {
      var panes = panel.querySelectorAll('[data-pane]');
      for (var i = 0; i < panes.length; i++) {
        panes[i].style.display = panes[i].getAttribute('data-pane') === name ? 'block' : 'none';
      }
      var tabs = panel.querySelectorAll('[data-tab]');
      for (var j = 0; j < tabs.length; j++) {
        var t = tabs[j];
        t.style.background = t.getAttribute('data-tab') === name ? '#7c3aed' : 'transparent';
        t.style.color = t.getAttribute('data-tab') === name ? '#fff' : '#9aa';
      }
    }

    function openPanel() {
      if (open) return;
      open = true;
      var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      var bar = el('div', {
        style: 'display:flex;gap:.5rem;padding:.75rem 1rem;border-bottom:1px solid rgba(100,255,218,.15);background:rgba(0,0,0,.4)',
      });
      ['build', 'routes', 'perf', 'delight'].forEach(function (name) {
        var b = el('button', {
          'data-tab': name,
          style: 'background:transparent;border:1px solid rgba(100,255,218,.2);color:#9aa;padding:.35rem .8rem;border-radius:6px;cursor:pointer;font:inherit',
          text: name,
        });
        b.addEventListener('click', function () {
          activate(name);
        });
        bar.appendChild(b);
      });
      var close = el('button', {
        style: 'margin-left:auto;background:transparent;border:1px solid rgba(255,90,90,.4);color:#f99;padding:.35rem .8rem;border-radius:6px;cursor:pointer;font:inherit',
        text: 'esc',
      });
      close.addEventListener('click', closePanel);
      bar.appendChild(close);

      panel = el(
        'div',
        {
          role: 'dialog',
          'aria-label': 'developer console',
          style:
            'position:fixed;right:1rem;bottom:1rem;width:min(640px,92vw);background:rgba(6,6,16,.94);color:#cfe;font:13px/1.45 JetBrains Mono,Fira Code,monospace;border:1px solid rgba(100,255,218,.25);border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55);z-index:2147483647;backdrop-filter:blur(12px);' +
            (reduced ? '' : 'animation:konamiIn .2s ease-out'),
        },
        [bar, buildInfo(), routesInfo(), perfInfo(), delightInfo()],
      );

      if (!reduced && !document.getElementById('konami-anim')) {
        var s = document.createElement('style');
        s.id = 'konami-anim';
        s.textContent =
          '@keyframes konamiIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
        document.head.appendChild(s);
      }

      document.body.appendChild(panel);
      activate('build');
    }
  })();
})();
