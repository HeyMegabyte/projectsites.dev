/**
 * projectsites.dev forms drop-in
 *
 * Embed:
 *   <script src="https://projectsites.dev/forms.js" data-slug="my-site" defer></script>
 *
 * Mark up any form on the page:
 *   <form data-projectsites-form="newsletter">
 *     <input name="email" type="email" required />
 *     <input name="first_name" />
 *     <button type="submit">Subscribe</button>
 *     <p data-projectsites-status></p>
 *   </form>
 *
 * On submit, the script POSTs JSON to /api/v1/forms/submit with X-Site-Slug,
 * captures the response, and updates the optional [data-projectsites-status]
 * element. Successful submissions emit a `projectsites:form:success` event;
 * failures emit `projectsites:form:error`. Both bubble.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var slug = script && script.getAttribute('data-slug');
  var endpoint =
    (script && script.getAttribute('data-endpoint')) ||
    'https://projectsites.dev/api/v1/forms/submit';

  if (!slug) {
    console.warn('[projectsites] forms.js: missing data-slug on <script>');
    return;
  }

  var SUCCESS_TEXT = 'Thanks! We received your submission.';
  var ERROR_TEXT = 'Something went wrong. Please try again.';

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

  function collectFields(form) {
    var fields = {};
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.disabled) continue;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
      fields[el.name] = el.value;
    }
    return fields;
  }

  function pickEmail(fields) {
    var keys = ['email', 'email_address', 'e_mail', 'mail'];
    for (var i = 0; i < keys.length; i++) {
      var v = fields[keys[i]];
      if (typeof v === 'string' && v.indexOf('@') > 0) return v;
    }
    return undefined;
  }

  function dispatch(form, name, detail) {
    form.dispatchEvent(new CustomEvent('projectsites:form:' + name, { detail: detail, bubbles: true }));
  }

  async function submit(form, ev) {
    ev.preventDefault();
    var formName = form.getAttribute('data-projectsites-form') || 'default';
    var fields = collectFields(form);
    var email = pickEmail(fields);

    setBusy(form, true);
    setStatus(form, 'pending', form.getAttribute('data-pending-text') || 'Sending…');

    var payload = {
      form_name: formName,
      email: email,
      fields: fields,
      origin_url: window.location.href,
    };

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
    form.__projectsitesAttached = true;
    form.addEventListener('submit', function (ev) {
      submit(form, ev);
    });
  }

  function attachAll(root) {
    var forms = (root || document).querySelectorAll('form[data-projectsites-form]');
    for (var i = 0; i < forms.length; i++) attach(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachAll(document);
    });
  } else {
    attachAll(document);
  }

  // Pick up forms added later (e.g., SPA route changes).
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('form[data-projectsites-form]')) attach(node);
          if (node.querySelectorAll) attachAll(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
