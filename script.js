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
      { cmd: 'ls ~/projects', out: 'faultline/  api-contract-tester/  performance-profiler/  vulnerability-scanner/  code-rag/', cls: '' },
      { cmd: 'python -m pytest ~/projects --tb=no -q', out: '97 passed, 0 failed | 5 projects · coverage 80%+', cls: 'ok' },
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
      ls: function () { addOut('faultline/  api-contract-tester/  performance-profiler/  vulnerability-scanner/  code-rag/'); },
      projects: function () {
        addOut('01  FaultLine Chaos Testing Platform: fault injection + SLO grading, live latency graph');
        addOut('02  API Contract Testing Platform: living OpenAPI contracts, breaking-change diffs');
        addOut('03  Real-time Performance Profiler: live flame graphs, hot-path detection');
        addOut('04  Real-time Vulnerability Scanner: SQLi / XSS / secrets static analysis');
        addOut('05  Local RAG Code Assistant: semantic search, cited answers from your codebase');
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
      // change-type summary strip
      var cnt = { del: 0, add: 0, mod: 0 };
      data.changes.forEach(function (c) {
        if (c.kind === 'removed_endpoint' || c.kind === 'removed_field') cnt.del++;
        else if (c.kind === 'added_endpoint' || c.kind === 'added_field') cnt.add++;
        else cnt.mod++;
      });
      var html = '<span class="diff-summary">' +
                 '<b class="s-del">-' + cnt.del + ' removed</b>' +
                 '<b class="s-add">+' + cnt.add + ' added</b>' +
                 '<b class="s-mod">~' + cnt.mod + ' modified</b></span>';
      // change-risk strip: share of breaking vs non-breaking changes, the
      // number a reviewer actually cares about before reading the diff
      var totalCh = (data.breaking_count || 0) + (data.non_breaking_count || 0);
      var riskPct = totalCh ? Math.round((data.breaking_count / totalCh) * 100) : 0;
      html += '<span class="risk-strip"><span class="risk-label">change risk</span>' +
              '<span class="risk-bar"><span class="risk-fill" style="width:' + riskPct + '%"></span></span>' +
              '<span class="risk-pct">' + riskPct + '% breaking</span></span>';
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
      // labeled per-function bars from the real profile (sorted hot -> cold)
      var bars = wrap.querySelector('.flame-wrap');
      if (bars) {
        var colors = [
          'linear-gradient(90deg,#a78bfa,#7c3aed)',
          'linear-gradient(90deg,#22d3ee,#06b6d4)',
          'linear-gradient(90deg,#ec4899,#be185d)'
        ];
        var rows = '';
        data.functions.forEach(function (f, i) {
          rows += '<div class="flame-bar-row">' +
                  '<span class="flame-bar-name" title="' + esc(f.function_name) + '">' + esc(f.function_name) + '</span>' +
                  '<div class="flame-bar-track"><div class="flame-bar-fill" style="width:0%;background:' + (colors[i] || colors[2]) + '"></div></div>' +
                  '<span class="flame-bar-pct">' + f.cpu_pct.toFixed(1) + '%</span></div>';
        });
        bars.innerHTML = rows;
        requestAnimationFrame(function () {
          var fills = bars.querySelectorAll('.flame-bar-fill');
          data.functions.forEach(function (f, i) {
            if (fills[i]) fills[i].style.width = f.cpu_pct + '%';
          });
        });
      }
      // live readout row
      var live = wrap.querySelector('.flame-live');
      if (!live) {
        live = document.createElement('div');
        live.className = 'flame-live';
        live.style.cssText = 'width:100%;margin-top:.5rem;font-size:.68rem;color:var(--muted-dim)';
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
      var html = '<div class="scan-window">';
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
      html += '</div>';
      html += '<div class="scan-progress"><div class="scan-progress-fill"></div></div>';
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
      // sweep with real findings
      var lines = body.querySelectorAll('.scan-line');
      var fill = body.querySelector('.scan-progress-fill');
      var win = body.querySelector('.scan-window');
      var i = 0;
      (function next() {
        if (i > 0) lines[i - 1].classList.remove('scanning');
        if (i >= lines.length) {
          if (fill) fill.style.width = '100%';
          setTimeout(function () {
            lines.forEach(function (l) { l.classList.remove('scanning', 'hit', 'passed'); });
            if (fill) fill.style.width = '0%';
            if (win) win.scrollTop = 0;
            i = 0;
            setTimeout(next, 600);
          }, 3200);
          return;
        }
        var line = lines[i];
        line.classList.add('scanning');
        if (fill) fill.style.width = Math.round(((i + 1) / lines.length) * 100) + '%';
        line.classList.add(line.getAttribute('data-finding') ? 'hit' : 'passed');
        if (win) win.scrollTop = Math.max(0, line.offsetTop - win.clientHeight * 0.4);
        i++;
        setTimeout(next, 480);
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
      [' .rag-stages', ' .rag-answer', ' .rag-meta'].forEach(function (sel) {
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
      if (ev.phase === 'baseline' || ev.phase === 'fault' || ev.phase === 'recovery') {
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
      setLive(card, (rep.verdict === 'pass' ? 'PASS · all SLOs held' : 'FAIL · SLO breached') +
        (w && w.p95_ms != null ? ' · p95 ' + Math.round(w.p95_ms) + 'ms' : ''));
      // Finalize the per-phase strip from the graded report windows, then
      // render the SLO hypothesis chips: name, measured vs limit, status.
      updateChaosPhaseStats(card, rep.windows || {});
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
       v3: rolling p95 AND p50 traces, peak-sample marker, error count and
       SLO-headroom in the readout, and a per-phase stats strip driven from
       the same samples (finalized from the real report at run end).        */
    var chaosPts = [];
    var CHAOS_YMAX = 100;   // fixed 0..100ms scale: no rescale jitter mid-run
    var CHAOS_SLO = 25;     // the p95 SLO the demo grades against (ms)
    var CHAOS_XCAP = 56;    // x-axis probe capacity for a full demo run
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

    function chaosResetChart(card) {
      chaosPts = [];
      renderChaosChart(card);
      updateChaosPhaseStats(card, null);
      var slo = card ? card.querySelector('#slo-chips') : null;
      if (slo) slo.innerHTML = '';
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
    }

    function renderChaosChart(card) {
      var svg = card.querySelector('#chaos-chart');
      if (!svg) return;
      var W = Math.max(320, Math.round(svg.getBoundingClientRect().width)) || 640;
      var H = 232, L = 42, R = 12, T = 26, B = 22;
      var iw = W - L - R, ih = H - T - B;
      function y(ms) { return T + ih * (1 - Math.min(ms, CHAOS_YMAX) / CHAOS_YMAX); }
      var n = chaosPts.length;
      var denom = Math.max(CHAOS_XCAP, n);
      function x(i) { return L + iw * ((i + 0.5) / denom); }
      var parts = [];
      // danger zone: everything above the SLO line is red-tinted
      var sy = y(CHAOS_SLO);
      parts.push('<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + Math.max(0, sy - T).toFixed(1) + '" fill="rgba(239,68,68,0.045)"/>');
      // minor gridlines every 10ms, labeled majors every 25ms
      for (var g = 0; g <= CHAOS_YMAX; g += 10) {
        var gy = y(g);
        var major = g % 25 === 0;
        parts.push('<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,' + (major ? 0.07 : 0.03) + ')" stroke-width="1"/>');
        if (major) {
          parts.push('<text x="' + (L - 6) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.35)">' + g + '</text>');
        }
      }
      parts.push('<text x="' + L + '" y="13" font-size="9" fill="rgba(255,255,255,0.4)">latency (ms)</text>');
      if (n) {
        // phase bands + one line per consecutive phase run
        var i = 0;
        while (i < n) {
          var j = i;
          while (j + 1 < n && chaosPts[j + 1].phase === chaosPts[i].phase) j++;
          var ph = CHAOS_PHASE[chaosPts[i].phase] || CHAOS_PHASE.baseline;
          var x0 = L + iw * (i / denom);
          var x1 = L + iw * ((j + 1) / denom);
          parts.push('<rect x="' + x0.toFixed(1) + '" y="' + T + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + ih + '" fill="' + ph.band + '"/>');
          if (i > 0) parts.push('<line x1="' + x0.toFixed(1) + '" y1="' + T + '" x2="' + x0.toFixed(1) + '" y2="' + (T + ih) + '" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3 4"/>');
          parts.push('<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" letter-spacing="1.5" fill="' + ph.line + '">' + chaosPts[i].phase.toUpperCase() + '</text>');
          var d = '';
          for (var k = i; k <= j; k++) {
            if (chaosPts[k].ms == null) continue;
            d += (d ? ' L' : 'M') + x(k).toFixed(1) + ' ' + y(chaosPts[k].ms).toFixed(1);
          }
          if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + ph.line + '" stroke-width="1.5" stroke-linejoin="round"/>');
          i = j + 1;
        }
        // rolling percentile traces over every sample so far: p95 (white,
        // the number the SLO grades) and p50 (cyan, shows median drift)
        var rp95 = '', rp50 = '', acc = [], y95End = 0, y50End = 0;
        for (var r = 0; r < n; r++) {
          if (chaosPts[r].ms == null) continue;
          acc.push(chaosPts[r].ms);
          var s2 = acc.slice().sort(function (a, b) { return a - b; });
          y95End = y(chaosPercentile(s2, 95));
          y50End = y(chaosPercentile(s2, 50));
          rp95 += (rp95 ? ' L' : 'M') + x(r).toFixed(1) + ' ' + y95End.toFixed(1);
          rp50 += (rp50 ? ' L' : 'M') + x(r).toFixed(1) + ' ' + y50End.toFixed(1);
        }
        if (rp50) parts.push('<path d="' + rp50 + '" fill="none" stroke="rgba(34,211,238,0.75)" stroke-width="1.4" stroke-dasharray="2 3" stroke-linejoin="round"/>');
        if (rp95) {
          parts.push('<path d="' + rp95 + '" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round"/>');
          parts.push('<text x="' + (x(n - 1) - 6).toFixed(1) + '" y="' + (y95End - 6).toFixed(1) + '" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.55)">p95</text>');
        }
        // sample dots with hover tooltips; failed probes get a red X
        for (var q = 0; q < n; q++) {
          var pt = chaosPts[q];
          if (pt.ms == null) {
            if (pt.err) {
              var ex = x(q), ey = y(4);
              parts.push('<line x1="' + (ex - 3).toFixed(1) + '" y1="' + (ey - 3).toFixed(1) + '" x2="' + (ex + 3).toFixed(1) + '" y2="' + (ey + 3).toFixed(1) + '" stroke="#f87171" stroke-width="1.5"/><line x1="' + (ex - 3).toFixed(1) + '" y1="' + (ey + 3).toFixed(1) + '" x2="' + (ex + 3).toFixed(1) + '" y2="' + (ey - 3).toFixed(1) + '" stroke="#f87171" stroke-width="1.5"/>');
            }
            continue;
          }
          var col = (CHAOS_PHASE[pt.phase] || CHAOS_PHASE.baseline).line;
          parts.push('<circle cx="' + x(q).toFixed(1) + '" cy="' + y(pt.ms).toFixed(1) + '" r="2.4" fill="' + (pt.ms > CHAOS_SLO ? '#f87171' : col) + '"><title>probe ' + (q + 1) + ' · ' + pt.phase + ' · ' + pt.ms.toFixed(1) + 'ms</title></circle>');
        }
        // peak marker: ring + label on the slowest successful probe of the run
        var peakIdx = -1, peakMs = -1;
        for (var pk = 0; pk < n; pk++) {
          if (chaosPts[pk].ms != null && chaosPts[pk].ms > peakMs) { peakMs = chaosPts[pk].ms; peakIdx = pk; }
        }
        if (peakIdx >= 0 && n > 2) {
          var px = x(peakIdx), py = y(peakMs);
          parts.push('<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="5" fill="none" stroke="rgba(251,191,36,0.9)" stroke-width="1.5"><title>peak probe ' + (peakIdx + 1) + ' · ' + peakMs.toFixed(1) + 'ms</title></circle>');
          var labelLeft = px > W - R - 40;
          parts.push('<text x="' + (labelLeft ? px - 8 : px + 8).toFixed(1) + '" y="' + (py - 7).toFixed(1) + '" text-anchor="' + (labelLeft ? 'end' : 'start') + '" font-size="8" fill="rgba(251,191,36,0.95)">peak ' + peakMs.toFixed(0) + 'ms</text>');
        }
      }
      // SLO threshold + label
      parts.push('<line x1="' + L + '" y1="' + sy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + sy.toFixed(1) + '" stroke="rgba(245,158,11,0.9)" stroke-width="1.2"/>');
      parts.push('<text x="' + (L + 6) + '" y="' + (sy - 5).toFixed(1) + '" font-size="9" fill="rgba(245,158,11,0.95)">SLO ' + CHAOS_SLO + 'ms</text>');
      // live readout: rolling p95/p50, last probe, probe count, error count,
      // and the SLO headroom (or breach), the numbers the verdict rests on
      if (n) {
        var lats = [], errs = 0;
        for (var u = 0; u < n; u++) {
          if (chaosPts[u].ms != null) lats.push(chaosPts[u].ms);
          if (chaosPts[u].err) errs++;
        }
        lats.sort(function (a, b) { return a - b; });
        var rollP95 = chaosPercentile(lats, 95) || 0;
        var rollP50 = chaosPercentile(lats, 50) || 0;
        var lastMs = lats.length ? lats[lats.length - 1] : 0;
        parts.push('<text x="' + (W - R) + '" y="13" text-anchor="end" font-size="10" fill="rgba(255,255,255,0.62)">p95 ' + rollP95.toFixed(1) + 'ms · p50 ' + rollP50.toFixed(1) + 'ms · last ' + lastMs.toFixed(1) + 'ms · ' + n + ' probes' + (errs ? ' · ' + errs + ' err' : '') + '</text>');
        if (rollP95 > CHAOS_SLO) {
          parts.push('<text x="' + (W - R) + '" y="24" text-anchor="end" font-size="9" fill="#f87171">SLO breached by ' + (rollP95 - CHAOS_SLO).toFixed(1) + 'ms</text>');
        }
      } else {
        parts.push('<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.3)">awaiting probes…</text>');
      }
      // keep the per-phase stats strip in sync with the same samples
      updateChaosPhaseStats(card, null);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = parts.join('');
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
          kind === 'profile' ? 'profiling…' :
          kind === 'chaos' ? 'injecting…' : 'diffing…';
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
