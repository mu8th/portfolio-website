/* ==========================================================================
   Portfolio | Muath Alsawaier
   Interactive systems: particle backdrop, hero terminal,
   project visuals, contact form, scroll effects.
   All motion respects prefers-reduced-motion.
   ========================================================================== */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Particle constellation backdrop ─────────────────────────────────── */
  (function initParticles() {
    if (reducedMotion) return;
    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var particles = [];
    var mouse = { x: -9999, y: -9999 };
    var COUNT = window.innerWidth < 768 ? 18 : Math.min(42, Math.floor(window.innerWidth / 28));
    var LINK_DIST = 130;

    function resize() {
      // CSS width/height (100%) control the display size; only the drawing
      // buffer is sized here (DPR-aware), so the canvas always tracks the
      // viewport without stale fixed-pixel values.
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn() {
      particles = [];
      for (var i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: Math.random() * 1.6 + 0.6
        });
      }
    }

    function step() {
      if (document.hidden) { requestAnimationFrame(step); return; }
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy;

        // gentle repulsion from the cursor
        var mdx = p.x - mouse.x, mdy = p.y - mouse.y;
        var md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 140 && md > 0.001) {
          var f = (140 - md) / 140 * 0.4;
          p.x += (mdx / md) * f;
          p.y += (mdy / md) * f;
        }

        if (p.x < -20) p.x = window.innerWidth + 20;
        if (p.x > window.innerWidth + 20) p.x = -20;
        if (p.y < -20) p.y = window.innerHeight + 20;
        if (p.y > window.innerHeight + 20) p.y = -20;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139, 92, 246, 0.35)';
        ctx.fill();
      }

      // link nearby particles
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.strokeStyle = 'rgba(139, 92, 246,' + (0.12 * (1 - d / LINK_DIST)).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(step);
    }

    window.addEventListener('resize', function () { resize(); spawn(); });
    window.addEventListener('mousemove', function (e) {
      mouse.x = e.clientX; mouse.y = e.clientY;
    });
    resize(); spawn();
    requestAnimationFrame(step);
  })();

  /* ── Scroll progress bar + back-to-top ───────────────────────────────── */
  (function initScrollFx() {
    var bar = document.querySelector('.scroll-progress');
    var toTop = document.querySelector('.to-top');
    var ticking = false;

    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? (window.scrollY / max) * 100 : 0;
      if (bar) bar.style.width = p + '%';
      if (toTop) toTop.classList.toggle('show', window.scrollY > window.innerHeight);
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    }
  })();

  /* ── Hero terminal: scripted intro + interactive command input ──────────
     On load it plays a short scripted "demo" (typed commands). Clicking the
     terminal (or pressing any key) hands control to the visitor: the demo
     stops, an input row appears, and they can type real commands. This is the
     site's main "stop scrolling" hook. All commands are grounded in the real
     site content; `sudo hire-me` is the easter egg that jumps to Contact.     */
  (function initTerminal() {
    var host = document.getElementById('term-content');
    if (!host) return;
    var inputRow = document.getElementById('term-input-row');
    var input = document.getElementById('term-input');
    var hint = document.getElementById('term-hint');
    var card = host.closest('.glow-card');

    function summaryText() {
      function value(key) {
        var el = document.querySelector('[data-ticker="' + key + '"]');
        return el ? el.textContent : '—';
      }
      if (value('status') === 'checking') return 'Reading live portfolio metrics…';
      if (value('status') !== 'online') return 'Portfolio API unavailable · no live metrics loaded';
      return value('repos') + ' repositories · ' + value('loc') + ' Python lines · ' +
        value('tests') + ' test functions · ' + value('matches') +
        ' heuristic matches (review required)';
    }
    var DEMO = [
      { cmd: 'whoami', out: 'Muath | Software Engineering student @ WSU · SWE intern @ SEL', cls: '' },
      { cmd: 'ls ~/projects', out: 'faultline/  api-contract-tester/  code-rag/  vulnerability-scanner/  performance-profiler/', cls: '' },
      { cmd: 'stats', out: summaryText, cls: 'ok', key: 'summary' }
    ];
    var TYPE_MS = 45, OUT_DELAY = 350, LINE_PAUSE = 1300, RESTART = 2400;
    var MAX_NODES = 14;
    var promptHtml = '<span class="term-prompt">$</span>';
    var interactive = false;

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function cap() {
      while (host.children.length > MAX_NODES) host.removeChild(host.firstChild);
    }
    function clear() { while (host.firstChild) host.removeChild(host.firstChild); }

    function addOut(text, cls) {
      var out = document.createElement('div');
      out.className = 'term-out' + (cls ? ' ' + cls : '');
      out.textContent = text;
      host.appendChild(out);
      cap();
      return out;
    }
    document.addEventListener('portfolio:summary-updated', function () {
      var summary = host.querySelector('[data-terminal-key="summary"]');
      if (summary) summary.textContent = summaryText();
    });
    function addCmd(cmd) {
      var line = document.createElement('div');
      line.className = 'term-line';
      line.innerHTML = promptHtml;
      var c = document.createElement('span');
      c.className = 'term-cmd';
      c.textContent = cmd;
      line.appendChild(c);
      host.appendChild(line);
      cap();
      return line;
    }

    /* Command handling (interactive mode) */
    var COMMANDS = {
      help: function () {
        addOut('commands: help · whoami · ls · projects · stats · skills · contact · clear · sudo hire-me', 'dim');
      },
      whoami: function () { addOut('Muath | Software Engineering student @ WSU · SWE intern @ SEL'); },
      ls: function () { addOut('faultline/  api-contract-tester/  code-rag/  vulnerability-scanner/  performance-profiler/'); },
      projects: function () {
        addOut('01  FaultLine: bounded fault injection + per-phase SLO evidence');
        addOut('02  API Contract Tester: live endpoint checks against OpenAPI + field-level drift');
        addOut('03  CodeRAG: retrieved citations + model-backed or simulated answers');
        addOut('04  Vulnerability Scanner: regex-based patterns for human review');
        addOut('05  Performance Profiler: per-function CPU, wall-time, and memory measurements');
        addOut('06  G-Code Visualizer: color-coded CNC toolpath inspection');
        addOut('07  DXF to G-Code: geometry extraction + motion program generation');
        addOut('08  G-Code Optimizer: contour ordering + computed travel savings');
      },
      stats: function () { addOut(summaryText(), 'ok'); },
      skills: function () {
        addOut('python · structured text (iec 61131-3) · t-sql · fastapi · openapi · rtac extensions · rag pipelines · embeddings · ollama · docker · pytest · ruff · mypy');
      },
      contact: function () {
        addOut('email: muath.reed@gmail.com');
        addOut('linkedin: linkedin.com/in/muath-alsawaier');
        addOut('github: github.com/mu8th');
        addOut('try `sudo hire-me`', 'ok');
      },
      clear: function () { clear(); },
      'sudo hire-me': function () {
        addOut('Permission granted. Opening the contact form…', 'ok');
        setTimeout(function () {
          var c = document.getElementById('contact');
          if (c) c.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        }, 500);
      }
    };

    function runCommand(raw) {
      var cmd = raw.trim();
      if (!cmd) return;
      addCmd(cmd);
      var fn = COMMANDS[cmd.toLowerCase()];
      if (fn) fn();
      else addOut('command not found: ' + cmd + ', try `help`', 'err');
    }

    /* Switch from demo to interactive mode */
    function goInteractive() {
      if (interactive) { if (input) input.focus(); return; }
      interactive = true;
      if (hint) hint.textContent = 'type a command';
      if (inputRow) inputRow.hidden = false;
      if (input) input.focus();
    }

    /* Scripted demo loop (stops the moment the visitor takes over) */
    async function runDemo() {
      clear();
      while (!interactive) {
        for (var i = 0; i < DEMO.length; i++) {
          if (interactive) return;
          var step = DEMO[i];
          var line = addCmd('');
          var cmdEl = line.querySelector('.term-cmd');
          var cursor = document.createElement('span');
          cursor.className = 'term-cursor';
          line.appendChild(cursor);
          for (var c = 0; c < step.cmd.length; c++) {
            if (interactive) return;
            cmdEl.textContent += step.cmd.charAt(c);
            await sleep(TYPE_MS);
          }
          cursor.remove();
          await sleep(OUT_DELAY);
          if (interactive) return;
          var output = addOut(typeof step.out === 'function' ? step.out() : step.out, step.cls);
          if (step.key) output.dataset.terminalKey = step.key;
          await sleep(LINE_PAUSE);
        }
        await sleep(RESTART);
      }
    }

    if (reducedMotion) {
      // Static transcript, no animation; still interactive on click.
      DEMO.forEach(function (step) {
        addCmd(step.cmd);
        var output = addOut(typeof step.out === 'function' ? step.out() : step.out, step.cls);
        if (step.key) output.dataset.terminalKey = step.key;
      });
      addOut('click to type a command', 'dim');
    } else {
      runDemo();
    }

    // Take over on click anywhere in the terminal, or on any keypress.
    if (card) card.addEventListener('click', function (e) {
      if (e.target === input) return;
      goInteractive();
    });
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          runCommand(input.value);
          input.value = '';
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (interactive) return;
      // Only hijack when the visitor isn't typing in a form field.
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key && e.key.length === 1) goInteractive();
    });
  })();

  /* ── Scramble-decode hero title ─────────────────────────────────────────
     The gradient hero line decodes from random glyphs into its real text on
     load, a signature "developer" moment. Uses a setTimeout loop (not rAF) so
     it completes even when the tab is backgrounded/throttled. Skipped under
     reduced motion.                                                          */
  (function initScramble() {
    var el = document.querySelector('[data-scramble]');
    if (!el) return;
    var finalText = el.getAttribute('data-scramble');
    if (reducedMotion) { el.textContent = finalText; return; }
    var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>/{}[]#*+=~';
    var frame = 0;
    var total = finalText.length;
    var STEP_MS = 24; // snappier decode: one character settles per tick
    function tick() {
      var revealed = frame;
      var out = '';
      for (var i = 0; i < total; i++) {
        if (i < revealed) out += finalText.charAt(i);
        else if (finalText.charAt(i) === ' ') out += ' ';
        else out += GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
      }
      el.textContent = out;
      frame++;
      if (revealed < total) setTimeout(tick, STEP_MS);
      else el.textContent = finalText;
    }
    // Start after the preloader has lifted so it reads as an intro beat.
    setTimeout(tick, 900);
  })();

  /* ── Live portfolio snapshot ────────────────────────────────────────────
     Show values returned by the portfolio API. An unavailable backend is
     reported as unavailable; API reachability is not presented as CI status. */
  (function initTicker() {
    var ticker = document.getElementById('hero-ticker');
    if (!ticker) return;
    // Same-origin under a reverse proxy (default-port HTTP/HTTPS); cross-origin
    // to the backend only when the static site is served on another port.
    var API = (location.protocol === 'https:' || location.port === '8085'
               || location.port === '' || location.port === '80')
      ? ''
      : (location.hostname === 'localhost' ? 'http://localhost:8085'
          : 'http://' + location.hostname + ':8085');

    function set(key, val) {
      var el = ticker.querySelector('[data-ticker="' + key + '"]');
      if (el) el.textContent = val;
    }
    set('status', 'checking');
    set('repos', '—');
    set('loc', '—');
    set('matches', '—');
    set('tests', '—');

    fetch(API + '/api/summary', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        set('status', 'online');
        set('repos', String(d.projects_shipped != null ? d.projects_shipped : '—'));
        set('loc', (d.python_lines != null ? d.python_lines : 0).toLocaleString('en-US'));
        set('matches', String(d.potential_matches != null ? d.potential_matches : '—'));
        set('tests', String(d.test_functions != null ? d.test_functions : '—'));
        document.dispatchEvent(new Event('portfolio:summary-updated'));
      })
      .catch(function () {
        set('status', 'unavailable');
        document.dispatchEvent(new Event('portfolio:summary-updated'));
      });
  })();

  /* ── Preloader intro ────────────────────────────────────────────────────
     A brief boot screen that lifts once the page is ready (or after a hard
     cap, so a slow network never traps the visitor). Respects reduced motion
     by skipping the animation entirely.                                      */
  (function initPreloader() {
    var pre = document.getElementById('preloader');
    if (!pre) return;
    function lift() {
      pre.classList.add('done');
      setTimeout(function () { pre.style.display = 'none'; }, 700);
    }
    if (reducedMotion) { pre.style.display = 'none'; return; }
    var done = false;
    var finish = function () { if (!done) { done = true; lift(); } };
    window.addEventListener('load', function () { setTimeout(finish, 500); });
    setTimeout(finish, 2600); // hard cap
  })();

  /* ── Reveal on scroll (staggered) ────────────────────────────────────── */
  (function initReveal() {
    var els = document.querySelectorAll('.reveal');
    // stagger siblings within the same parent
    var groups = {};
    els.forEach(function (el) {
      var key = el.parentElement;
      if (!groups[key]) groups[key] = 0;
      el.style.setProperty('--reveal-delay', (groups[key]++ % 6) * 0.07 + 's');
    });

    if (reducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ── Active nav highlight ────────────────────────────────────────────── */
  (function initNav() {
    var sections = document.querySelectorAll('section[id]');
    var links = document.querySelectorAll('.nav a');
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id);
          });
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  })();

  /* ── Cursor-following glow + inner spotlight on cards ────────────────── */
  document.querySelectorAll('.glow-card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      var angle = Math.atan2(cy - r.height / 2, cx - r.width / 2) * 180 / Math.PI;
      card.style.setProperty('--cursor-angle', angle + 'deg');
      card.style.setProperty('--mx', cx + 'px');
      card.style.setProperty('--my', cy + 'px');
    });
  });

  /* ── Project visual: contract diff ───────────────────────────────────── */
  (function initDiff() {
    var box = document.querySelector('.project-visual--diff');
    if (!box) return;
    var lines = box.querySelectorAll('.diff-line');
    if (!lines.length) return;

    if (reducedMotion) {
      lines.forEach(function (l) { l.classList.remove('hidden-line'); });
      return;
    }

    var shown = 0;
    var visible = false;

    function showNext() {
      // A live render has taken over this card (it animates its own nodes);
      // stop driving the original markup.
      if (box.dataset.liveRender === '1') return;
      while (shown < lines.length && lines[shown].classList.contains('hidden-line')) {
        lines[shown].classList.remove('hidden-line');
        shown++;
      }
      if (shown < lines.length) {
        setTimeout(showNext, 260);
      } else {
        // after the full diff, pause, then loop
        setTimeout(function () {
          lines.forEach(function (l) { l.classList.add('hidden-line'); });
          shown = 0;
        }, 4200);
      }
    }

    function start() {
      if (visible) return;
      visible = true;
      showNext();
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { start(); obs.disconnect(); }
        });
      }, { threshold: 0.4 }).observe(box);
    } else {
      start();
    }
  })();

  /* ── Project visual: flame graph bars ────────────────────────────────── */
  (function initFlame() {
    var box = document.querySelector('.project-visual--flame');
    if (!box) return;
    var bars = box.querySelectorAll('.flame-row');
    if (!bars.length) return;

    function grow() {
      bars.forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%'; });
    }

    if (reducedMotion) { grow(); return; }
    bars.forEach(function (b) { b.style.width = '6%'; });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { grow(); obs.disconnect(); }
        });
      }, { threshold: 0.4 }).observe(box);
    } else {
      grow();
    }
  })();

  /* ── Project visual: scanner sweep ───────────────────────────────────── */
  (function initScanner() {
    var box = document.querySelector('.project-visual--scan');
    if (!box) return;
    var lines = box.querySelectorAll('.scan-line');
    var fill = box.querySelector('.scan-progress-fill');
    if (!lines.length) return;

    if (reducedMotion) {
      lines.forEach(function (l) {
        l.classList.add(l.getAttribute('data-finding') ? 'hit' : 'passed');
      });
      if (fill) fill.style.width = '100%';
      return;
    }

    var started = false;
    function sweep() {
      if (started || box.dataset.liveRender === '1') return;
      started = true;
      var i = 0;
      var stepDelay = Math.max(80, Math.min(140, Math.round(1200 / Math.max(lines.length, 1))));
      function next() {
        if (box.dataset.liveRender === '1') return;
        if (i > 0) lines[i - 1].classList.remove('scanning');
        if (i >= lines.length) {
          if (fill) fill.style.width = '100%';
          return;
        }
        var line = lines[i];
        line.classList.add('scanning');
        if (fill) fill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        // Capture the element, not the index: i is incremented before this
        // fires, and on the last line it has already wrapped to lines.length.
        if (line.getAttribute('data-finding')) {
          setTimeout(function () {
            if (box.dataset.liveRender !== '1') line.classList.add('hit');
          }, Math.min(100, stepDelay));
        } else {
          // Clean line: the sweep passes over it with a green light.
          setTimeout(function () {
            if (box.dataset.liveRender !== '1') line.classList.add('passed');
          }, Math.min(100, stepDelay));
        }
        i++;
        setTimeout(next, stepDelay);
      }
      next();
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { sweep(); obs.disconnect(); }
        });
      }, { threshold: 0.4 }).observe(box);
    } else {
      sweep();
    }
  })();

  /* ── Interactive project demos ─────────────────────────────────────────
     Cards fetch results from the portfolio backend on first intersection.
     Engine output, bundled fixtures, and simulation-mode RAG responses are
     labeled honestly. If the backend is unreachable, example visuals remain.
     The "run demo" button re-fetches so a reviewer can repeat the interaction. */
  (function initLiveDemos() {
    // Project cards are already in resume order in the HTML.
    var cards = document.querySelectorAll('.project-visual[data-demo]');
    if (!cards.length) return;

    // Same-origin by default; cross-origin to the backend only when the static
    // site is served separately on a non-default port (e.g. http.server on 8080).
    // Default-port HTTP/HTTPS means a reverse proxy (Caddy) fronts the backend,
    // so /api/* and /ws/* resolve against the page's own origin.
    var API = (location.protocol === 'https:' || location.port === '8085'
               || location.port === '' || location.port === '80')
      ? ''
      : (location.hostname === 'localhost'
          ? 'http://localhost:8085'
          : 'http://' + location.hostname + ':8085');

    function getJSON(url) {
      return fetch(API + url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    function postJSON(url, body) {
      return fetch(API + url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    function wsUrl(path) {
      // Cross-origin: convert the http(s) API base to a ws(s) URL. Same-origin
      // (site served by the backend itself): derive from the page location.
      if (API) return API.replace(/^http/i, 'ws') + path;
      var scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return scheme + location.host + path;
    }
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function setLive(card, metric, prefix) {
      var dot = card.querySelector('.live-dot');
      var text = card.querySelector('.live-text');
      if (dot) dot.classList.remove('is-running', 'is-offline', 'is-failed');
      if (dot) dot.classList.add('is-live');
      if (text) {
        text.textContent = (prefix || 'live') + (metric ? ' · ' + metric : '');
      }
    }
    function setOffline(card, label) {
      var dot = card.querySelector('.live-dot');
      var text = card.querySelector('.live-text');
      if (dot) dot.classList.remove('is-live', 'is-running');
      if (dot) dot.classList.add('is-offline');
      if (text) text.textContent = label || 'offline';
    }
    // Visible in-flight state: the card itself shows what is happening, so a
    // re-run is always perceptible even before the data lands.
    function setRunning(card, label) {
      var dot = card.querySelector('.live-dot');
      var text = card.querySelector('.live-text');
      if (dot) dot.classList.remove('is-live', 'is-offline');
      if (dot) dot.classList.add('is-running');
      if (text) text.textContent = label || 'running…';
    }
    // Populate a project's headline outcome metric with a real number.
    function setMetric(key, value) {
      var el = document.querySelector('[data-metric="' + key + '"]');
      if (el && value != null) el.textContent = value;
    }

    /* Contract diff. The portfolio compares bundled fixture specs; the
       API Contract Tester project separately validates live HTTP responses. */
    var diffData = null;
    var diffFilter = 'all';
    var scanSweepTimer = null;
    function renderDiff(data) {
      var box = document.querySelector('.project-visual--diff');
      var output = box ? box.querySelector('.diff-output') : null;
      if (!output || !data || !Array.isArray(data.changes)) return;
      diffData = data;
      var breaking = data.changes.filter(function (c) { return c.severity === 'breaking'; });
      var additive = data.changes.filter(function (c) { return c.severity !== 'breaking'; });
      var visible = diffFilter === 'breaking' ? breaking :
        diffFilter === 'safe' ? additive : data.changes;
      var total = data.changes.length;
      var riskPct = total ? Math.round((breaking.length / total) * 100) : 0;
      var html = '<span class="diff-summary"><b class="s-del">' + breaking.length +
        ' breaking</b><b class="s-add">' + additive.length + ' additive</b><b class="s-mod">' +
        total + ' total changes</b></span>';
      html += '<span class="risk-strip"><span class="risk-label">breaking share</span>' +
        '<span class="risk-bar"><span class="risk-fill" style="width:' + riskPct + '%"></span></span>' +
        '<span class="risk-pct">' + riskPct + '%</span></span>';
      if (!visible.length) {
        html += '<span class="diff-empty-state">No ' +
          (diffFilter === 'breaking' ? 'breaking' : 'additive') + ' changes in this comparison.</span>';
      }
      visible.forEach(function (c) {
        var isBreaking = c.severity === 'breaking';
        var cls = isBreaking
          ? (c.kind === 'removed_endpoint' || c.kind === 'removed_field' ? 'del' : 'ver')
          : 'add';
        var badge = isBreaking ? 'breaking' : 'additive';
        html += '<span class="diff-line diff-' + cls + '"><span class="diff-change-target">' +
          esc(c.target || c.kind || 'change') + '</span><span class="diff-change-detail">' +
          esc(c.detail || '') + '</span><span class="diff-badge ' +
          (isBreaking ? 'breaking' : 'ok') + '">' + badge + '</span></span>';
      });
      html += '<span class="diff-line diff-flag">' + esc(data.old_version || 'old') +
        ' → ' + esc(data.new_version || 'new') + ' · bundled fixture comparison</span>';
      output.innerHTML = html;
      var verdict = box.querySelector('[data-contract-verdict]');
      if (verdict) {
        verdict.classList.toggle('is-blocked', breaking.length > 0);
        verdict.classList.toggle('is-clear', breaking.length === 0);
        verdict.textContent = breaking.length
          ? 'BLOCK RELEASE · ' + breaking.length + ' breaking changes require review'
          : 'COMPATIBLE · no breaking changes found in these fixtures';
      }
      if (box) {
        box.dataset.liveRender = '1';
        box.classList.add('has-live-data');
      }
      setMetric('contract', breaking.length);
    }

    /* Flame / profiler */
    var ws = null;
    var profileFrames = [];
    var profileData = null;
    var profileView = 'share';
    var PROFILE_COLORS = [
      'linear-gradient(90deg,#a78bfa,#7c3aed)',
      'linear-gradient(90deg,#22d3ee,#06b6d4)',
      'linear-gradient(90deg,#ec4899,#be185d)'
    ];
    function renderFlameStatic(data) {
      var wrap = document.querySelector('.project-visual--flame .project-visual-body');
      if (!wrap || !data.functions) return;
      profileData = data;
      var averageButton = wrap.querySelector('[data-profile-view="average"]');
      if (averageButton) { averageButton.disabled = false; averageButton.removeAttribute('title'); }
      profileFrames = [];
      var hotPct = Number(data.hot_path_pct) || 0;
      setMetric('profile', hotPct + '%');
      renderProfileBars();
      var total = wrap.querySelector('[data-profile-total]');
      if (total) total.textContent = (Number(data.total_cpu_time || 0) * 1000).toFixed(1) + ' ms';
      var calls = wrap.querySelector('[data-profile-calls]');
      if (calls) calls.textContent = data.functions.reduce(function (sum, f) {
        return sum + (Number(f.call_count) || 0);
      }, 0).toLocaleString();
      var target = wrap.querySelector('[data-profile-target]');
      if (target) target.textContent = data.hot_path + '()';
      drawProfileTrace();
      var live = wrap.querySelector('.flame-live');
      if (!live) {
        live = document.createElement('div');
        live.className = 'flame-live';
        live.style.cssText = 'width:100%;margin-top:.5rem;font-size:.72rem;color:var(--muted)';
        wrap.appendChild(live);
      }
      live.textContent = 'waiting for live stream';
    }
    function renderProfileBars() {
      if (!profileData) return;
      var wrap = document.querySelector('.project-visual--flame .project-visual-body');
      if (!wrap) return;
      var data = profileData;
      var average = profileView === 'average';
      var functions = data.functions.slice().sort(function (a, b) {
        return average ? b.avg_cpu_time_ms - a.avg_cpu_time_ms : b.cpu_pct - a.cpu_pct;
      });
      if (!functions.length) return;
      var maxAvg = Math.max.apply(null, functions.map(function (f) { return f.avg_cpu_time_ms; })) || 1;
      var first = functions[0];
      var meta = wrap.querySelector('.flame-meta');
      if (meta) meta.innerHTML = '<span>' + (average ? 'slowest call: ' : 'hot path: ') + '<b>' + esc(first.function_name) + '()</b></span>' +
        '<span>' + (average ? first.avg_cpu_time_ms.toFixed(1) + ' ms average / call' : first.cpu_pct.toFixed(1) + '% of recorded CPU') + '</span>';
      var bars = wrap.querySelector('.flame-wrap');
      if (bars) {
        bars.setAttribute('aria-label', average ? 'Measured average CPU time per call by function' : 'Measured CPU share by function');
        var rows = '';
        functions.forEach(function (f, i) {
          rows += '<div class="flame-bar-row' + (i === 0 ? ' is-hot' : '') + '" data-function="' + esc(f.function_name) + '">' +
                  '<span class="flame-bar-name" title="' + esc(f.function_name) + '">' + esc(f.function_name) + '</span>' +
                  '<div class="flame-bar-track"><div class="flame-bar-fill" style="width:0%;background:' + PROFILE_COLORS[i % PROFILE_COLORS.length] + '"></div></div>' +
                  '<span class="flame-bar-pct">' + (average ? f.avg_cpu_time_ms.toFixed(1) + ' ms / call' : f.cpu_pct.toFixed(1) + '% · ' + f.avg_cpu_time_ms.toFixed(1) + ' ms avg') +
                  (i === 0 ? ' · HOT' : '') + '</span></div>';
        });
        bars.innerHTML = rows;
        requestAnimationFrame(function () {
          var fills = bars.querySelectorAll('.flame-bar-fill');
          functions.forEach(function (f, i) {
            if (fills[i]) fills[i].style.width = (average ? f.avg_cpu_time_ms / maxAvg * 100 : f.cpu_pct) + '%';
          });
        });
      }
      var insight = wrap.querySelector('[data-profile-insight]');
      if (insight) insight.textContent = average
        ? first.function_name + '() has the highest average CPU cost per call (' + first.avg_cpu_time_ms.toFixed(1) + ' ms).'
        : first.function_name + '() accounts for ' + first.cpu_pct.toFixed(1) + '% of recorded CPU — the first optimization target.';
    }
    function renderFlameFrame(f) {
      profileFrames.push({
        calls: Number(f.calls_total) || 0,
        cpuMs: Number(f.cpu_this_frame_ms) || 0,
        uptime: Number(f.uptime_s) || 0
      });
      if (profileFrames.length > 24) profileFrames.shift();
      var live = document.querySelector('.project-visual--flame .profile-stream-value');
      if (live) live.textContent = 'last sample ' + (Number(f.cpu_this_frame_ms) || 0).toFixed(1) +
        ' ms · ' + f.calls_total + ' calls · t+' + (Number(f.uptime_s) || 0).toFixed(1) + ' s';
      var summary = document.querySelector('.project-visual--flame .flame-live');
      if (summary) summary.textContent = 'Live measured samples from the profiler decorator';
      drawProfileTrace();
    }

    function drawProfileTrace() {
      var svg = document.getElementById('profile-trace');
      if (!svg) return;
      var W = Math.max(280, Math.round(svg.getBoundingClientRect().width || 640));
      var H = 154, L = 58, R = 12, T = 12, B = 34;
      var iw = W - L - R, ih = H - T - B;
      var values = profileFrames.slice(-18);
      var max = values.reduce(function (acc, frame) { return Math.max(acc, frame.cpuMs); }, 0);
      var meanCpu = values.length ? values.reduce(function (sum, frame) { return sum + frame.cpuMs; }, 0) / values.length : 0;
      var step = max > 20 ? 10 : max > 8 ? 5 : max > 2 ? 2 : 1;
      var yMax = Math.max(step, Math.ceil(Math.max(max * 1.2, step) / step) * step);
      var firstUptime = values.length ? values[0].uptime : 0;
      var elapsedSpan = values.length > 1 ? values[values.length - 1].uptime - firstUptime : 0;
      function x(i) {
        if (values.length < 2) return L + iw / 2;
        var fraction = elapsedSpan > 0
          ? (values[i].uptime - firstUptime) / elapsedSpan
          : i / (values.length - 1);
        return L + iw * fraction;
      }
      function y(v) { return T + ih * (1 - v / yMax); }
      var parts = [
        '<title id="profile-trace-title">CPU time per live sample</title>',
        '<desc id="profile-trace-desc">' + (values.length
          ? values.length + ' recent profiler samples; latest ' + values[values.length - 1].cpuMs.toFixed(1) + ' milliseconds per sample; mean ' + meanCpu.toFixed(1) + ' milliseconds.'
          : 'No live samples yet. Run the profiler to collect measurements.') + '</desc>'
      ];
      [0, yMax / 2, yMax].forEach(function (tick) {
        var ty = y(tick);
        parts.push('<line x1="' + L + '" y1="' + ty.toFixed(1) + '" x2="' + (W - R) +
          '" y2="' + ty.toFixed(1) + '" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>');
        parts.push('<text x="' + (L - 8) + '" y="' + (ty + 4).toFixed(1) +
          '" text-anchor="end" font-size="11" fill="rgba(255,255,255,0.8)">' + tick.toFixed(0) + '</text>');
      });
      if (values.length > 1) {
        var meanY = y(meanCpu);
        parts.push('<line x1="' + L + '" y1="' + meanY.toFixed(1) + '" x2="' + (W - R) +
          '" y2="' + meanY.toFixed(1) + '" stroke="rgba(255,199,70,0.7)" stroke-width="1.5" stroke-dasharray="4 4"/>');
        parts.push('<text x="' + (W - R - 4) + '" y="' + Math.max(T + 12, meanY - 5).toFixed(1) +
          '" text-anchor="end" font-size="10" fill="rgba(255,213,120,0.9)">mean ' + meanCpu.toFixed(1) + ' ms</text>');
      }
      parts.push('<text x="15" y="' + (T + ih / 2).toFixed(1) +
        '" transform="rotate(-90 15 ' + (T + ih / 2).toFixed(1) +
        ')" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.8)">CPU ms / sample</text>');
      if (values.length > 1) {
        parts.push('<text x="' + L + '" y="' + (H - 19) + '" text-anchor="start" font-size="10" fill="rgba(255,255,255,0.76)">0 s</text>');
        parts.push('<text x="' + (W - R) + '" y="' + (H - 19) + '" text-anchor="end" font-size="10" fill="rgba(255,255,255,0.76)">' + elapsedSpan.toFixed(1) + ' s</text>');
      }
      parts.push('<text x="' + (L + iw / 2).toFixed(1) + '" y="' + (H - 5) +
        '" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.8)">elapsed time · recent window</text>');
      if (values.length) {
        var path = '';
        values.forEach(function (frame, i) {
          path += (i ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(frame.cpuMs).toFixed(1);
        });
        parts.push('<path d="' + path + '" fill="none" stroke="rgba(167,139,250,0.98)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
        values.forEach(function (frame, i) {
          parts.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(frame.cpuMs).toFixed(1) +
            '" r="3.5" fill="rgba(167,139,250,1)"><title>sample ' + (i + 1) + ': ' +
            frame.cpuMs.toFixed(1) + ' ms CPU at ' + frame.uptime.toFixed(1) + ' seconds</title></circle>');
        });
      } else {
        parts.push('<text x="' + (L + iw / 2).toFixed(1) + '" y="' + (T + ih / 2).toFixed(1) +
          '" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.68)">Run the profiler to plot live samples</text>');
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = parts.join('');
    }
    function stopFlameLive() {
      var dot = document.querySelector('.project-visual--flame .live-dot');
      var text = document.querySelector('.project-visual--flame .live-text');
      if (dot) dot.classList.remove('is-live');
      if (text) text.textContent = 'profiled';
      var live = document.querySelector('.project-visual--flame .flame-live');
      if (live) live.textContent = 'stream complete';
    }

    /* Vulnerability scan */
    function renderScan(data) {
      var body = document.querySelector('.project-visual--scan .project-visual-body');
      if (!body || !data.findings) return;
      if (scanSweepTimer) { clearTimeout(scanSweepTimer); scanSweepTimer = null; }
      var visual = body.closest('.project-visual--scan');
      if (visual) visual.dataset.liveRender = '1';
      var sevLabel = { sqli: 'SQLi', xss: 'XSS', secrets: 'Secret', outdated_deps: 'Dependency' };
      function severityName(score) {
        if (score >= 0.85) return 'critical';
        if (score >= 0.6) return 'high';
        if (score >= 0.35) return 'medium';
        return 'low';
      }
      // Interleave real clean files (from the same scan) so the sweep shows
      // safe lines getting a green light, not an unbroken wall of hits.
      var clean = data.clean_samples || [];
      var ci = 0;
      var html = '<div class="demo-prompt"><span>THE TRIAGE</span><strong>Which pattern matches need a closer look?</strong></div>' +
        '<div class="scan-results-summary" role="status" aria-live="polite">' +
        '<b>' + (data.total_findings || 0) + ' potential matches</b> across ' +
        (data.repos_scanned || 0) + ' repos · ' + (Number(data.scan_time_ms) || 0).toFixed(1) + ' ms' +
        '<span class="scan-visible-count" data-scan-visible>' +
        Math.min(data.shown_findings || data.findings.length, data.findings.length) +
        ' listed for review</span></div>' +
        '<div class="scan-toolbar"><label for="scan-filter">Show category</label>' +
        '<select class="scan-filter" id="scan-filter"><option value="all">All categories</option>' +
        '<option value="sqli">SQL injection</option><option value="xss">XSS</option>' +
        '<option value="secrets">Hardcoded secrets</option><option value="outdated_deps">Outdated dependencies</option>' +
        '</select></div><div class="scan-window">';
      // Put executable paths ahead of test fixtures and prose; all results
      // remain available, including false positives that demonstrate triage.
      var orderedFindings = data.findings.slice().sort(function (a, b) {
        function rank(f) {
          var path = String(f.file || '');
          if (/\.md$/i.test(path)) return 2;
          if (/(^|\/)(tests?|fixtures?)\//i.test(path)) return 1;
          return 0;
        }
        return rank(a) - rank(b) || (Number(b.severity_score) || 0) - (Number(a.severity_score) || 0);
      });
      orderedFindings.forEach(function (f, idx) {
        if (idx > 0 && idx % 3 === 0 && ci < clean.length) {
          var c = clean[ci++];
          html += '<span class="scan-line scan-clean">' + esc(c.file) +
                  '  <span style="color:var(--muted-dim)">(' + esc(c.repo) + ')</span></span>';
        }
        var cat = String(f.category || 'other');
        var lab = (sevLabel[cat] || f.label || cat) + ' · ' + severityName(Number(f.severity_score) || 0);
        html += '<span class="scan-line" role="button" tabindex="0" aria-label="Inspect ' + esc(lab) + ' in ' + esc(f.repo) + '/' + esc(f.file || '') + '"' +
                ' data-category="' + esc(cat) + '" data-finding="' + esc(lab) + '" data-code="' + esc(f.code) + '"' +
                ' data-location="' + esc(f.repo) + '/' + esc(f.file || '') + ':' + esc(f.line) + '">' +
                esc(f.code) + '  <span class="scan-location">(' + esc(f.repo) + '/' +
                esc(f.file || '') + ':' + esc(f.line) + ')</span></span>';
      });
      html += '</div>';
      html += '<div class="scan-progress"><div class="scan-progress-fill"></div></div>';
      html += '<div class="scan-detail" data-scan-detail role="status">Select a flagged line to inspect why it was surfaced.</div>';
      html += '<span class="scan-note">Regex-based screening · a match needs human review before classification.</span>';
      // severity distribution from the real scan breakdown
      var bd = data.severity_breakdown || {};
      var tot = data.total_findings || 0;
      if (tot) {
        var sevDefs = [['critical', '#ef4444'], ['high', '#f97316'], ['medium', '#eab308'], ['low', '#22c55e']];
        var barH = '', labH = '';
        sevDefs.forEach(function (s) {
          var c = bd[s[0]] || 0;
          if (!c) return;
          barH += '<span style="width:' + (c / tot * 100).toFixed(1) + '%;background:' + s[1] + '"></span>';
          labH += (labH ? ' · ' : '') + c + ' ' + s[0];
        });
        if (barH) html += '<div class="scan-sev"><div class="scan-sev-bar">' + barH + '</div><span class="scan-sev-labels">' + labH + '</span></div>';
      }
      body.innerHTML = html;
      body.classList.add('is-live');
      setMetric('scan', data.total_findings);
      // Animate through the real scan matches and safe lines.
      var lines = body.querySelectorAll('.scan-line');
      var fill = body.querySelector('.scan-progress-fill');
      var win = body.querySelector('.scan-window');
      var i = 0;
      var stepDelay = Math.max(65, Math.min(140, Math.round(4200 / Math.max(lines.length, 1))));
      if (reducedMotion) {
        lines.forEach(function (line) {
          line.classList.add(line.getAttribute('data-finding') ? 'hit' : 'passed');
        });
        if (fill) fill.style.width = '100%';
        return;
      }
      (function next() {
        if (i > 0) lines[i - 1].classList.remove('scanning');
        if (i >= lines.length) {
          if (fill) fill.style.width = '100%';
          scanSweepTimer = null;
          return;
        }
        var line = lines[i];
        line.classList.add('scanning');
        if (fill) fill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        line.classList.add(line.getAttribute('data-finding') ? 'hit' : 'passed');
        if (win) win.scrollTop = Math.max(0, line.offsetTop - win.clientHeight * 0.4);
        i++;
        scanSweepTimer = setTimeout(next, stepDelay);
      })();
    }

    /* RAG (code assistant), v2: pipeline stages (embed ▸ retrieve ▸
       synthesize), ranked sources with snippets, a streamed answer, and the
       latency/model metadata the API already returns. The visual body keeps
       a fixed structure (query / stages / sources / answer / meta); a live
       run only re-fills it, so the canned and live states share one layout. */
    var RAG_QUESTIONS = [
      'How does the retrieval index rank code chunks?',
      'How are code chunks embedded?',
      'How does the system build citations?',
    ];
    var ragQ = 0;
    var ragBusy = false;
    var ragTypeTimer = null;
    var ragStaggerTimer = null;

    function ragBody() {
      var box = document.querySelector('.project-visual--rag');
      return box ? box.querySelector('.project-visual-body') : null;
    }

    function ragSetStage(name, cls) {
      var body = ragBody();
      var el = body ? body.querySelector('.rag-stage[data-stage="' + name + '"]') : null;
      if (el) el.className = 'rag-stage ' + (cls || '');
    }

    function ragSnippet(text, max) {
      var t = String(text || '').replace(/\s+/g, ' ').trim();
      if (!t) return '';
      max = max || 88;
      return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
    }

    // One ranked source row: [rank] file:line-range symbol + score bar + the
    // retrieved snippet underneath (the passage the answer is grounded in.
    function ragSourceLine(s, i) {
      var file = s.path ? s.path.split('/').pop() : 'source';
      var range = '';
      if (s.start_line) {
        range = s.end_line && s.end_line !== s.start_line
          ? ':' + s.start_line + '-' + s.end_line
          : ':' + s.start_line;
      }
      var sym = s.symbol && s.symbol !== '<module>' ? ' ' + s.symbol : '';
      var score = s.score != null ? s.score : 0;
      var bar = Math.round(Math.max(0, Math.min(1, score)) * 100);
      return '<span class="rag-src" data-rank="' + (i + 1) + '" style="animation-delay:' + (i * 240) + 'ms">' +
        '<span class="rag-rank">[' + (i + 1) + ']</span> ' + esc(file) + esc(range) + esc(sym) +
        ' <span class="rag-scorbar"><span style="width:' + bar + '%"></span></span>' +
        ' <span class="rag-score">' + (s.score != null ? s.score.toFixed(2) : '-') + '</span>' +
        (s.snippet ? '<span class="rag-snippet">' + esc(ragSnippet(s.snippet)) + '</span>' : '') +
        '</span>';
    }

    // Stream the answer so synthesis reads as generation, not a paste.
    // Long answers are chunked to cap at ~1.4s; reduced-motion renders the
    // whole answer instantly.
    function ragTypeAnswer(el, text, done) {
      if (ragTypeTimer) { clearInterval(ragTypeTimer); ragTypeTimer = null; }
      if (reducedMotion) {
        el.classList.remove('rag-cursor');
        el.textContent = text;
        if (done) done();
        return;
      }
      el.classList.add('rag-cursor');
      el.textContent = '';
      var i = 0;
      var step = Math.max(2, Math.round(text.length / 85));
      ragTypeTimer = setInterval(function () {
        i += step;
        el.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(ragTypeTimer);
          ragTypeTimer = null;
          el.classList.remove('rag-cursor');
          if (done) done();
        }
      }, 16);
    }

    // Reset the body to "request in flight": fresh query, embed stage active,
    // empty sources, cleared answer + meta.
    function ragPrepareRun(question) {
      var body = ragBody();
      if (!body) return;
      // The canned rows start hidden (`.hidden-line`); a live run owns the
      // layout, so drop the hidden/revealed state on the fixed rows now.
      ['.rag-stages', '.rag-answer', '.rag-meta'].forEach(function (sel) {
        var el = body.querySelector(sel);
        if (el) el.classList.remove('hidden-line', 'rag-revealed');
      });
      var q = body.querySelector('.rag-q');
      if (q) q.textContent = question;
      var stages = body.querySelectorAll('.rag-stage');
      stages.forEach(function (st, i) { st.className = 'rag-stage' + (i === 0 ? ' is-active' : ''); });
      // Cancel any deferred work from a run that was just interrupted
      // (stagger timeout, typewriter) so it can't write into this run.
      if (ragStaggerTimer) { clearTimeout(ragStaggerTimer); ragStaggerTimer = null; }
      if (ragTypeTimer) { clearInterval(ragTypeTimer); ragTypeTimer = null; }
      var srcs = body.querySelector('.rag-srcs');
      if (srcs) srcs.innerHTML = '';
      var ans = body.querySelector('.rag-answer');
      if (ans) {
        ans.classList.remove('rag-cursor', 'rag-error');
        ans.textContent = '';
      }
      var meta = body.querySelector('.rag-meta');
      if (meta) { meta.textContent = ''; meta.classList.remove('is-on'); }
      body.classList.add('is-live');
    }

    function renderRag(data) {
      var body = ragBody();
      if (!body) return;
      var sources = data.sources || [];
      var q = body.querySelector('.rag-q');
      if (q && data.question) q.textContent = data.question;
      // Embed is done by the time the response lands; retrieval is what just
      // produced these sources.
      ragSetStage('embed', 'is-done');
      ragSetStage('retrieve', 'is-active');
      var srcs = body.querySelector('.rag-srcs');
      var html = '';
      sources.forEach(function (s, i) { html += ragSourceLine(s, i); });
      if (!sources.length) html = '<span class="rag-src">no sources retrieved</span>';
      if (srcs) srcs.innerHTML = html;
      setMetric('rag', sources.length || 0);
      // Let the sources stagger in, then stream the answer. Tracked so a
      // faster re-run can cancel it (see ragPrepareRun).
      var delay = reducedMotion ? 0 : 240 * sources.length + 300;
      ragStaggerTimer = setTimeout(function () {
        ragSetStage('retrieve', 'is-done');
        ragSetStage('synthesize', 'is-active');
        var ans = body.querySelector('.rag-answer');
        var meta = body.querySelector('.rag-meta');
        var text = String(data.answer || '').trim() || 'no answer generated';
        ragTypeAnswer(ans, text, function () {
          ragSetStage('synthesize', 'is-done');
          if (meta) {
            var cites = sources.slice(0, 4).map(function (_, i) { return '[' + (i + 1) + ']'; }).join(' ');
            // Simulate mode answers in ~0ms; floor to 1 so a real number
            // shows (the "simulated" label keeps the speed honest).
            meta.textContent = 'answered in ' + Math.max(1, Math.round(data.latency_ms || 0)) + 'ms' +
              (data.model ? ' · model ' + data.model : '') +
              (data.engine ? ' · engine ' + data.engine : '') +
              (cites ? ' · cited ' + cites : '');
            meta.classList.add('is-on');
          }
        });
      }, delay);
    }

    // Honest degradation: pipeline or model down. Keep the layout, mark the
    // failed stage, show the reason; never a blank terminal.
    function renderRagError(data, question) {
      var body = ragBody();
      if (!body) return;
      // May run on the untouched canned layout (no successful run yet), so
      // drop hidden/revealed state on the fixed rows and cancel any pending
      // timers before rendering the error.
      ['.rag-stages', '.rag-answer', '.rag-meta'].forEach(function (sel) {
        var el = body.querySelector(sel);
        if (el) el.classList.remove('hidden-line', 'rag-revealed');
      });
      if (ragStaggerTimer) { clearTimeout(ragStaggerTimer); ragStaggerTimer = null; }
      if (ragTypeTimer) { clearInterval(ragTypeTimer); ragTypeTimer = null; }
      var q = body.querySelector('.rag-q');
      if (q && question) q.textContent = question;
      ragSetStage('embed', 'is-done');
      ragSetStage('retrieve', 'is-done');
      ragSetStage('synthesize', 'is-fail');
      var srcs = body.querySelector('.rag-srcs');
      if (srcs) srcs.innerHTML = '<span class="rag-src">no sources retrieved</span>';
      var raw = String((data && data.error) || 'model offline');
      var msg = /urlopen|connection|refused|timeout|timed out/i.test(raw)
        ? 'code-rag service offline' : raw;
      if (msg.length > 140) msg = msg.slice(0, 140) + '…';
      var ans = body.querySelector('.rag-answer');
      if (ans) {
        if (ragTypeTimer) { clearInterval(ragTypeTimer); ragTypeTimer = null; }
        ans.classList.remove('rag-cursor');
        ans.classList.add('rag-error');
        ans.textContent = '! answer unavailable: ' + msg;
      }
      var meta = body.querySelector('.rag-meta');
      if (meta) { meta.textContent = 'pipeline stopped at synthesis'; meta.classList.add('is-on'); }
      body.classList.add('is-live');
    }

    // Reveal the canned RAG lines in sequence. Called when the card scrolls
    // into view, and again if the live demo can't reach the backend, so the
    // terminal never stays a blank box. Gated on the body not being
    // live-rendered: a successful run owns the layout after that.
    var ragRevealed = false;
    function ragReveal() {
      if (ragRevealed) return;
      ragRevealed = true;
      var box = document.querySelector('.project-visual--rag');
      if (!box) return;
      var body = box.querySelector('.project-visual-body');
      if (body && body.classList.contains('is-live')) return;
      var lines = box.querySelectorAll('.hidden-line');
      lines.forEach(function (l, i) {
        setTimeout(function () { l.classList.add('rag-revealed'); }, reducedMotion ? 0 : 350 + i * 300);
      });
    }
    if (reducedMotion || !('IntersectionObserver' in window)) ragReveal();
    else {
      var ragBox = document.querySelector('.project-visual--rag');
      if (ragBox) {
        new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { ragReveal(); obs.disconnect(); }
          });
        }, { threshold: 0.4 }).observe(ragBox);
      }
    }

    /* ── FaultLine chaos demo: live event stream + final SLO verdict ─────── */
    var chaosWs = null;
    var chaosFinish = null;

    function chaosConsole(card) {
      return card.querySelector('#chaos-console');
    }

    function appendChaosLine(card, text, cls) {
      var consoleEl = chaosConsole(card);
      if (!consoleEl) return;
      var line = document.createElement('span');
      line.className = 'chaos-line' + (cls ? ' ' + cls : '');
      line.textContent = text;
      consoleEl.appendChild(line);
      while (consoleEl.children.length > 60) consoleEl.removeChild(consoleEl.firstChild);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function resetChaosConsole(card, firstLine) {
      var consoleEl = chaosConsole(card);
      if (!consoleEl) return;
      consoleEl.innerHTML = '';
      // Hide the previous run's verdict so a re-run never shows a stale one.
      var verdictEl = card.querySelector('#chaos-verdict');
      if (verdictEl) { verdictEl.textContent = ''; verdictEl.className = 'chaos-verdict'; }
      chaosResetChart(card);
      appendChaosLine(card, firstLine || '$ faultline run --experiment portfolio-demo', '');
    }

    function renderChaosEvent(card, ev) {
      // Probe lines: "POST http://127.0.0.1:PORT/api/orders -> 201 12.9ms"
      var label = (ev.phase || 'info').toUpperCase();
      var text = ev.message || '';
      if (typeof ev.ok === 'boolean') {
        var m = String(text).match(/^(GET|POST)\s+https?:\/\/[^/]+(\S*)\s+->\s+(.*)$/);
        if (m) {
          text = m[1] + ' ' + (m[2] || '/') + ' -> ' + m[3];
        }
      }
      var cls = '';
      if (ev.phase === 'fault') cls = ev.ok === false ? 'chaos-line--err' : 'chaos-line--fault';
      else if (ev.phase === 'recovery') cls = 'chaos-line--ok';
      else if (ev.phase === 'evaluate') cls = 'chaos-line--slo';
      else if (ev.phase === 'target') cls = 'chaos-line--dim';
      appendChaosLine(card, '[' + label + '] ' + text, cls);
      // Feed the latency chart with every real probe sample.
      if ((ev.phase === 'baseline' || ev.phase === 'fault' || ev.phase === 'recovery') &&
          typeof ev.ok === 'boolean' && Object.prototype.hasOwnProperty.call(ev, 'latency_ms')) {
        chaosPts.push({
          phase: ev.phase,
          ms: typeof ev.latency_ms === 'number' ? ev.latency_ms : null,
          err: ev.ok === false
        });
        renderChaosChart(card);
      }
    }

    function renderChaosFinal(card, frame) {
      var verdictEl = card.querySelector('#chaos-verdict');
      if (frame.error) {
        appendChaosLine(card, '[ERROR] ' + frame.error, 'chaos-line--err');
        if (verdictEl) { verdictEl.textContent = 'run failed'; verdictEl.className = 'chaos-verdict is-error'; }
        if (chaosFinish) chaosFinish(false);
        return;
      }
      var rep = frame.report || {};
      var fail = 0, total = 0;
      (rep.slo_results || []).forEach(function (s) { total++; if (!s.passed) fail++; });
      if (verdictEl) {
        verdictEl.textContent = 'VERDICT: ' + (rep.verdict === 'pass' ? 'PASS' : 'FAIL') +
          ' · ' + fail + '/' + total + ' SLO hypotheses breached';
        verdictEl.className = 'chaos-verdict is-' + (rep.verdict === 'pass' ? 'pass' : 'fail');
      }
      // Metric: measured p95 latency in the fault window.
      var w = (rep.windows || {}).fault;
      if (w && w.p95_ms != null) setMetric('chaos', Math.round(w.p95_ms) + 'ms');
      setLive(card, (rep.verdict === 'pass' ? 'PASS · all SLOs held' : 'FAIL · SLO breach detected') +
        (w && w.p95_ms != null ? ' · fault p95 ' + Math.round(w.p95_ms) + 'ms' : ''), 'completed');
      if (rep.verdict !== 'pass') {
        var resultDot = card.querySelector('.live-dot');
        if (resultDot) resultDot.classList.add('is-failed');
      }
      // Finalize the per-phase strip from the graded report windows, then
      // render the SLO hypothesis chips: name, measured vs limit, status.
      updateChaosPhaseStats(card, rep.windows || {});
      if (!card.querySelector('.cw-chip[aria-pressed="true"]')) chooseChaosPhase(card, 'fault');
      var sloHost = card.querySelector('#slo-chips');
      if (sloHost) {
        var sloHtml = '';
        (rep.slo_results || []).forEach(function (s) {
          var checks = (s.checks || []).map(function (c) {
            if (c.check === 'p95_latency_ms') {
              return 'p95 ' + (c.actual != null ? c.actual.toFixed(1) : '?') + 'ms vs ≤' + c.limit + 'ms';
            }
            if (c.check === 'error_rate') {
              return 'err ' + (c.actual != null ? Math.round(c.actual * 100) : '?') + '% vs ≤' + Math.round((c.limit || 0) * 100) + '%';
            }
            return esc(c.check);
          }).join(' · ');
          sloHtml += '<span class="slo-chip is-' + (s.passed ? 'pass' : 'fail') + '">' +
            '<span class="slo-dot"></span>' + esc(s.name) +
            (checks ? ' <span class="slo-detail">' + checks + '</span>' : '') + '</span>';
        });
        if (sloHtml) sloHost.innerHTML = sloHtml;
      }
      if (chaosFinish) chaosFinish(true);
    }

    /* ── Chaos latency chart (SVG): live probes vs SLO, phase-banded ─────
       Recent p95 uses the last 12 probes with latency. Request errors are
       counted separately; the engine grades its final SLO per phase.       */
    var chaosPts = [];
    var CHAOS_YFLOOR = 50;  // keeps the 25 ms SLO visible without flattening typical samples
    var CHAOS_SLO = 25;     // the p95 SLO the demo grades against (ms)
    var CHAOS_XCAP = 56;    // x-axis probe capacity for a full demo run
    var CHAOS_P95_WINDOW = 12;
    var CHAOS_PHASE = {
      baseline: { line: 'rgba(148,163,184,0.85)', band: 'rgba(148,163,184,0.06)' },
      fault:    { line: 'rgba(167,139,250,0.95)', band: 'rgba(239,68,68,0.07)' },
      recovery: { line: 'rgba(134,239,172,0.9)',  band: 'rgba(34,197,94,0.05)' }
    };

    // Percentile with linear interpolation between closest ranks (the same
    // method as FaultLine's own SLO math, so the live traces agree with the
    // graded verdict.
    function chaosPercentile(sortedAsc, p) {
      if (!sortedAsc.length) return null;
      var rank = (p / 100) * (sortedAsc.length - 1);
      var lo = Math.floor(rank);
      var hi = Math.min(lo + 1, sortedAsc.length - 1);
      return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
    }

    function chaosRecentP95(endIndex) {
      var start = Math.max(0, endIndex - CHAOS_P95_WINDOW + 1);
      var samples = [];
      for (var i = start; i <= endIndex; i++) {
        if (chaosPts[i].ms != null) samples.push(chaosPts[i].ms);
      }
      samples.sort(function (a, b) { return a - b; });
      return chaosPercentile(samples, 95);
    }

    function chaosResetChart(card) {
      chaosPts = [];
      renderChaosChart(card);
      updateChaosPhaseStats(card, null);
      var slo = card ? card.querySelector('#slo-chips') : null;
      if (slo) slo.innerHTML = '';
    }

    function chooseChaosPhase(card, phase) {
      var notes = {
        baseline: 'Control window before the fault. Compare this p95 with the 25 ms threshold.',
        fault: 'CPU pressure window. The POST /api/orders SLO is graded here even when every request succeeds.',
        recovery: 'Pressure has stopped. This window shows whether latency returns below the SLO.'
      };
      var selected = null;
      card.querySelectorAll('.cw-chip').forEach(function (chip) {
        var active = chip.getAttribute('data-cw') === phase;
        chip.classList.toggle('is-selected', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (active) selected = chip;
      });
      var insight = card.querySelector('[data-chaos-phase-insight]');
      if (!insight || !selected) return;
      var measurement = selected.querySelector('.cw-val').textContent;
      insight.textContent = phase.toUpperCase() + ' · ' + (measurement === '--' ? 'waiting for probes' : measurement) + ' — ' + notes[phase];
    }

    /* Per-phase stats strip: p95 · probe count · error rate per phase, live
       from the streamed probes during a run and finalized from the real
       report windows when it ends. */
    function updateChaosPhaseStats(card, reportWindows) {
      if (!card) return;
      var host = card.querySelector('#chaos-windows');
      if (!host) return;
      ['baseline', 'fault', 'recovery'].forEach(function (ph) {
        var chip = host.querySelector('[data-cw="' + ph + '"]');
        if (!chip) return;
        var val = chip.querySelector('.cw-val');
        if (!val) return;
        var text;
        if (reportWindows && reportWindows[ph] && reportWindows[ph].samples) {
          var w = reportWindows[ph];
          text = (w.p95_ms != null ? Math.round(w.p95_ms) + 'ms p95' : 'no data') +
            ' · ' + (w.samples || 0) + ' probes · err ' +
            (w.error_rate != null ? Math.round(w.error_rate * 100) : 0) + '%';
        } else {
          var lats = [], n = 0, bad = 0;
          for (var i = 0; i < chaosPts.length; i++) {
            var pt = chaosPts[i];
            if (pt.phase !== ph) continue;
            n++;
            if (pt.err || pt.ms == null) bad++;
            else lats.push(pt.ms);
          }
          if (!n) { val.textContent = '--'; chip.classList.remove('is-on'); return; }
          var srt = lats.slice().sort(function (a, b) { return a - b; });
          var p95 = chaosPercentile(srt, 95);
          text = (p95 != null ? Math.round(p95) + 'ms p95' : 'no latency') +
            ' · ' + n + ' probes · err ' + Math.round((bad / n) * 100) + '%';
        }
        val.textContent = text;
        chip.classList.add('is-on');
      });
      var selected = host.querySelector('.cw-chip[aria-pressed="true"]');
      if (selected) chooseChaosPhase(card, selected.getAttribute('data-cw'));
    }

    function renderChaosChart(card) {
      var svg = card.querySelector('#chaos-chart');
      if (!svg) return;
      var W = Math.max(280, Math.round(svg.getBoundingClientRect().width)) || 640;
      var mobileChart = window.matchMedia('(max-width: 640px)').matches;
      var H = mobileChart ? 270 : 292, L = 66, R = 18, T = 36, B = 48;
      var iw = W - L - R, ih = H - T - B;
      var n = chaosPts.length;
      var denom = Math.max(CHAOS_XCAP, n);
      function x(i) { return L + iw * ((i + 0.5) / denom); }
      var maxMs = 0;
      for (var m0 = 0; m0 < n; m0++) if (chaosPts[m0].ms != null && chaosPts[m0].ms > maxMs) maxMs = chaosPts[m0].ms;
      var rawMax = Math.max(CHAOS_YFLOOR, maxMs * 1.16);
      var magnitude = Math.pow(10, Math.floor(Math.log10(rawMax / 5)));
      var normalized = rawMax / (5 * magnitude);
      var step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
      var yMax = Math.ceil(rawMax / step) * step;
      function y(ms) { return T + ih * (1 - Math.max(0, Math.min(ms, yMax)) / yMax); }
      var parts = [
        '<title id="chaos-chart-title">FaultLine probe latency over the experiment</title>',
        '<desc id="chaos-chart-desc">' + (n
          ? n + ' probes grouped by baseline, CPU pressure, and recovery. The chart, recent p95, and phase summaries include POST /api/orders and GET /health; SLO hypotheses grade POST /api/orders only. The chart shows latency in milliseconds; the dashed trace is p95 over successful latency samples from the last 12 probes. Errors are counted separately.'
          : 'Experiment plan preview with baseline, CPU pressure, and recovery stages; no measured probes yet. Run the experiment to plot latency. The amber line marks the 25 millisecond threshold.') + '</desc>'
      ];
      var sy = y(CHAOS_SLO);
      parts.push('<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + Math.max(0, sy - T).toFixed(1) + '" fill="rgba(239,68,68,0.075)"/>');
      for (var i = 0; i <= yMax; i += step) {
        var g = i;
        var gy = y(g);
        parts.push('<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>');
        parts.push('<text x="' + (L - 9) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="rgba(255,255,255,0.9)">' + g + '</text>');
      }
      parts.push('<text x="17" y="' + (T + ih / 2).toFixed(1) + '" transform="rotate(-90 17 ' + (T + ih / 2).toFixed(1) + ')" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.88)">Latency (ms)</text>');
      parts.push('<text x="' + (L + iw / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.88)">Probe number</text>');
      var xStep = Math.max(1, Math.ceil(denom / 5));
      for (var xt = 0; xt < denom; xt += xStep) {
        var tx = L + iw * ((xt + 0.5) / denom);
        parts.push('<line x1="' + tx.toFixed(1) + '" y1="' + (T + ih) + '" x2="' + tx.toFixed(1) + '" y2="' + (T + ih + 4) + '" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>');
        parts.push('<text x="' + tx.toFixed(1) + '" y="' + (T + ih + 19) + '" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.82)">' + (xt + 1) + '</text>');
      }
      if (!n) {
        [
          ['BASELINE', 'establish control', 'rgba(148,163,184,0.05)'],
          ['CPU PRESSURE', 'inject bounded fault', 'rgba(167,139,250,0.07)'],
          ['RECOVERY', 'grade rebound', 'rgba(134,239,172,0.05)']
        ].forEach(function (stage, i) {
          var bx = L + iw * i / 3;
          var bw = iw / 3;
          parts.push('<rect x="' + bx.toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + ih + '" fill="' + stage[2] + '"/>');
          if (i) parts.push('<line x1="' + bx.toFixed(1) + '" y1="' + T + '" x2="' + bx.toFixed(1) + '" y2="' + (T + ih) + '" stroke="rgba(255,255,255,0.22)" stroke-dasharray="4 5"/>');
          parts.push('<text x="' + (bx + bw / 2).toFixed(1) + '" y="' + (T + 27) + '" text-anchor="middle" font-size="11" font-weight="700" fill="rgba(255,255,255,0.8)">' + (mobileChart && i === 1 ? 'FAULT' : stage[0]) + '</text>');
          if (!mobileChart) parts.push('<text x="' + (bx + bw / 2).toFixed(1) + '" y="' + (T + 43) + '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.55)">' + stage[1] + '</text>');
        });
      } else {
        // Phase bands give the experiment sequence a clear left-to-right story.
        var i = 0;
        while (i < n) {
          var j = i;
          while (j + 1 < n && chaosPts[j + 1].phase === chaosPts[i].phase) j++;
          var ph = CHAOS_PHASE[chaosPts[i].phase] || CHAOS_PHASE.baseline;
          var x0 = L + iw * (i / denom);
          var x1 = L + iw * ((j + 1) / denom);
          parts.push('<rect x="' + x0.toFixed(1) + '" y="' + T + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + ih + '" fill="' + ph.band + '"/>');
          if (i > 0) parts.push('<line x1="' + x0.toFixed(1) + '" y1="' + T + '" x2="' + x0.toFixed(1) + '" y2="' + (T + ih) + '" stroke="rgba(255,255,255,0.58)" stroke-width="1" stroke-dasharray="4 4"/>');
          var d = '';
          for (var k = i; k <= j; k++) {
            if (chaosPts[k].ms == null) { d += ''; continue; }
            d += (d && k > i && chaosPts[k - 1].ms != null ? ' L' : ' M') + x(k).toFixed(1) + ' ' + y(chaosPts[k].ms).toFixed(1);
          }
          if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + ph.line + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
          parts.push('<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (T - 10) + '" text-anchor="middle" font-size="11" font-weight="600" fill="rgba(255,255,255,0.95)">' + chaosPts[i].phase.toUpperCase() + '</text>');
          i = j + 1;
        }
        // Plot a real rolling window; break the trace at failed probes so the
        // visual does not imply that an error had a measured latency.
        var rp95 = '', previousLatency = false, y95End = 0, x95End = x(0);
        for (var r = 0; r < n; r++) {
          if (chaosPts[r].ms == null) { previousLatency = false; continue; }
          var recentP95 = chaosRecentP95(r);
          y95End = y(recentP95);
          x95End = x(r);
          rp95 += (previousLatency ? ' L' : ' M') + x(r).toFixed(1) + ' ' + y95End.toFixed(1);
          previousLatency = true;
        }
        if (rp95) {
          parts.push('<path d="' + rp95 + '" fill="none" stroke="rgba(255,255,255,0.98)" stroke-width="3" stroke-dasharray="7 5" stroke-linejoin="round"/>');
          var p95LabelY = Math.max(T + 14, Math.min(T + ih - 10, y95End - 8));
          parts.push('<text x="' + (x95End - 8).toFixed(1) + '" y="' + p95LabelY.toFixed(1) + '" text-anchor="end" font-size="12" font-weight="600" fill="rgba(255,255,255,1)">p95</text>');
        }
        // Larger points carry exact values in native SVG tooltips.
        for (var q = 0; q < n; q++) {
          var pt = chaosPts[q];
          if (pt.ms == null) {
            if (pt.err) {
              var ex = x(q), ey = y(0);
              parts.push('<path d="M ' + (ex - 4).toFixed(1) + ' ' + (ey - 4).toFixed(1) + ' L ' + (ex + 4).toFixed(1) + ' ' + (ey + 4).toFixed(1) + ' M ' + (ex - 4).toFixed(1) + ' ' + (ey + 4).toFixed(1) + ' L ' + (ex + 4).toFixed(1) + ' ' + (ey - 4).toFixed(1) + '" stroke="#ff8b8b" stroke-width="2"><title>probe ' + (q + 1) + ' · request error</title></path>');
            }
            continue;
          }
          var col = (CHAOS_PHASE[pt.phase] || CHAOS_PHASE.baseline).line;
          parts.push('<circle cx="' + x(q).toFixed(1) + '" cy="' + y(pt.ms).toFixed(1) + '" r="3.6" fill="' + col + '" stroke="rgba(255,255,255,0.9)" stroke-width="1"><title>probe ' + (q + 1) + ' · ' + pt.phase + ' · ' + pt.ms.toFixed(1) + ' ms</title></circle>');
        }
      }
      parts.push('<line x1="' + L + '" y1="' + sy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + sy.toFixed(1) + '" stroke="rgba(255,190,70,1)" stroke-width="2"/>');
      parts.push('<text x="' + (L + 8) + '" y="' + Math.max(T + 14, sy - 8).toFixed(1) + '" font-size="12" font-weight="600" fill="rgba(255,208,120,1)">25 ms SLO</text>');
      if (!n) {
        parts.push('<text x="' + (L + iw / 2) + '" y="' + (T + ih - 18) + '" text-anchor="middle" font-size="' + (mobileChart ? 10 : 12) + '" fill="rgba(255,255,255,0.72)">' + (mobileChart ? 'RUN TO PLOT PROBES' : 'EXPERIMENT PLAN · run to plot measured probes') + '</text>');
      }
      var errorsNow = 0;
      chaosPts.forEach(function (point) {
        if (point.err || point.ms == null) errorsNow++;
      });
      var p95Now = n ? chaosRecentP95(n - 1) : null;
      var p95El = card.querySelector('[data-chaos-summary="p95"]');
      var probesEl = card.querySelector('[data-chaos-summary="probes"]');
      var errorsEl = card.querySelector('[data-chaos-summary="errors"]');
      var headroomEl = card.querySelector('[data-chaos-summary="headroom"]');
      if (p95El) p95El.textContent = p95Now == null ? '—' : p95Now.toFixed(1) + ' ms';
      if (probesEl) probesEl.textContent = String(n);
      if (errorsEl) errorsEl.textContent = String(errorsNow);
      if (headroomEl) headroomEl.textContent = p95Now == null ? '—' :
        (p95Now <= CHAOS_SLO ? (CHAOS_SLO - p95Now).toFixed(1) + ' ms under line' :
          (p95Now - CHAOS_SLO).toFixed(1) + ' ms over line');
      updateChaosPhaseStats(card, null);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = parts.join('');
    }

    // Recompute SVG viewBoxes when cards move between desktop and mobile
    // widths; a resized viewBox keeps axis labels legible instead of scaling
    // the entire desktop chart down as one image.
    if (window.ResizeObserver) {
      var chartResizeObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.target.id === 'chaos-chart') {
            var chaosCard = entry.target.closest('[data-demo="chaos"]');
            if (chaosCard) renderChaosChart(chaosCard);
          } else if (entry.target.id === 'profile-trace') {
            drawProfileTrace();
          }
        });
      });
      ['chaos-chart', 'profile-trace'].forEach(function (id) {
        var chart = document.getElementById(id);
        if (chart) chartResizeObserver.observe(chart);
      });
    }

    function loadDemo(kind, card, questionOverride) {
      var run = card.querySelector('.live-run');
      // Re-entrancy guard: ignore clicks while a run is in flight, and let the
      // button be re-clicked afterwards so a reviewer can re-run any engine.
      if (run && run.dataset.busy === '1') return;
      var startedAt = Date.now();
      var actionLabels = { chaos: 'Run experiment', contract: 'Compare specs', rag: 'Ask codebase', scan: 'Scan repos', profile: 'Profile workload' };
      if (run) {
        run.dataset.busy = '1';
        run.disabled = true;
        run.classList.add('is-running');
        run.textContent = kind === 'rag' ? 'thinking…' :
          kind === 'scan' ? 'scanning…' :
          kind === 'profile' ? 'profiling…' :
          kind === 'chaos' ? 'injecting…' : 'diffing…';
      }
      var ragInput = kind === 'rag' ? card.querySelector('.rag-query-input') : null;
      var ragAsk = kind === 'rag' ? card.querySelector('.rag-ask') : null;
      if (ragInput) ragInput.disabled = true;
      if (ragAsk) { ragAsk.disabled = true; ragAsk.textContent = 'Working…'; }
      var finish = function (ok) {
        // Leave a brief in-flight cue without blocking a second interaction.
        var wait = Math.max(0, 450 - (Date.now() - startedAt));
        setTimeout(function () {
          if (run) { run.dataset.busy = ''; run.textContent = actionLabels[kind]; run.disabled = false; run.classList.remove('is-running'); }
          if (ragInput) ragInput.disabled = false;
          if (ragAsk) { ragAsk.disabled = false; ragAsk.textContent = 'Ask codebase'; }
          if (!ok) setOffline(card);
        }, wait);
      };
      if (kind === 'contract') {
        setRunning(card, 'running…');
        getJSON('/api/contract').then(function (d) {
          renderDiff(d);
          setLive(card, d.breaking_count + ' breaking', 'fixture');
          finish(true);
        }).catch(function () { finish(false); });
      } else if (kind === 'profile') {
        setRunning(card, 'profiling…');
        getJSON('/api/profile').then(function (d) {
          renderFlameStatic(d);
          finish(true);
          // then stream live frames
          try {
            if (ws) { try { ws.close(); } catch (e) {} ws = null; }
            ws = new WebSocket(wsUrl('/ws/profile'));
            var cardDot = card.querySelector('.live-dot');
            var cardText = card.querySelector('.live-text');
            if (cardDot) cardDot.classList.add('is-live');
            if (cardText) cardText.textContent = 'live · streaming';
            ws.onmessage = function (ev) { renderFlameFrame(JSON.parse(ev.data)); };
            ws.onclose = stopFlameLive;
            ws.onerror = stopFlameLive;
          } catch (e) { /* no WS support */ }
        }).catch(function () { finish(false); });
      } else if (kind === 'scan') {
        setRunning(card, 'scanning…');
        getJSON('/api/scan').then(function (d) {
          renderScan(d);
          setLive(card, d.total_findings + ' potential matches · ' + d.repos_scanned + ' repos', 'scanned');
          finish(true);
        }).catch(function () { finish(false); });
      } else if (kind === 'rag') {
        if (ragBusy) { if (run) run.textContent = 'thinking…'; return; }
        ragBusy = true;
        setRunning(card, 'thinking…');
        if (run) run.textContent = 'thinking…';
        var question = String(questionOverride || (ragInput && ragInput.value) ||
          RAG_QUESTIONS[ragQ % RAG_QUESTIONS.length]).trim();
        ragQ++;
        postJSON('/api/rag', { question: question }).then(function (d) {
          if (d.status === 'ERROR' || !d.answer) {
            // The retrieval pipeline or the local model is down. Show the
            // honest error in the terminal instead of a blank screen.
            renderRagError(d, question);
            setOffline(card, 'model offline');
            finish(true);
            return;
          }
          // Prepare the layout only once the run is known to render, so a
          // network failure (catch below) leaves the canned rows untouched
          // and ragReveal() can still fill the terminal.
          ragPrepareRun(question);
          renderRag(d);
          var ms = d.latency_ms != null ? Math.max(1, Math.round(d.latency_ms)) + 'ms' : '';
          // Simulation mode is the zero-model demo default; label it honestly.
          var mode = d.model === 'simulated' ? ' · simulated' : '';
          setLive(card, (d.sources ? d.sources.length : 0) + ' sources' + (ms ? ' · ' + ms : '') + mode);
          finish(true);
        }).catch(function () {
          finish(false);
          // Backend unreachable: show the canned example lines instead of
          // leaving the terminal blank.
          ragReveal();
        }).then(function () { ragBusy = false; });
      } else if (kind === 'chaos') {
        setRunning(card, 'injecting…');
        if (run) run.textContent = 'injecting…';
        resetChaosConsole(card);
        chaosFinish = finish;
        var settled = false;
        var replayQueue = [];
        // A final frame (or an explicit failure) settles the run: no further
        // frames for it are rendered and the safety timeout is disarmed.
        var applyFrame = function (frame) {
          if (frame.type === 'event') renderChaosEvent(card, frame);
          else if (frame.type === 'final') { settled = true; renderChaosFinal(card, frame); }
        };
        // Open the stream first: the server replays whatever run is current.
        try {
          if (chaosWs) { try { chaosWs.close(); } catch (e) {} chaosWs = null; }
          chaosWs = new WebSocket(wsUrl('/ws/chaos'));
          chaosWs.onmessage = function (ev) {
            var frame;
            try { frame = JSON.parse(ev.data); } catch (e) { return; }
            if (frame.type === 'replay') {
              // Hold the replay until the POST below tells us whether this
              // click started a new run: a replay of an already-finished run
              // must not mix its lines (and verdict) into the fresh console.
              replayQueue = frame.frames || [];
              return;
            }
            if (settled && frame.type === 'final') return;
            applyFrame(frame);
          };
        } catch (e) { /* no WS support: the REST call below still reports it */ }
        postJSON('/api/chaos/run', {}).then(function (d) {
          if (!d.started && d.error) {
            appendChaosLine(card, '[ERROR] ' + d.error, 'chaos-line--err');
            setOffline(card, 'engine offline');
            settled = true;
            finish(false);
          } else if (!d.started && d.busy) {
            // A run is already in flight: show the frames we buffered.
            replayQueue.forEach(applyFrame);
            replayQueue = [];
          } else {
            // A new run just started: drop the stale replay on purpose.
            replayQueue = [];
          }
        }).catch(function () {
          appendChaosLine(card, '[ERROR] backend unreachable', 'chaos-line--err');
          setOffline(card, 'backend offline');
          settled = true;
          finish(false);
        });
        // Safety net: the final frame always arrives when a run completes, so
        // silence past this deadline means the stream broke; unstick button.
        setTimeout(function () {
          if (!settled) {
            settled = true;
            appendChaosLine(card, '[ERROR] stream timed out', 'chaos-line--err');
            finish(false);
          }
        }, 60000);
      }
    }

    cards.forEach(function (card) {
      var kind = card.getAttribute('data-demo');
      var run = card.querySelector('.live-run');
      var actionLabels = { chaos: 'Run experiment', contract: 'Compare specs', rag: 'Ask codebase', scan: 'Scan repos', profile: 'Profile workload' };
      if (run) run.textContent = actionLabels[kind];
      if (run) run.addEventListener('click', function () { loadDemo(kind, card); });
      if (kind === 'rag') {
        var ragForm = card.querySelector('[data-rag-form]');
        if (ragForm) ragForm.addEventListener('submit', function (event) {
          event.preventDefault();
          var field = ragForm.querySelector('.rag-query-input');
          if (!field || !field.value.trim()) return;
          loadDemo(kind, card, field.value.trim());
        });
        card.querySelectorAll('[data-rag-question]').forEach(function (button) {
          button.addEventListener('click', function () {
            var question = button.getAttribute('data-rag-question');
            var field = card.querySelector('.rag-query-input');
            if (field) field.value = question;
            card.querySelectorAll('[data-rag-question]').forEach(function (choice) {
              choice.classList.toggle('is-selected', choice === button);
            });
            loadDemo(kind, card, question);
          });
        });
      }
      if (kind === 'profile') {
        card.querySelectorAll('[data-profile-view]').forEach(function (button) {
          button.addEventListener('click', function () {
            profileView = button.getAttribute('data-profile-view');
            card.querySelectorAll('[data-profile-view]').forEach(function (choice) {
              var selected = choice === button;
              choice.classList.toggle('is-selected', selected);
              choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
            });
            renderProfileBars();
          });
        });
      }
      if (kind === 'chaos') {
        card.querySelectorAll('.cw-chip').forEach(function (button) {
          button.addEventListener('click', function () {
            chooseChaosPhase(card, button.getAttribute('data-cw'));
          });
        });
      }
      if (kind === 'contract') {
        var diffBox = card;
        diffBox.querySelectorAll('.diff-filter').forEach(function (button) {
          button.addEventListener('click', function () {
            diffFilter = button.getAttribute('data-diff-filter') || 'all';
            diffBox.querySelectorAll('.diff-filter').forEach(function (choice) {
              var selected = choice === button;
              choice.classList.toggle('is-selected', selected);
              choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
            });
            if (diffData) {
              renderDiff(diffData);
            } else {
              diffBox.querySelectorAll('.diff-line[data-diff-severity]').forEach(function (line) {
                line.hidden = diffFilter !== 'all' && line.getAttribute('data-diff-severity') !== diffFilter;
              });
            }
          });
        });
      }
      if (kind === 'scan') {
        function inspectFinding(line) {
          card.querySelectorAll('.scan-line.is-selected').forEach(function (item) { item.classList.remove('is-selected'); });
          line.classList.add('is-selected');
          var detail = card.querySelector('[data-scan-detail]');
          if (!detail) return;
          var notes = {
            sqli: 'Looks like SQL construction. Check parameter binding and whether this is executable code, a test, or documentation.',
            xss: 'Uses HTML insertion or markup composition. Check the trust boundary and escaping before classifying it.',
            secrets: 'Resembles a credential. Verify whether it is an example token, test fixture, or active secret.',
            outdated_deps: 'Dependency pattern flagged. Check the installed version and applicable advisory before acting.'
          };
          var title = document.createElement('b');
          title.textContent = line.getAttribute('data-finding') + ' · ' + line.getAttribute('data-location');
          var code = document.createElement('code');
          code.textContent = line.getAttribute('data-code');
          var explanation = document.createElement('span');
          explanation.textContent = ' Review cue: ' + (notes[line.getAttribute('data-category')] || 'Inspect surrounding code and runtime context.');
          detail.replaceChildren(title, code, explanation);
        }
        card.addEventListener('click', function (event) {
          var line = event.target.closest('.scan-line[data-category]');
          if (line) inspectFinding(line);
        });
        card.addEventListener('keydown', function (event) {
          var line = event.target.closest('.scan-line[data-category]');
          if (line && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); inspectFinding(line);
          }
        });
        card.addEventListener('change', function (event) {
          if (!event.target.matches('.scan-filter')) return;
          var category = event.target.value;
          card.querySelectorAll('.scan-line[data-category]').forEach(function (line) {
            line.hidden = category !== 'all' && line.getAttribute('data-category') !== category;
          });
          var visible = card.querySelectorAll('.scan-line[data-category]:not([hidden])').length;
          var count = card.querySelector('[data-scan-visible]');
          if (count) count.textContent = visible + ' listed for review in this category';
        });
      }
    });
  })();

  /* ── Contact form: validation + mailto fallback ──────────────────────── */
  (function initForm() {
    var form = document.querySelector('form[data-contact]');
    if (!form) return;
    var status = form.querySelector('.form-status');
    var EMAIL = 'muath.reed@gmail.com';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('#f-name');
      var email = form.querySelector('#f-email');
      var subject = form.querySelector('#f-subject');
      var message = form.querySelector('#f-message');
      var ok = true;

      [name, email, subject, message].forEach(function (f) {
        f.classList.remove('invalid');
      });

      if (!name.value.trim()) { name.classList.add('invalid'); ok = false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.classList.add('invalid'); ok = false; }
      if (!subject.value.trim()) { subject.classList.add('invalid'); ok = false; }
      if (!message.value.trim()) { message.classList.add('invalid'); ok = false; }

      if (!ok) {
        status.textContent = 'err: please fill in every field with a valid email.';
        status.className = 'form-status err';
        return;
      }

      var body = encodeURIComponent(message.value.trim() + '\n\n- ' + name.value.trim() + ' (' + email.value.trim() + ')');
      var href = 'mailto:' + EMAIL +
        '?subject=' + encodeURIComponent(subject.value.trim()) +
        '&body=' + body;
      window.location.href = href;
      status.textContent = 'Draft opened. Send it from your email app.';
      status.className = 'form-status ok';
    });
  })();
})();
