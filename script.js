/* Portfolio core: API access shared by every demo, the live results board,
   navigation state and the contact actions. Each demo lives in its own file
   under assets/ and uses window.Portfolio from here. */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Same origin behind the reverse proxy; the backend's own port when the
  // static site is served separately during development (e.g. :8080).
  var API = (location.protocol === 'https:' || location.port === '' ||
             location.port === '80' || location.port === '8085')
    ? '' : location.protocol + '//' + location.hostname + ':8085';

  function request(path, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, (options && options.timeout) || 30000);
    var init = { cache: 'no-store', signal: controller.signal };
    if (options && options.body !== undefined) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body);
    }
    return fetch(API + path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var detail = typeof data.detail === 'string' ? data.detail
            : response.status === 429 ? 'Too many requests. Try again in a minute.'
            : 'The server returned ' + response.status + '.';
          var error = new Error(detail);
          error.status = response.status;
          throw error;
        }
        return data;
      });
    }, function (error) {
      var e = new Error(error && error.name === 'AbortError'
        ? 'The server took too long to answer.'
        : 'The demo server is unreachable right now.');
      e.offline = true;
      throw e;
    }).finally(function () { clearTimeout(timer); });
  }

  // One request per key per page view, shared by the results board and the
  // demo that owns the data.
  var memo = {};
  function shared(key, make) {
    if (!memo[key]) {
      memo[key] = make().catch(function (error) { delete memo[key]; throw error; });
    }
    return memo[key];
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function onVisible(element, callback) {
    if (!element) return;
    if (!('IntersectionObserver' in window)) { callback(); return; }
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        observer.disconnect();
        callback();
      }
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
  }

  function setStatus(demo, state, text) {
    var el = demo.querySelector('[data-status]');
    if (!el) return;
    el.className = 'status' + (state ? ' is-' + state : '');
    el.textContent = text;
  }

  // Status pill for a failed request: one wording for "server down" across
  // every demo, and the caller's short label for input errors.
  function failStatus(demo, error, label) {
    setStatus(demo, 'error', error && error.offline ? 'Server unreachable' : label);
  }

  function ms(value, digits) {
    if (value == null || !isFinite(value)) return '–';
    var d = digits != null ? digits : (value < 10 ? 1 : 0);
    return Number(value).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) + ' ms';
  }

  function pct(value) { return Math.round(value * 100) + '%'; }

  function ago(seconds) {
    var s = Math.max(0, Date.now() / 1000 - seconds);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' minutes ago';
    if (s < 172800) return Math.round(s / 3600) + ' hours ago';
    return Math.round(s / 86400) + ' days ago';
  }

  var SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    var el = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function download(text, filename, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Keyboard-friendly tabs: arrow keys move between tabs (WAI-ARIA pattern).
  function tabs(root, onChange) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    function select(button, focus) {
      buttons.forEach(function (b) {
        var on = b === button;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) button.focus();
      if (onChange) onChange(button.getAttribute('data-tab'));
    }
    buttons.forEach(function (b, i) {
      b.addEventListener('click', function () { select(b, false); });
      b.addEventListener('keydown', function (e) {
        var next = e.key === 'ArrowRight' ? buttons[(i + 1) % buttons.length]
          : e.key === 'ArrowLeft' ? buttons[(i - 1 + buttons.length) % buttons.length] : null;
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  }

  function pressed(group, selector, active) {
    group.querySelectorAll(selector).forEach(function (b) {
      b.setAttribute(b.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed',
        b === active ? 'true' : 'false');
    });
  }

  window.Portfolio = {
    reducedMotion: reducedMotion,
    get: function (path, options) { return request(path, options); },
    post: function (path, body, options) { return request(path, Object.assign({}, options, { body: body })); },
    shared: shared,
    esc: esc,
    onVisible: onVisible,
    setStatus: setStatus,
    failStatus: failStatus,
    ms: ms,
    pct: pct,
    ago: ago,
    svg: svg,
    download: download,
    tabs: tabs,
    pressed: pressed,
    board: function (key, html, state) {
      var el = document.querySelector('[data-board="' + key + '"]');
      if (!el) return;
      el.className = 'board-value' + (state === 'error' ? ' is-error' : ' is-live');
      el.innerHTML = html;
    },
  };

  /* ── Hero facts (cached summary) ─────────────────────────────────────── */
  var facts = document.querySelector('[data-summary]');
  request('/api/summary').then(function (d) {
    if (!facts) return;
    facts.innerHTML = '<strong>' + d.live_demos + ' live demos</strong>, ' +
      '<strong>' + Number(d.test_functions).toLocaleString('en-US') + ' tests</strong> across the projects, ' +
      'and CI on <strong>' + d.ci_workflows + ' repositories</strong>.';
  }).catch(function () {
    if (facts) facts.textContent = 'The demo server is unreachable right now; the projects below say so where it matters.';
  });

  /* ── Board footer note: tick when every row has an answer ────────────── */
  var note = document.querySelector('[data-board-note]');
  var rows = document.querySelectorAll('[data-board]');
  var watcher = new MutationObserver(function () {
    var done = Array.prototype.every.call(rows, function (r) { return r.textContent.trim() !== '…'; });
    if (done && note) {
      var errors = document.querySelectorAll('.board-value.is-error').length;
      note.textContent = errors === rows.length ? 'Server unreachable' : 'Measured just now';
      watcher.disconnect();
    }
  });
  rows.forEach(function (r) { watcher.observe(r, { childList: true, subtree: true, characterData: true }); });

  /* ── Current section in the nav ──────────────────────────────────────── */
  var links = document.querySelectorAll('.nav a[href^="#"]');
  if ('IntersectionObserver' in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) {
          a.setAttribute('aria-current', a.getAttribute('href') === '#' + entry.target.id ? 'true' : 'false');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach(function (s) { sectionObserver.observe(s); });
  }

  /* ── Copy email ──────────────────────────────────────────────────────── */
  var copyButton = document.querySelector('[data-copy-email]');
  var copyStatus = document.querySelector('[data-copy-status]');
  if (copyButton) {
    copyButton.addEventListener('click', function () {
      var email = 'muath.reed@gmail.com';
      var done = function () { if (copyStatus) copyStatus.textContent = 'Copied.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).then(done, function () {
          if (copyStatus) copyStatus.textContent = 'Copy failed; select the address instead.';
        });
      } else if (copyStatus) {
        copyStatus.textContent = 'Select the address to copy it.';
      }
    });
  }
})();
