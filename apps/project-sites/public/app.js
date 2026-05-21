/**
 * Project Sites — universal site script.
 *
 * One <script src="https://projectsites.dev/app.js" data-slug="YOUR-SLUG" defer></script>
 * gives any website:
 *   • AI form router  — every <form> submit is intercepted + POSTed to
 *     /api/forms/submit; the worker runs the customer's router prompt and
 *     dispatches Mailchimp/Stripe/Resend/HubSpot calls via connected MCPs.
 *   • Live AI search  — any [data-ps-search] input becomes a typeahead
 *     querying /api/sites/:slug/search; results render in [data-ps-results].
 *   • AI chat widget  — opens on click of [data-ps-chat] or floats a default
 *     bubble; streams responses from /api/sites/:slug/chat-stream (SSE).
 *
 * No framework, no build step. ~6 KB minified.
 */
(() => {
  const SCRIPT = document.currentScript;
  const SLUG =
    SCRIPT?.getAttribute('data-slug') ||
    (typeof window !== 'undefined' && window.__PS_SLUG__) ||
    location.hostname.split('.')[0];
  const API = SCRIPT?.getAttribute('data-api') || 'https://projectsites.dev';
  const READY = () => document.readyState !== 'loading';
  const onReady = (fn) =>
    READY() ? fn() : document.addEventListener('DOMContentLoaded', fn, { once: true });

  /* ─────────────────────── Form hijack ─────────────────────── */
  const SUBMITTED = new WeakSet();
  function hijackForms() {
    document.querySelectorAll('form').forEach((form) => {
      if (form.dataset.psSkip === '1' || form.dataset.psWired === '1') return;
      form.dataset.psWired = '1';
      form.addEventListener('submit', async (ev) => {
        if (SUBMITTED.has(form)) return;
        ev.preventDefault();
        SUBMITTED.add(form);
        const btn = form.querySelector('button[type=submit], input[type=submit]');
        const orig = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        const fields = {};
        new FormData(form).forEach((v, k) => { fields[k] = typeof v === 'string' ? v : '(file)'; });
        const email = typeof fields.email === 'string' ? fields.email : undefined;
        const form_name = form.getAttribute('name') || form.id || form.dataset.psForm || 'default';
        let res;
        try {
          res = await fetch(`${API}/api/v1/forms/submit`, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json', 'X-Site-Slug': SLUG },
            body: JSON.stringify({ form_name, email, fields, origin_url: location.href }),
          });
        } catch (err) {
          renderNotice(form, 'Network error. Try again.', 'error');
          if (btn) { btn.disabled = false; btn.textContent = orig; }
          SUBMITTED.delete(form);
          return;
        }
        if (res.ok) {
          renderNotice(form, form.dataset.psSuccess || 'Thanks — we got your message.', 'ok');
          form.reset();
        } else {
          let msg = 'Submission failed.';
          try { msg = (await res.json())?.error?.message || msg; } catch {}
          renderNotice(form, msg, 'error');
        }
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        SUBMITTED.delete(form);
      });
    });
  }
  function renderNotice(form, message, kind) {
    let el = form.querySelector('[data-ps-notice]');
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-ps-notice', '');
      el.style.cssText = 'margin:0.75rem 0 0;font-size:0.9rem;';
      form.appendChild(el);
    }
    el.textContent = message;
    el.style.color = kind === 'ok' ? '#0a7d3a' : '#b91c1c';
  }

  /* ─────────────────────── Live AI search ─────────────────────── */
  function wireSearch() {
    document.querySelectorAll('[data-ps-search]').forEach((input) => {
      if (input.dataset.psWired === '1') return;
      input.dataset.psWired = '1';
      const targetSel = input.getAttribute('data-ps-results') || '[data-ps-results]';
      let timer;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        timer = setTimeout(() => doSearch(q, targetSel), 220);
      });
    });
  }
  async function doSearch(q, targetSel) {
    const target = document.querySelector(targetSel);
    if (!target) return;
    if (!q) { target.innerHTML = ''; return; }
    target.innerHTML = '<p style="opacity:0.6;font-size:0.85rem;">Searching…</p>';
    try {
      const res = await fetch(`${API}/api/sites/${SLUG}/search?q=${encodeURIComponent(q)}&limit=8`);
      const j = await res.json();
      const hits = j?.data?.hits || j?.hits || [];
      if (!hits.length) { target.innerHTML = '<p style="opacity:0.6;font-size:0.85rem;">No matches.</p>'; return; }
      target.innerHTML = hits.map((h) => `
        <a href="${escapeAttr(h.url || h.page_path || '#')}" style="display:block;padding:0.5rem 0.75rem;border-bottom:1px solid rgba(0,0,0,0.06);text-decoration:none;color:inherit;">
          <strong style="font-size:0.9rem;">${escapeHtml(h.title || h.page_path || 'Untitled')}</strong>
          <p style="margin:0.2rem 0 0;font-size:0.8rem;opacity:0.7;">${escapeHtml((h.snippet || '').slice(0, 140))}</p>
        </a>`).join('');
    } catch {
      target.innerHTML = '<p style="opacity:0.6;font-size:0.85rem;color:#b91c1c;">Search failed.</p>';
    }
  }

  /* ─────────────────────── AI chat widget ─────────────────────── */
  let chatOpen = false;
  let chatRoot;
  function ensureChatWidget() {
    if (chatRoot) return chatRoot;
    chatRoot = document.createElement('div');
    chatRoot.setAttribute('data-ps-chat-root', '');
    chatRoot.innerHTML = `
      <button data-ps-chat-bubble aria-label="Open AI chat" style="position:fixed;right:24px;bottom:24px;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,#00E5FF,#7C3AED);color:#fff;font-size:24px;box-shadow:0 8px 28px rgba(124,58,237,0.3);cursor:pointer;z-index:2147483647;">💬</button>
      <div data-ps-chat-panel hidden style="position:fixed;right:24px;bottom:88px;width:360px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 110px);background:#0a0a1a;color:#f5f5f7;border:1px solid rgba(0,229,255,0.2);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;z-index:2147483647;font:14px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden;">
        <header style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.85rem;border-bottom:1px solid rgba(255,255,255,0.08);">
          <strong style="font-size:0.85rem;">Ask anything</strong>
          <button data-ps-chat-close aria-label="Close" style="background:transparent;border:none;color:inherit;font-size:18px;cursor:pointer;">×</button>
        </header>
        <div data-ps-chat-log style="flex:1;overflow:auto;padding:0.75rem 0.85rem;"></div>
        <form data-ps-chat-form style="display:flex;gap:6px;padding:0.6rem 0.7rem;border-top:1px solid rgba(255,255,255,0.08);">
          <input data-ps-chat-input type="text" placeholder="Type a message…" required autocomplete="off" style="flex:1;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:inherit;font:inherit;">
          <button type="submit" style="padding:0.55rem 0.9rem;border-radius:8px;border:none;background:#00E5FF;color:#060610;font-weight:600;cursor:pointer;">Send</button>
        </form>
      </div>
    `;
    document.body.appendChild(chatRoot);
    chatRoot.querySelector('[data-ps-chat-bubble]').addEventListener('click', toggleChat);
    chatRoot.querySelector('[data-ps-chat-close]').addEventListener('click', () => toggleChat(false));
    chatRoot.querySelector('[data-ps-chat-form]').addEventListener('submit', onChatSubmit);
    return chatRoot;
  }
  function toggleChat(forceState) {
    ensureChatWidget();
    const panel = chatRoot.querySelector('[data-ps-chat-panel]');
    chatOpen = typeof forceState === 'boolean' ? forceState : !chatOpen;
    panel.hidden = !chatOpen;
    if (chatOpen) {
      requestAnimationFrame(() => chatRoot.querySelector('[data-ps-chat-input]').focus({ preventScroll: true }));
    }
  }
  async function onChatSubmit(ev) {
    ev.preventDefault();
    const input = chatRoot.querySelector('[data-ps-chat-input]');
    const log = chatRoot.querySelector('[data-ps-chat-log]');
    const msg = input.value.trim();
    if (!msg) return;
    appendChatBubble(log, 'user', msg);
    input.value = '';
    const a = appendChatBubble(log, 'assistant', '…');
    try {
      const res = await fetch(`${API}/api/sites/${SLUG}/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok || !res.body) {
        a.textContent = 'Chat is unavailable.';
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      a.textContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        a.textContent += dec.decode(value);
        log.scrollTop = log.scrollHeight;
      }
    } catch {
      a.textContent = 'Chat error.';
    }
  }
  function appendChatBubble(log, who, text) {
    const el = document.createElement('p');
    el.style.cssText =
      who === 'user'
        ? 'margin:0 0 0.5rem;padding:0.45rem 0.7rem;border-radius:10px;background:rgba(0,229,255,0.15);align-self:flex-end;max-width:80%;'
        : 'margin:0 0 0.5rem;padding:0.45rem 0.7rem;border-radius:10px;background:rgba(255,255,255,0.06);max-width:80%;';
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function wireChatTriggers() {
    document.querySelectorAll('[data-ps-chat]').forEach((btn) => {
      if (btn.dataset.psWired === '1') return;
      btn.dataset.psWired = '1';
      btn.addEventListener('click', (e) => { e.preventDefault(); toggleChat(true); });
    });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleChat(true);
      }
    });
  }

  /* ─────────────────────── boot ─────────────────────── */
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  onReady(() => {
    hijackForms();
    wireSearch();
    wireChatTriggers();
    if (SCRIPT?.getAttribute('data-chat-bubble') !== 'off') ensureChatWidget();
    new MutationObserver(() => {
      hijackForms();
      wireSearch();
      wireChatTriggers();
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
