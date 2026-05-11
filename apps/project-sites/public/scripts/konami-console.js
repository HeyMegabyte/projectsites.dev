/* 1337 LAYER #1 — Konami dev console (vanilla, no deps)
 * Sequence: ↑ ↑ ↓ ↓ ← → ← → B A
 * 2.5s rolling debounce, 4 inspectors: build, routes, perf, delight.
 * Target: ≤4KB gzipped. Honors prefers-reduced-motion + Esc to close.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__konamiBooted) return;
  window.__konamiBooted = true;

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

  document.addEventListener('keydown', function (e) {
    if (open && e.key === 'Escape') { closePanel(); return; }
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
  }, true);

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    open = false;
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
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
    keys.slice(0, 24).forEach(function (k) { data[k] = internal[k]; });
    return tab('routes', data);
  }

  function perfInfo() {
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var paints = performance.getEntriesByType('paint');
    var fcp = paints.find(function (p) { return p.name === 'first-contentful-paint'; });
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
      data[(i + 1) + '. ' + (entry.slug || entry.route || '?')] =
        (entry.description || entry.label || '').slice(0, 60);
    });
    if (src.length === 0) data.tip = 'set window.__delightLog = [{slug,description}]';
    return tab('delight', data);
  }

  function tab(name, data) {
    var rows = [];
    for (var k in data) {
      rows.push(el('div', { style: 'display:flex;gap:1rem;border-bottom:1px solid rgba(100,255,218,.08);padding:.35rem 0' }, [
        el('span', { style: 'color:#64ffda;min-width:11rem;font-weight:600', text: k }),
        el('span', { style: 'color:#cfe', text: String(data[k]) }),
      ]));
    }
    var pane = el('div', { 'data-pane': name, style: 'display:none;max-height:60vh;overflow:auto;padding:1rem' }, rows);
    return pane;
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
    var bar = el('div', { style: 'display:flex;gap:.5rem;padding:.75rem 1rem;border-bottom:1px solid rgba(100,255,218,.15);background:rgba(0,0,0,.4)' });
    ['build','routes','perf','delight'].forEach(function (name) {
      var b = el('button', {
        'data-tab': name,
        style: 'background:transparent;border:1px solid rgba(100,255,218,.2);color:#9aa;padding:.35rem .8rem;border-radius:6px;cursor:pointer;font:inherit',
        text: name,
      });
      b.addEventListener('click', function () { activate(name); });
      bar.appendChild(b);
    });
    var close = el('button', {
      style: 'margin-left:auto;background:transparent;border:1px solid rgba(255,90,90,.4);color:#f99;padding:.35rem .8rem;border-radius:6px;cursor:pointer;font:inherit',
      text: 'esc',
    });
    close.addEventListener('click', closePanel);
    bar.appendChild(close);

    panel = el('div', {
      role: 'dialog',
      'aria-label': 'developer console',
      style: 'position:fixed;right:1rem;bottom:1rem;width:min(640px,92vw);background:rgba(6,6,16,.94);color:#cfe;font:13px/1.45 JetBrains Mono,Fira Code,monospace;border:1px solid rgba(100,255,218,.25);border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55);z-index:2147483647;backdrop-filter:blur(12px);' + (reduced ? '' : 'animation:konamiIn .2s ease-out'),
    }, [bar, buildInfo(), routesInfo(), perfInfo(), delightInfo()]);

    if (!reduced && !document.getElementById('konami-anim')) {
      var s = document.createElement('style');
      s.id = 'konami-anim';
      s.textContent = '@keyframes konamiIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
      document.head.appendChild(s);
    }

    document.body.appendChild(panel);
    activate('build');
  }
})();
