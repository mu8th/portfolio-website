/* ==========================================================================
   Portfolio | Muath Alsawaier
   Interactive systems: particle backdrop, custom cursor, hero terminal,
   project visuals, contact form, scroll effects.
   All motion respects prefers-reduced-motion.
   ========================================================================== */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  /* ── Particle constellation backdrop ─────────────────────────────────── */
  (function initParticles() {
    if (reducedMotion) return;
    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var particles = [];
    var mouse = { x: -9999, y: -9999 };
    var COUNT = Math.min(70, Math.floor(window.innerWidth / 18));
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

  /* ── Custom cursor (desktop, fine pointer only) ──────────────────────── */
  (function initCursor() {
    if (!finePointer) return;
    var dot = document.querySelector('.cursor-dot');
    var ring = document.querySelector('.cursor-ring');
    var glow = document.querySelector('.cursor-glow');
    if (!dot || !ring) return;

    var x = window.innerWidth / 2, y = window.innerHeight / 2;
    var rx = x, ry = y;
    var hovering = false;

    window.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      if (glow) {
        glow.style.left = x + 'px';
        glow.style.top = y + 'px';
      }
    });

    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      hovering = !!(t.closest && t.closest('a, button, input, textarea, label, .marquee-chip, .chip'));
      ring.classList.toggle('is-hovering', hovering);
    });

    (function follow() {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      requestAnimationFrame(follow);
    })();
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

    var DEMO = [
      { cmd: 'whoami', out: 'Muath | Software Engineering student @ WSU · SWE intern @ SEL', cls: '' },
      { cmd: 'ls ~/projects', out: 'api-contract-tester/  performance-profiler/  vulnerability-scanner/  code-rag/', cls: '' },
      { cmd: 'python -m pytest ~/projects --tb=no -q', out: '97 passed, 0 failed | 4 projects · coverage 80%+', cls: 'ok' },
      { cmd: 'docker compose up -d', out: 'services healthy · api · worker · db', cls: 'ok' },
      { cmd: 'git push origin main', out: 'main → main · CI green', cls: 'ok' }
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
        addOut('commands: help · whoami · projects · skills · contact · git log · clear · sudo hire-me', 'dim');
      },
      whoami: function () { addOut('Muath | Software Engineering student @ WSU · SWE intern @ SEL'); },
      ls: function () { addOut('api-contract-tester/  performance-profiler/  vulnerability-scanner/  code-rag/'); },
      projects: function () {
        addOut('01  API Contract Testing Platform: living OpenAPI contracts, breaking-change diffs');
        addOut('02  Real-time Performance Profiler: live flame graphs, hot-path detection');
        addOut('03  Real-time Vulnerability Scanner: SQLi / XSS / secrets static analysis');
        addOut('04  Local RAG Code Assistant: semantic search, cited answers from your codebase');
      },
      skills: function () {
        addOut('python · structured text (iec 61131-3) · t-sql · fastapi · openapi · rtac extensions · rag pipelines · embeddings · ollama · docker · pytest · ruff · mypy');
      },
      contact: function () {
        addOut('email: muath.reed@gmail.com');
        addOut('linkedin: linkedin.com/in/muath-alsawaier');
        addOut('github: github.com/mu8th');
        addOut('try `sudo hire-me`', 'ok');
      },
      'git log': function () {
        addOut('d8f4dd3  Make every project demo visibly run, and label the offline RAG mode');
        addOut('4bbde1a  Fix two E501 line lengths introduced by the project renames');
        addOut('5d8129c  Use full project names (Vulnerability Scanner, Performance Profiler); point CI at renamed repos');
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
          addOut(step.out, step.cls);
          await sleep(LINE_PAUSE);
        }
        await sleep(RESTART);
      }
    }

    if (reducedMotion) {
      // Static transcript, no animation; still interactive on click.
      DEMO.forEach(function (step) { addCmd(step.cmd); addOut(step.out, step.cls); });
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

  /* ── Live system-status ticker (real backend metrics) ───────────────────
     One cheap call to /api/summary fills the hero status strip with honest,
     live numbers (repos, LOC, vulns, CI). Falls back to baked-in values if
     the backend is offline, so the strip is never empty.     */
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
    // Fallbacks mirror the About counters so the strip always shows something.
    set('status', 'operational');
    set('repos', '4');
    set('loc', '5,204');
    set('vulns', '5');
    set('ci', 'green');

    fetch(API + '/api/summary', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        set('status', d.status || 'operational');
        set('repos', String(d.projects_shipped != null ? d.projects_shipped : '4'));
        set('loc', (d.lines_of_code != null ? d.lines_of_code : 0).toLocaleString('en-US'));
        set('vulns', String(d.vulns_detected != null ? d.vulns_detected : '5'));
        set('ci', d.ci || 'green');
      })
      .catch(function () { /* keep fallback values */ });
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

  /* ── Marquee speeds ──────────────────────────────────────────────────── */
  document.querySelectorAll('.marquee').forEach(function (m) {
    var speed = m.getAttribute('data-speed');
    if (speed) m.querySelector('.marquee-track').style.animationDuration = speed;
  });

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
      if (started) return;
      started = true;
      var i = 0;
      function next() {
        if (i > 0) lines[i - 1].classList.remove('scanning');
        if (i >= lines.length) {
          // finished: hold, then reset and loop
          setTimeout(function () {
            lines.forEach(function (l) { l.classList.remove('scanning', 'hit', 'passed'); });
            if (fill) fill.style.width = '0%';
            i = 0;
            setTimeout(next, 500);
          }, 3600);
          return;
        }
        var line = lines[i];
        line.classList.add('scanning');
        if (fill) fill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        // Capture the element, not the index: i is incremented before this
        // fires, and on the last line it has already wrapped to lines.length.
        if (line.getAttribute('data-finding')) {
          setTimeout(function () { line.classList.add('hit'); }, 420);
        } else {
          // Clean line: the sweep passes over it with a green light.
          setTimeout(function () { line.classList.add('passed'); }, 420);
        }
        i++;
        setTimeout(next, 520);
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

  /* ── Live project demos: drive the three visuals with REAL data ─────────
     Each project card has a `data-demo` visual. On first scroll into view we
     fetch the real result from the portfolio backend and re-render the visual
     with it (keeping the ambient animation otherwise intact). If the backend
     is unreachable the card shows an offline dot and the canned visuals stay.
     The "run demo" button re-fetches, so a reviewer can re-run each engine.   */
  (function initLiveDemos() {
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
    function setLive(card, metric) {
      var dot = card.querySelector('.live-dot');
      var text = card.querySelector('.live-text');
      if (dot) dot.classList.remove('is-running', 'is-offline');
      if (dot) dot.classList.add('is-live');
      if (text) {
        text.textContent = 'live' + (metric ? ' · ' + metric : '');
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

    /* Contract diff */
    function renderDiff(data) {
      var box = document.querySelector('.project-visual--diff');
      var body = box ? box.querySelector('.project-visual-body') : null;
      if (!body || !data.changes) return;
      var html = '';
      data.changes.forEach(function (c) {
        var cls = 'ctx';
        var badge = '';
        if (c.kind === 'removed_endpoint' || c.kind === 'removed_field') {
          cls = 'del'; badge = '<span class="diff-badge breaking">breaking</span>';
        } else if (c.kind === 'type_change' || c.kind === 'added_required_field') {
          cls = 'ver'; badge = '<span class="diff-badge breaking">breaking</span>';
        } else if (c.kind === 'added_endpoint' || c.kind === 'added_field') {
          cls = 'add'; badge = '<span class="diff-badge ok">non-breaking</span>';
        }
        html += '<span class="diff-line diff-' + cls + '">' + esc(c.detail) + badge + '</span>';
      });
      html += '<span class="diff-line diff-flag">! ' + data.breaking_count +
              ' breaking change' + (data.breaking_count === 1 ? '' : 's') +
              ' · ' + data.non_breaking_count + ' non-breaking</span>';
      body.innerHTML = html;
      body.classList.add('is-live');
      setMetric('contract', data.breaking_count);

      // Reveal the lines one by one and loop, so every run (auto or manual)
      // visibly replays instead of swapping in a static block. The flag tells
      // the ambient reveal loop to stand down: it still references the old,
      // now-detached nodes and would otherwise keep animating nothing.
      if (box) box.dataset.liveRender = '1';
      if (reducedMotion) return;
      var lines = Array.prototype.slice.call(body.querySelectorAll('.diff-line'));
      lines.forEach(function (l) { l.classList.add('hidden-line'); });
      var i = 0;
      (function next() {
        if (!box || box.dataset.liveRender !== '1') return;
        if (i < lines.length) {
          lines[i].classList.remove('hidden-line');
          i++;
          setTimeout(next, 260);
        } else {
          setTimeout(function () {
            if (!box || box.dataset.liveRender !== '1') return;
            lines.forEach(function (l) { l.classList.add('hidden-line'); });
            i = 0;
            setTimeout(next, 900);
          }, 4200);
        }
      })();
    }

    /* Flame / profiler */
    var ws = null;
    function renderFlameStatic(data) {
      var wrap = document.querySelector('.project-visual--flame .project-visual-body');
      if (!wrap || !data.functions) return;
      var meta = wrap.querySelector('.flame-meta');
      if (meta) {
        meta.innerHTML = '<span>hot path: <b>' + esc(data.hot_path) + '()</b></span>' +
                         '<span>' + data.hot_path_pct + '% of CPU</span>';
      }
      setMetric('profile', data.hot_path_pct + '%');
      // live readout row
      var live = wrap.querySelector('.flame-live');
      if (!live) {
        live = document.createElement('div');
        live.className = 'flame-live';
        live.style.cssText = 'width:100%;margin-top:.5rem;font-size:.6rem;color:var(--muted-dim)';
        wrap.appendChild(live);
      }
      live.textContent = 'waiting for live stream';
    }
    function renderFlameFrame(f) {
      var live = document.querySelector('.project-visual--flame .flame-live');
      if (live) {
        live.textContent = 'calls ' + f.calls_total +
          ' · +cpu ' + f.cpu_this_frame_ms.toFixed(1) + 'ms' +
          ' · t+' + f.uptime_s.toFixed(1) + 's';
      }
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
      var sevLabel = { sqli: 'SQLi · CRIT', xss: 'XSS · HIGH', secrets: 'Secret · MED' };
      // Interleave real clean files (from the same scan) so the sweep shows
      // safe lines getting a green light, not an unbroken wall of hits.
      var clean = data.clean_samples || [];
      var ci = 0;
      var html = '';
      data.findings.forEach(function (f, idx) {
        if (idx > 0 && idx % 3 === 0 && ci < clean.length) {
          var c = clean[ci++];
          html += '<span class="scan-line">' + esc(c.file) +
                  '  <span style="color:var(--muted-dim)">(' + esc(c.repo) + ')</span></span>';
        }
        var lab = sevLabel[f.category] || (f.label + ' · ' + Math.round(f.severity_score * 100));
        html += '<span class="scan-line" data-finding="' + esc(lab) + '">' +
                esc(f.code) + '  <span style="color:var(--muted-dim)">(' +
                esc(f.repo) + ':' + f.line + ')</span></span>';
      });
      html += '<div class="scan-progress"><div class="scan-progress-fill"></div></div>';
      body.innerHTML = html;
      body.classList.add('is-live');
      setMetric('scan', data.total_findings);
      // sweep with real findings
      var lines = body.querySelectorAll('.scan-line');
      var fill = body.querySelector('.scan-progress-fill');
      var i = 0;
      (function next() {
        if (i > 0) lines[i - 1].classList.remove('scanning');
        if (i >= lines.length) {
          if (fill) fill.style.width = '100%';
          setTimeout(function () {
            lines.forEach(function (l) { l.classList.remove('scanning', 'hit', 'passed'); });
            if (fill) fill.style.width = '0%';
            i = 0;
            setTimeout(next, 600);
          }, 3200);
          return;
        }
        var line = lines[i];
        line.classList.add('scanning');
        if (fill) fill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        line.classList.add(line.getAttribute('data-finding') ? 'hit' : 'passed');
        i++;
        setTimeout(next, 480);
      })();
    }

    /* RAG (code assistant) */
    var RAG_QUESTIONS = [
      'How does the retrieval index rank code chunks?',
      'How are code chunks embedded?',
      'How does the system build citations?',
    ];
    var ragQ = 0;
    // Reveal the canned RAG terminal lines in sequence. Called when the card
    // scrolls into view, and again if the live demo can't reach the backend,
    // so the terminal never stays a blank box. Gated on the body not being
    // live-rendered: the auto-start demo replaces the canned lines entirely on
    // a successful run, in which case there is nothing to reveal.
    var ragRevealed = false;
    function ragReveal() {
      if (ragRevealed) return;
      ragRevealed = true;
      var box = document.querySelector('.project-visual--rag');
      if (!box) return;
      var body = box.querySelector('.project-visual-body');
      if (body && body.classList.contains('is-live')) return;
      var lines = box.querySelectorAll('.rag-src.hidden-line, .rag-answer.hidden-line');
      lines.forEach(function (l, i) {
        setTimeout(function () { l.classList.add('rag-revealed'); }, 350 + i * 300);
      });
    }
    if (!reducedMotion && 'IntersectionObserver' in window) {
      var ragBox = document.querySelector('.project-visual--rag');
      if (ragBox) {
        new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { ragReveal(); obs.disconnect(); }
          });
        }, { threshold: 0.4 }).observe(ragBox);
      }
    }
    var ragBusy = false;
    function renderRag(data) {
      var body = document.querySelector('.project-visual--rag .project-visual-body');
      if (!body) return;
      var q = body.querySelector('.rag-q');
      if (q && data.question) q.textContent = data.question;
      var sources = data.sources || [];
      var html = '';
      sources.forEach(function (s, i) {
        var loc = s.path ? s.path.split('/').pop() : 'source';
        var label = loc + (s.start_line ? ':' + s.start_line : '');
        html += '<span class="rag-src" data-score="' + (s.score || 0) + '">' +
                esc(label) + ' <span class="rag-score">· ' + (s.score != null ? s.score.toFixed(2) : '-') + '</span></span>';
      });
      if (!sources.length) {
        html += '<span class="rag-src">no sources retrieved</span>';
      }
      var ans = (data.answer || '').trim();
      if (ans) {
        var cites = sources.slice(0, 3).map(function (s) {
          return s.path ? s.path.split('/').pop() : '';
        }).filter(Boolean).join(' · ');
        html += '<span class="rag-answer">' + esc(ans) +
                (cites ? ' <span class="rag-cite">: ' + esc(cites) + '</span>' : '') + '</span>';
      }
      // Replace only the dynamic parts, keep the query line.
      var keep = body.querySelector('.rag-q');
      body.innerHTML = (keep ? keep.outerHTML : '') + html;
      body.classList.add('is-live');
      setMetric('rag', sources.length || 0);
      // Animate the retrieved sources hitting one after another.
      var srcs = body.querySelectorAll('.rag-src');
      var i = 0;
      (function next() {
        if (i > 0) srcs[i - 1].classList.remove('is-hit');
        if (i >= srcs.length) {
          setTimeout(function () {
            srcs.forEach(function (s) { s.classList.remove('is-hit'); });
            i = 0;
            setTimeout(next, 2600);
          }, 1400);
          return;
        }
        srcs[i].classList.add('is-hit');
        i++;
        setTimeout(next, 520);
      })();
    }
    // Honest degradation: the pipeline or model is down. Keep the query line,
    // show why there is no answer, and never leave the terminal blank.
    function renderRagError(data, question) {
      var body = document.querySelector('.project-visual--rag .project-visual-body');
      if (!body) return;
      var keep = body.querySelector('.rag-q');
      if (keep && question) keep.textContent = question;
      var msg = String((data && data.error) || 'model offline');
      if (msg.length > 140) msg = msg.slice(0, 140) + '…';
      body.innerHTML = (keep ? keep.outerHTML : '') +
        '<span class="rag-src">no sources retrieved</span>' +
        '<span class="rag-answer rag-error">! answer unavailable: ' + esc(msg) + '</span>';
      body.classList.add('is-live');
    }

    function loadDemo(kind, card) {
      var run = card.querySelector('.live-run');
      // Re-entrancy guard: ignore clicks while a run is in flight, and let the
      // button be re-clicked afterwards so a reviewer can re-run any engine.
      if (run && run.dataset.busy === '1') return;
      var startedAt = Date.now();
      if (run) {
        run.dataset.busy = '1';
        run.disabled = true;
        run.classList.add('is-running');
        run.textContent = kind === 'rag' ? 'thinking…' :
          kind === 'scan' ? 'scanning…' :
          kind === 'profile' ? 'profiling…' : 'diffing…';
      }
      var finish = function (ok) {
        // Keep the running state visible for at least ~1.6s: fast engines
        // (the scanner takes ~150ms) would otherwise flash by unnoticed.
        var wait = Math.max(0, 1600 - (Date.now() - startedAt));
        setTimeout(function () {
          if (run) { run.dataset.busy = ''; run.textContent = 'run demo'; run.disabled = false; run.classList.remove('is-running'); }
          if (!ok) setOffline(card);
        }, wait);
      };
      if (kind === 'contract') {
        setRunning(card, 'running…');
        getJSON('/api/contract').then(function (d) {
          renderDiff(d);
          setLive(card, d.breaking_count + ' breaking');
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
          setLive(card, d.total_findings + ' found · ' + d.scan_time_ms + 'ms');
          finish(true);
        }).catch(function () { finish(false); });
      } else if (kind === 'rag') {
        if (ragBusy) { if (run) run.textContent = 'thinking…'; return; }
        ragBusy = true;
        setRunning(card, 'thinking…');
        if (run) run.textContent = 'thinking…';
        var question = RAG_QUESTIONS[ragQ % RAG_QUESTIONS.length];
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
          renderRag(d);
          var ms = d.latency_ms != null ? Math.round(d.latency_ms) + 'ms' : '';
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
      }
    }

    cards.forEach(function (card) {
      var kind = card.getAttribute('data-demo');
      // Auto-start fires once when the card scrolls into view. The button
      // always re-runs the engine (re-entrancy is guarded inside loadDemo),
      // so "run demo" works even after the auto-start has already fired.
      var autoStarted = false;
      var run = card.querySelector('.live-run');
      if (run) run.addEventListener('click', function () { loadDemo(kind, card); });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries, obs) {
          entries.forEach(function (en) {
            if (en.isIntersecting) {
              if (!autoStarted) { autoStarted = true; loadDemo(kind, card); }
              obs.disconnect();
            }
          });
        }, { threshold: 0.35 }).observe(card);
      } else {
        loadDemo(kind, card);
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
      status.textContent = 'ok: opening your mail client…';
      status.className = 'form-status ok';
      form.reset();
    });
  })();
})();
