/* FaultLine demo: saved and live chaos experiments with a before/after. */
(function () {
  'use strict';
  var P = window.Portfolio;
  var demo = document.querySelector('[data-demo="faultline"]');
  if (!P || !demo) return;

  var SLO = 60;
  var LABELS = {
    cpu: { fault: 'CPU pressure', fix: 'cache the inventory check' },
    latency: { fault: 'network delay', fix: null },
    kill: { fault: 'a process kill', fix: 'supervisor restarts it after 1 s' },
  };
  var state = { scenario: 'cpu', mitigation: false, defs: null, saved: {}, running: false, live: null };

  var chart = demo.querySelector('[data-chaos-chart]');
  var verdictEl = demo.querySelector('[data-verdict]');
  var resultsEl = demo.querySelector('[data-chaos-results]');
  var logEl = demo.querySelector('[data-log]');
  var runButton = demo.querySelector('[data-run]');
  var switchInput = demo.querySelector('[data-mitigation]');
  var switchLabel = demo.querySelector('[data-mitigation-label]');
  var describe = demo.querySelector('[data-fault-describe]');
  var choice = demo.querySelector('[data-fault-choice]');

  function key(scenario, mitigation) { return scenario + ':' + (mitigation ? 1 : 0); }

  function load(scenario, mitigation) {
    var k = key(scenario, mitigation);
    return P.shared('chaos:' + k, function () {
      return P.get('/api/chaos?scenario=' + scenario + '&mitigation=' + mitigation);
    }).then(function (d) {
      state.defs = d.scenarios || state.defs;
      if (d.slo_p95_ms) SLO = d.slo_p95_ms;
      if (d.last && !state.saved[k]) state.saved[k] = d.last;
      return d;
    });
  }

  function ordersP95(run) {
    var stats = run && run.probe_stats && run.probe_stats.orders;
    return stats && stats.fault ? stats.fault : null;
  }

  /* ── Chart ─────────────────────────────────────────────────────────── */

  function draw(events, planned) {
    var probes = (events || []).filter(function (e) { return e.probe; });
    var width = Math.max(320, Math.round(chart.getBoundingClientRect().width || 720));
    var narrow = width < 520;
    var H = narrow ? 230 : 280, L = narrow ? 42 : 52, R = 12, T = 26, B = 34;
    var iw = width - L - R, ih = H - T - B;
    var t0 = probes.length ? probes[0].ts : 0;
    var span = probes.length ? probes[probes.length - 1].ts - t0 : 0;
    var maxT = Math.max(planned || 11.5, span + 0.5);
    var maxMs = probes.reduce(function (m, e) { return e.ok && e.latency_ms ? Math.max(m, e.latency_ms) : m; }, 0);
    var yMax = Math.max(SLO * 1.6, maxMs * 1.1);
    var step = yMax > 600 ? 200 : yMax > 300 ? 100 : yMax > 120 ? 50 : 20;
    yMax = Math.ceil(yMax / step) * step;
    function x(t) { return L + iw * Math.min(1, Math.max(0, t / maxT)); }
    function y(v) { return T + ih * (1 - Math.min(v, yMax) / yMax); }

    chart.setAttribute('viewBox', '0 0 ' + width + ' ' + H);
    chart.replaceChildren();
    var g = function (tag, attrs, text) { var el = P.svg(tag, attrs, text); chart.appendChild(el); return el; };

    // Phase bands from the probe timestamps (planned thirds before data).
    var phases = ['baseline', 'fault', 'recovery'];
    var bounds = {};
    probes.forEach(function (e) {
      var t = e.ts - t0;
      var b = bounds[e.phase] || (bounds[e.phase] = { start: t, end: t });
      b.end = t;
    });
    phases.forEach(function (phase, i) {
      var b = bounds[phase];
      var start = b ? b.start : [0, 2.5, 8.5][i];
      var next = phases[i + 1] && bounds[phases[i + 1]] ? bounds[phases[i + 1]].start
        : b ? b.end + 0.2 : [2.5, 8.5, 11.5][i];
      if (!b && probes.length) return;
      g('rect', { x: x(start), y: T, width: Math.max(1, x(next) - x(start)), height: ih,
        fill: phase === 'fault' ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.025)' });
      g('text', { x: x(start) + 6, y: T - 8, fill: '#a3acbb', 'font-size': 11 },
        phase === 'fault' ? 'fault' : phase);
    });

    for (var v = 0; v <= yMax; v += step) {
      g('line', { x1: L, x2: width - R, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,0.08)' });
      g('text', { x: L - 6, y: y(v) + 4, fill: '#7a8496', 'font-size': 11, 'text-anchor': 'end' }, String(v));
    }
    g('text', { x: L, y: H - 6, fill: '#7a8496', 'font-size': 11 }, '0 s');
    g('text', { x: width - R, y: H - 6, fill: '#7a8496', 'font-size': 11, 'text-anchor': 'end' },
      maxT.toFixed(0) + ' s');
    g('text', { x: L + iw / 2, y: H - 6, fill: '#7a8496', 'font-size': 11, 'text-anchor': 'middle' },
      narrow ? 'seconds' : 'seconds since the first probe · latency in ms');

    // SLO line
    g('line', { x1: L, x2: width - R, y1: y(SLO), y2: y(SLO), stroke: '#fbbf24', 'stroke-width': 1.5,
      'stroke-dasharray': '6 5' });
    g('text', { x: width - R - 4, y: y(SLO) - 6, fill: '#fbbf24', 'font-size': 11, 'text-anchor': 'end' },
      SLO + ' ms SLO');

    if (!probes.length) {
      g('text', { x: L + iw / 2, y: T + ih / 2, fill: '#a3acbb', 'font-size': 13, 'text-anchor': 'middle' },
        state.running ? 'Starting the service…'
          : state.offline ? 'The demo server is unreachable, so there are no measurements to show.'
          : 'No run yet for this choice. Run it live.');
      return;
    }

    ['health', 'orders'].forEach(function (probe) {
      var pts = probes.filter(function (e) { return e.probe === probe; });
      var d = '', pen = false;
      pts.forEach(function (e) {
        if (!e.ok || !e.latency_ms) { pen = false; return; }
        d += (pen ? ' L' : ' M') + x(e.ts - t0).toFixed(1) + ' ' + y(e.latency_ms).toFixed(1);
        pen = true;
      });
      if (d) g('path', { d: d, fill: 'none', stroke: probe === 'orders' ? '#67e8f9' : '#8b95a7',
        'stroke-width': probe === 'orders' ? 2.5 : 1.5, 'stroke-linejoin': 'round', opacity: probe === 'orders' ? 1 : 0.8 });
      pts.forEach(function (e) {
        var px = x(e.ts - t0);
        if (!e.ok || !e.latency_ms) {
          var py = y(0) - 2;
          g('path', { d: 'M' + (px - 4) + ' ' + (py - 4) + ' L' + (px + 4) + ' ' + (py + 4) + ' M' + (px - 4) + ' ' + (py + 4) + ' L' + (px + 4) + ' ' + (py - 4),
            stroke: '#f87171', 'stroke-width': 2 }).appendChild(P.svg('title', {}, probe + ' request failed at ' + (e.ts - t0).toFixed(1) + ' s'));
        } else if (probe === 'orders') {
          g('circle', { cx: px, cy: y(e.latency_ms), r: 2.6, fill: '#67e8f9' })
            .appendChild(P.svg('title', {}, 'orders ' + e.latency_ms.toFixed(1) + ' ms at ' + (e.ts - t0).toFixed(1) + ' s (' + e.phase + ')'));
        }
      });
    });
  }

  /* ── Results ───────────────────────────────────────────────────────── */

  function checkText(c) {
    if (c.check === 'p95_latency_ms') {
      return 'p95 ' + (c.actual == null ? 'no data' : P.ms(c.actual)) + ' (limit ' + c.limit + ' ms)';
    }
    if (c.check === 'error_rate') {
      return 'errors ' + (c.actual == null ? 'no data' : P.pct(c.actual)) + ' (limit ' + P.pct(c.limit) + ')';
    }
    return P.esc(c.check);
  }

  function renderResult(run, fromSaved) {
    var report = run && run.report;
    if (!report) { verdictEl.hidden = true; resultsEl.replaceChildren(); return; }
    var results = report.slo_results || [];
    var failed = results.filter(function (r) { return !r.passed; });
    verdictEl.hidden = false;
    verdictEl.innerHTML = '<span class="verdict-word ' + (report.verdict === 'pass' ? 'pass">PASS' : 'fail">FAIL') + '</span>' +
      '<span class="verdict-detail">' + (failed.length
        ? 'Did not hold: ' + P.esc(failed.map(function (r) { return r.name; }).join('; ')) + '.'
        : 'All three hypotheses held.') +
      (fromSaved && run.finished_at ? ' Saved run from ' + P.ago(run.finished_at) + '.' : '') + '</span>';

    var html = '<ol class="hypotheses">' + results.map(function (r) {
      return '<li class="' + (r.passed ? 'pass' : 'fail') + '"><span class="mark">' + (r.passed ? '✓' : '✕') + '</span>' +
        '<span>' + P.esc(r.name) + '</span><span class="measured">' +
        (r.checks || []).map(checkText).join('<br>') + '</span></li>';
    }).join('') + '</ol>';
    html += beforeAfter();
    resultsEl.innerHTML = html;
  }

  function beforeAfter() {
    var def = LABELS[state.scenario];
    if (!def.fix) {
      return '<div class="before-after"><h4>Mitigation</h4><p>' +
        P.esc((state.defs && state.defs.latency && state.defs.latency.no_mitigation_reason) ||
          'Network delay is fixed in clients (timeouts, retries, failover), which this probe setup does not model.') +
        '</p></div>';
    }
    var base = state.saved[key(state.scenario, false)];
    var fixed = state.saved[key(state.scenario, true)];
    var metric = state.scenario === 'kill' ? 'error_rate' : 'p95_ms';
    function value(run, which) {
      var w = run && run.probe_stats && run.probe_stats.orders && run.probe_stats.orders[which];
      if (!w) return null;
      return metric === 'error_rate' ? w.error_rate : w.p95_ms;
    }
    function fmt(v) { return v == null ? '–' : metric === 'error_rate' ? P.pct(v) : P.ms(v); }
    var window = state.scenario === 'kill' ? 'recovery' : 'fault';
    var label = state.scenario === 'kill' ? 'Orders failing after the kill (recovery window)' : 'Orders p95 during ' + def.fault;
    var a = value(base, window), b = value(fixed, window);
    var good = function (v) { return v != null && (metric === 'error_rate' ? v <= 0.05 : v <= SLO); };
    var body = (base || fixed)
      ? '<span class="' + (good(a) ? 'good' : 'bad') + '">' + fmt(a) + '</span> → <span class="' + (good(b) ? 'good' : 'bad') + '">' + fmt(b) + '</span>'
      : '–';
    return '<div class="before-after"><h4>' + label + ': without → with the fix</h4><div class="ba-values">' + body +
      '</div><p>Fix: ' + P.esc(def.fix) + '. ' + (base && fixed ? 'Both from saved runs.' : 'Run both settings to compare.') + '</p></div>';
  }

  function renderLog(events) {
    logEl.replaceChildren();
    (events || []).slice(-120).forEach(function (e) { appendLog(e); });
  }

  function appendLog(e) {
    var li = document.createElement('li');
    var msg = String(e.message || '').replace(/https?:\/\/127\.0\.0\.1:\d+/, '');
    li.textContent = '[' + e.phase + '] ' + msg;
    if (e.ok === false || e.phase === 'error') li.className = 'err';
    if (e.phase === 'evaluate' && e.passed) li.className = 'ok';
    logEl.appendChild(li);
    while (logEl.children.length > 160) logEl.removeChild(logEl.firstChild);
  }

  function showChoice() {
    var k = key(state.scenario, state.mitigation);
    var run = state.saved[k];
    draw(run ? run.events : [], 11.5);
    renderResult(run, true);
    renderLog(run ? run.events : []);
    if (!state.running) {
      P.setStatus(demo, run ? 'live' : '', run ? 'Saved run, ' + P.ago(run.finished_at) : 'No saved run for this choice');
    }
  }

  function syncControls() {
    var def = state.defs && state.defs[state.scenario];
    var fix = LABELS[state.scenario].fix;
    switchInput.disabled = !fix || state.running;
    switchInput.closest('.switch').classList.toggle('is-disabled', !fix);
    if (!fix) switchInput.checked = false;
    switchLabel.textContent = fix ? 'Apply mitigation: ' + fix : 'No mitigation for network delay';
    if (def) describe.textContent = state.mitigation && def.mitigation
      ? def.describe + ' Mitigation: ' + def.mitigation.describe : def.describe;
    runButton.disabled = state.running;
    runButton.textContent = state.running ? 'Running…' : 'Run live (about 15 s)';
    choice.querySelectorAll('button').forEach(function (b) { b.disabled = state.running; });
  }

  function select(scenario, mitigation) {
    state.scenario = scenario;
    state.mitigation = mitigation && !!LABELS[scenario].fix;
    switchInput.checked = state.mitigation;
    P.pressed(choice, 'button', choice.querySelector('[data-scenario="' + scenario + '"]'));
    syncControls();
    var k = key(state.scenario, state.mitigation);
    if (state.saved[k]) { showChoice(); return; }
    P.setStatus(demo, 'loading', 'Loading saved run…');
    var other = LABELS[scenario].fix ? load(scenario, !state.mitigation).catch(function () {}) : Promise.resolve();
    Promise.all([load(scenario, state.mitigation), other]).then(showChoice, function (error) {
      P.failStatus(demo, error, 'Could not load the saved run');
    });
  }

  /* ── Live runs ─────────────────────────────────────────────────────── */

  function wsUrl(path) {
    var base = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var host = location.host;
    if (location.port && location.port !== '80' && location.port !== '8085') host = location.hostname + ':8085';
    return base + host + path;
  }

  function run() {
    if (state.running) return;
    state.running = true;
    state.live = { meta: { scenario: state.scenario, mitigation: state.mitigation }, events: [] };
    syncControls();
    P.setStatus(demo, 'loading', 'Starting…');
    verdictEl.hidden = true;
    resultsEl.replaceChildren();
    logEl.replaceChildren();
    draw([], 11.5);

    var socket, settled = false, pending = null, watching = false;
    function finish(message, isError) {
      if (settled) return;
      settled = true;
      state.running = false;
      try { socket.close(); } catch (e) { /* already closed */ }
      syncControls();
      if (message) P.setStatus(demo, isError ? 'error' : 'live', message);
    }
    function redraw() {
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = null; draw(state.live.events, 11.5); });
    }
    function onFrame(frame) {
      if (frame.type === 'replay') {
        // A finished run's replay is history, not this run: skip it.
        if (!frame.done) (frame.frames || []).forEach(onFrame);
        return;
      }
      if (frame.type === 'start') {
        state.live = { meta: frame, events: [] };
        logEl.replaceChildren();
        return;
      }
      if (frame.type === 'event') {
        state.live.events.push(frame);
        appendLog(frame);
        if (frame.probe) P.setStatus(demo, 'loading', (watching ? 'Watching: ' : 'Running: ') + frame.phase);
        redraw();
        return;
      }
      if (frame.type === 'final') {
        var meta = state.live.meta;
        if (frame.error || !frame.report) { finish('Run failed: ' + (frame.error || 'no report'), true); return; }
        var result = { report: frame.report, probe_stats: frame.probe_stats, events: state.live.events,
          finished_at: Date.now() / 1000, scenario: meta.scenario, mitigation: meta.mitigation };
        state.saved[key(meta.scenario, meta.mitigation)] = result;
        draw(result.events, 11.5);
        if (meta.scenario === state.scenario && !!meta.mitigation === state.mitigation) renderResult(result, false);
        finish((frame.report.verdict === 'pass' ? 'PASS' : 'FAIL') + ', measured just now');
        if (watching) select(state.scenario, state.mitigation);
      }
    }

    try {
      socket = new WebSocket(wsUrl('/ws/chaos'));
      socket.onmessage = function (event) {
        try { onFrame(JSON.parse(event.data)); } catch (e) { /* ignore malformed frame */ }
      };
      socket.onopen = function () {
        P.post('/api/chaos/run', { scenario: state.scenario, mitigation: state.mitigation }).then(function (d) {
          if (d.busy && d.running) {
            watching = true;
            var r = d.running;
            P.setStatus(demo, 'loading', 'Another visitor is running ' + LABELS[r.scenario].fault + (r.mitigation ? ' with the fix' : '') + '; watching it live');
          } else if (!d.started) {
            finish(d.error || 'The experiment could not start.', true);
          }
        }).catch(function (error) { finish(error.message, true); });
      };
      socket.onerror = function () { finish('Live stream unavailable.', true); };
    } catch (e) {
      finish('This browser cannot open the live stream.', true);
    }
    setTimeout(function () { finish('The run did not finish in time.', true); }, 90000);
  }

  /* ── Wiring ────────────────────────────────────────────────────────── */

  choice.addEventListener('click', function (e) {
    var b = e.target.closest('[data-scenario]');
    if (b && !state.running) select(b.getAttribute('data-scenario'), state.mitigation);
  });
  choice.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var buttons = Array.prototype.slice.call(choice.querySelectorAll('button'));
    var i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    var next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next.focus(); next.click();
  });
  switchInput.addEventListener('change', function () { select(state.scenario, switchInput.checked); });
  runButton.addEventListener('click', run);
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      var run = state.running ? state.live : state.saved[key(state.scenario, state.mitigation)];
      draw(run ? run.events : [], 11.5);
    }).observe(chart);
  }

  // Board + first render: both CPU runs (without and with the fix).
  draw([], 11.5);
  Promise.all([load('cpu', false), load('cpu', true)]).then(function () {
    var a = ordersP95(state.saved['cpu:0']), b = ordersP95(state.saved['cpu:1']);
    if (a && b) {
      P.board('faultline', 'p95 <span class="' + (a.p95_ms <= SLO ? 'good' : 'bad') + '">' + P.ms(a.p95_ms) +
        '</span> → <span class="' + (b.p95_ms <= SLO ? 'good' : 'bad') + '">' + P.ms(b.p95_ms) + '</span> with fix');
    } else if (a) {
      P.board('faultline', 'p95 ' + P.ms(a.p95_ms) + ' vs ' + SLO + ' ms SLO');
    } else {
      P.board('faultline', 'Ready to run live');
    }
    if (!state.running) select(state.scenario, state.mitigation);
  }, function (error) {
    P.board('faultline', 'Server unreachable', 'error');
    state.offline = !!error.offline;
    P.failStatus(demo, error, 'Could not load the saved run');
    draw([], 11.5);
  });
})();
