/* CNC workflow demos: visualize, convert, optimize. Geometry and statistics
   are computed by the Python backend; this file draws and wires them up. */
(function () {
  'use strict';
  var P = window.Portfolio;
  if (!P) return;

  var W = 640, H = 380, PAD = 34;
  var COLORS = { cut: '#67e8f9', rapid: '#fbbf24', drill: '#f472b6', grid: '#1f2735', label: '#7a8496' };

  /* ── Shared plotting ───────────────────────────────────────────────── */

  function bounds(points) {
    var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; });
    return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
             minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) };
  }

  function projector(b) {
    var spanX = Math.max(b.maxX - b.minX, 10), spanY = Math.max(b.maxY - b.minY, 10);
    var scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD - 14) / spanY);
    var ox = PAD + ((W - 2 * PAD) - (b.maxX - b.minX) * scale) / 2;
    var oy = H - PAD - 14 - ((H - 2 * PAD - 14) - (b.maxY - b.minY) * scale) / 2;
    return function (p) { return [ox + (p[0] - b.minX) * scale, oy - (p[1] - b.minY) * scale]; };
  }

  function pointsAttr(points, project) {
    return points.map(function (p) { var q = project(p); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ');
  }

  // Draw segments ({points, kind}) into an SVG; returns the projector so callers
  // can add markers. `box` lets two plots share one scale.
  function plot(svg, segments, box) {
    svg.replaceChildren();
    var all = [];
    segments.forEach(function (s) { all.push.apply(all, s.points); });
    if (!all.length) return null;
    var b = box || bounds(all);
    var project = projector(b);
    for (var x = PAD; x <= W - PAD; x += 48) svg.appendChild(P.svg('line', { x1: x, x2: x, y1: PAD - 10, y2: H - PAD - 10, stroke: COLORS.grid }));
    for (var y = PAD - 10; y <= H - PAD - 10; y += 48) svg.appendChild(P.svg('line', { x1: PAD, x2: W - PAD, y1: y, y2: y, stroke: COLORS.grid }));
    svg.appendChild(P.svg('text', { x: PAD, y: H - 8, fill: COLORS.label, 'font-size': 16 },
      'X ' + fmt(b.minX) + ' to ' + fmt(b.maxX) + ' mm, Y ' + fmt(b.minY) + ' to ' + fmt(b.maxY) + ' mm'));
    ['rapid', 'cut', 'drill'].forEach(function (kind) {
      segments.forEach(function (s, i) {
        if (s.kind !== kind) return;
        var el;
        if (kind === 'drill') {
          var c = project(s.points[0]);
          el = P.svg('circle', { cx: c[0], cy: c[1], r: 5, fill: 'none', stroke: COLORS.drill, 'stroke-width': 2 });
        } else {
          el = P.svg('polyline', { points: pointsAttr(s.points, project), fill: 'none', stroke: COLORS[kind],
            'stroke-width': kind === 'cut' ? 2.2 : 1.4, 'stroke-dasharray': kind === 'rapid' ? '5 5' : '',
            'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: kind === 'rapid' ? 0.75 : 0.95 });
        }
        el.dataset.seg = String(i);
        if (s.line) el.appendChild(P.svg('title', {}, s.motion + ' on line ' + s.line));
        svg.appendChild(el);
      });
    });
    return project;
  }

  function fmt(v) { return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }); }

  function stats(dl, items) {
    dl.innerHTML = items.map(function (it) {
      return '<div><dt>' + it[0] + '</dt><dd' + (it[2] ? ' class="good"' : '') + '>' + it[1] + '</dd></div>';
    }).join('');
  }

  function codeView(el, text) {
    el.innerHTML = text.replace(/\n$/, '').split('\n').map(function (line, i) {
      return '<div class="code-line" data-line="' + (i + 1) + '"><span class="ln">' + (i + 1) +
        '</span><span class="tx">' + P.esc(line) + '</span></div>';
    }).join('');
  }

  function cnc(path, body) { return P.post('/api/cnc/' + path, body, { timeout: 30000 }); }

  /* ── 1. Visualizer ─────────────────────────────────────────────────── */

  var vis = document.querySelector('[data-demo="visualizer"]');
  var PROGRAMS = {
    plate: 'G21 G90 G17\nG0 Z5\nG0 X10 Y10\nG1 Z-1 F600\nG1 X100 Y10\nG1 X100 Y65\nG1 X10 Y65\nG1 X10 Y10\nG0 Z5\nG0 X30 Y30\nG1 Z-1\nG1 X80 Y30\nG1 X80 Y45\nG1 X30 Y45\nG1 X30 Y30\nG0 Z5\nM30',
    arcs: 'G21 G90 G17\nG0 Z5\nG0 X20 Y40\nG1 Z-1 F600\nG2 X60 Y40 I20 J0\nG2 X20 Y40 I-20 J0\nG0 Z5\nG0 X70 Y40\nG1 Z-1\nG3 X100 Y40 R15\nG3 X70 Y40 R15\nG0 Z5\nM30',
    drill: '(Bolt pattern, peck drilling)\nG21 G90 G17\nG0 Z5\nG0 X10 Y10\nG83 X10 Y10 Z-6 R1 Q2 F150\nX50 Y10\nX90 Y10\nX90 Y50\nX50 Y50\nX10 Y50\nG80\nG0 Z5\nM30',
    real: '%\nO1001 (Bracket, 6 mm end mill)\nG21 G90 G17 G40 G49 G54\nT1 M6\nS12000 M3 M8\nG0 X0 Y0 Z5\nG43 H1 Z5\nG1 Z-2 F300\nG1 X60 F900\nG2 X80 Y20 R20\nG1 Y60\nG3 X60 Y80 R20\nG1 X0\nG1 Y0\nG0 Z5\nG28 G91 Z0\nG90\nM5 M9\nM30\n%',
  };

  if (vis) (function () {
    var svg = vis.querySelector('[data-plot]');
    var code = vis.querySelector('[data-code]');
    var gutter = vis.querySelector('[data-gutter]');
    var select = vis.querySelector('[data-sample]');
    var range = vis.querySelector('[data-move]');
    var label = vis.querySelector('[data-move-label]');
    var playBtn = vis.querySelector('[data-play]');
    var notes = vis.querySelector('[data-notes]');
    var dl = vis.querySelector('[data-stats]');
    var st = { result: null, project: null, marker: null, timer: null, seq: 0, debounce: null };

    function gutterLines() {
      var n = code.value.split('\n').length;
      var html = '';
      for (var i = 1; i <= n; i++) html += '<div data-gl="' + i + '">' + i + '</div>';
      gutter.innerHTML = html;
      gutter.scrollTop = code.scrollTop;
    }

    function markLine(line) {
      gutter.querySelectorAll('.is-current').forEach(function (el) { el.classList.remove('is-current'); });
      var el = gutter.querySelector('[data-gl="' + line + '"]');
      if (!el) return;
      el.classList.add('is-current');
      var lineHeight = el.offsetHeight || 19;
      var top = (line - 1) * lineHeight;
      if (top < code.scrollTop || top > code.scrollTop + code.clientHeight - lineHeight * 2) {
        code.scrollTop = Math.max(0, top - code.clientHeight / 2);
      }
    }

    function step() {
      var i = Number(range.value) - 1;
      svg.querySelectorAll('.is-active').forEach(function (el) {
        el.classList.remove('is-active');
        el.setAttribute('stroke-width', el.dataset.w);
      });
      if (!st.result || i < 0) {
        if (st.marker) st.marker.setAttribute('visibility', 'hidden');
        label.textContent = st.result ? 'Whole path' : '';
        markLine(0);
        return;
      }
      var seg = st.result.segments[i];
      var el = svg.querySelector('[data-seg="' + i + '"]');
      if (el) {
        el.dataset.w = el.getAttribute('stroke-width');
        el.classList.add('is-active');
        el.setAttribute('stroke-width', seg.kind === 'drill' ? 3 : 4);
      }
      var p = st.project(seg.points[seg.points.length - 1]);
      st.marker.setAttribute('cx', p[0]); st.marker.setAttribute('cy', p[1]);
      st.marker.setAttribute('visibility', 'visible');
      label.textContent = 'Move ' + (i + 1) + ' of ' + st.result.moves + ', line ' + seg.line;
      markLine(seg.line);
    }

    function stop() {
      clearInterval(st.timer); st.timer = null;
      playBtn.textContent = 'Play';
      playBtn.setAttribute('aria-label', 'Play the toolpath');
    }

    function render(result) {
      st.result = result;
      st.project = plot(svg, result.segments);
      st.marker = P.svg('circle', { r: 6, fill: '#fff', stroke: '#67e8f9', 'stroke-width': 2, visibility: 'hidden' });
      svg.appendChild(st.marker);
      range.max = String(result.moves);
      range.value = '0';
      stats(dl, [['Motion commands', result.moves], ['Feed distance', fmt(result.cut_mm) + ' mm'],
        ['Rapid distance', fmt(result.rapid_mm) + ' mm'], ['Holes drilled', result.holes || 0]]);
      notes.innerHTML = (result.warnings || []).map(function (n) {
        return '<li class="' + n.level + '"><b>' + P.esc(n.code) + '</b>' + P.esc(n.message) +
          ' <span class="lines">(line' + (n.lines.length > 1 ? 's ' : ' ') + n.lines.join(', ') + ')</span></li>';
      }).join('');
      step();
    }

    function run() {
      stop();
      var mine = ++st.seq;
      P.setStatus(vis, 'loading', 'Parsing…');
      return cnc('visualize', { code: code.value }).then(function (result) {
        if (mine !== st.seq) return result;
        render(result);
        var warnings = (result.warnings || []).filter(function (n) { return n.level === 'warning'; }).length;
        P.setStatus(vis, 'live', result.moves + ' moves' + (warnings ? ', ' + warnings + ' warning' + (warnings > 1 ? 's' : '') : ''));
        return result;
      }).catch(function (error) {
        if (mine === st.seq) P.failStatus(vis, error, 'Program error');
        if (mine === st.seq) notes.innerHTML = '<li class="warning"><b>Error</b>' + P.esc(error.message) + '</li>';
        throw error;
      });
    }

    function load(program) {
      code.value = program;
      gutterLines();
      return run();
    }

    code.addEventListener('input', function () {
      gutterLines();
      clearTimeout(st.debounce);
      st.debounce = setTimeout(function () { run().catch(function () {}); }, 400);
    });
    code.addEventListener('scroll', function () { gutter.scrollTop = code.scrollTop; });
    select.addEventListener('change', function () {
      if (PROGRAMS[select.value]) load(PROGRAMS[select.value]).catch(function () {});
    });
    range.addEventListener('input', function () { stop(); step(); });
    playBtn.addEventListener('click', function () {
      if (st.timer) { stop(); return; }
      if (!st.result) return;
      if (Number(range.value) >= st.result.moves) range.value = '0';
      playBtn.textContent = 'Pause';
      playBtn.setAttribute('aria-label', 'Pause the toolpath');
      var delay = Math.max(60, Math.min(400, 6000 / st.result.moves));
      st.timer = setInterval(function () {
        if (Number(range.value) >= st.result.moves) { stop(); return; }
        range.value = String(Number(range.value) + 1);
        step();
      }, delay);
    });
    vis.querySelectorAll('[data-download]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.download === 'gcode') { P.download(code.value, 'toolpath.nc', 'text/plain'); return; }
        cnc('visualize', { code: code.value, export: true }).then(function (r) {
          P.download(r.svg, 'toolpath.svg', 'image/svg+xml');
        }).catch(function (error) { P.failStatus(vis, error, 'Export failed'); });
      });
    });

    // Other demos hand programs over through this.
    window.Portfolio.openInVisualizer = function (program, name) {
      var option = select.querySelector('[value="handoff"]');
      if (!option) {
        option = document.createElement('option'); option.value = 'handoff'; select.appendChild(option);
      }
      option.textContent = name;
      select.value = 'handoff';
      document.getElementById('project-gcode-visualizer').scrollIntoView({ behavior: P.reducedMotion ? 'auto' : 'smooth' });
      load(program).catch(function () {});
    };

    code.value = PROGRAMS.plate;
    gutterLines();
    P.shared('cnc:visualize:plate', run).then(function (r) {
      P.board('visualizer', r.moves + ' moves, ' + fmt(r.cut_mm) + ' mm cut');
    }).catch(function () { P.board('visualizer', 'Server unreachable', 'error'); });
  })();

  /* ── 2. Converter ──────────────────────────────────────────────────── */

  var conv = document.querySelector('[data-demo="converter"]');
  if (conv) (function () {
    var svg = conv.querySelector('[data-plot]');
    var gcodeEl = conv.querySelector('[data-gcode]');
    var select = conv.querySelector('[data-sample]');
    var feed = conv.querySelector('[data-feed]'), depth = conv.querySelector('[data-depth]'), safe = conv.querySelector('[data-safe]');
    var file = conv.querySelector('[data-file]');
    var dl = conv.querySelector('[data-stats]');
    var st = { result: null, dxf: null, name: 'mounting-plate', seq: 0, debounce: null };

    function highlight(index) {
      gcodeEl.querySelectorAll('.is-hl').forEach(function (el) { el.classList.remove('is-hl'); });
      svg.querySelectorAll('.contour-hit').forEach(function (el, i) {
        el.setAttribute('stroke', i === index ? '#ffffff' : 'transparent');
      });
      if (index == null || index < 0 || !st.result) return;
      var span = st.result.contour_lines[index];
      for (var line = span[0]; line <= span[1]; line++) {
        var row = gcodeEl.querySelector('[data-line="' + line + '"]');
        if (row) row.classList.add('is-hl');
      }
      var first = gcodeEl.querySelector('[data-line="' + span[0] + '"]');
      if (first) gcodeEl.scrollTop = Math.max(0, first.offsetTop - 20);
    }

    function render(r) {
      st.result = r;
      var project = plot(svg, r.segments);
      r.contours.forEach(function (contour, i) {
        var hit = P.svg('polyline', { points: pointsAttr(contour, project), fill: 'none', stroke: 'transparent',
          'stroke-width': 10, class: 'contour-hit', tabindex: 0 });
        hit.appendChild(P.svg('title', {}, 'Contour ' + (i + 1) + ': G-code lines ' + r.contour_lines[i][0] + '–' + r.contour_lines[i][1]));
        hit.addEventListener('mouseenter', function () { highlight(i); });
        hit.addEventListener('focus', function () { highlight(i); });
        hit.addEventListener('click', function () { highlight(i); });
        svg.appendChild(hit);
      });
      codeView(gcodeEl, r.gcode);
      stats(dl, [['DXF entities', r.entity_count], ['Contours', r.contours.length],
        ['G-code lines', r.gcode.trim().split('\n').length], ['Cycle time (est.)', r.cycle_minutes.toFixed(1) + ' min']]);
    }

    function run() {
      var mine = ++st.seq;
      P.setStatus(conv, 'loading', 'Converting…');
      var body = { sample: select.value, dxf: st.dxf, feed: Number(feed.value), depth: Number(depth.value), safe_z: Number(safe.value) };
      return cnc('convert', body).then(function (r) {
        if (mine !== st.seq) return r;
        render(r);
        var kinds = Object.keys(r.entities).map(function (k) { return r.entities[k] + ' ' + k; }).join(', ');
        P.setStatus(conv, 'live', kinds);
        return r;
      }).catch(function (error) {
        if (mine === st.seq) {
          P.failStatus(conv, error, 'Cannot convert');
          gcodeEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
        }
        throw error;
      });
    }

    function later() { clearTimeout(st.debounce); st.debounce = setTimeout(function () { run().catch(function () {}); }, 350); }
    select.addEventListener('change', function () { st.dxf = null; file.value = ''; st.name = select.value; run().catch(function () {}); });
    [feed, depth, safe].forEach(function (input) { input.addEventListener('input', later); });
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      if (f.size > 500000) { P.setStatus(conv, 'error', 'Use a DXF under 500 KB'); file.value = ''; return; }
      f.text().then(function (text) { st.dxf = text; st.name = f.name.replace(/\.dxf$/i, ''); run().catch(function () {}); });
    });
    conv.querySelectorAll('[data-download]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.download === 'gcode') {
          if (st.result) P.download(st.result.gcode, st.name + '.nc', 'text/plain');
          return;
        }
        if (st.dxf) { P.download(st.dxf, st.name + '.dxf', 'application/dxf'); return; }
        fetch((location.port && location.port !== '80' && location.port !== '8085' ? location.protocol + '//' + location.hostname + ':8085' : '') +
          '/api/cnc/sample/' + select.value).then(function (r) { return r.text(); })
          .then(function (text) { P.download(text, select.value + '.dxf', 'application/dxf'); });
      });
    });
    conv.querySelector('[data-send]').addEventListener('click', function () {
      if (st.result && P.openInVisualizer) P.openInVisualizer(st.result.gcode, 'From the converter: ' + st.name);
    });

    P.shared('cnc:convert:mounting-plate', run).then(function (r) {
      P.board('converter', r.contours.length + ' contours → ' + r.gcode.trim().split('\n').length + ' lines');
    }).catch(function () { P.board('converter', 'Server unreachable', 'error'); });
  })();

  /* ── 3. Optimizer ──────────────────────────────────────────────────── */

  var opt = document.querySelector('[data-demo="optimizer"]');
  if (opt) (function () {
    var before = opt.querySelector('[data-before]'), after = opt.querySelector('[data-after]');
    var beforeLabel = opt.querySelector('[data-before-label]'), afterLabel = opt.querySelector('[data-after-label]');
    var layout = opt.querySelector('[data-layout]');
    var algos = opt.querySelector('[data-algorithms]');
    var dl = opt.querySelector('[data-stats]');
    var routeEl = opt.querySelector('[data-route]');
    var st = { result: null, chosen: null, seed: 7, seq: 0 };

    function numberStarts(svg, project, segments, order) {
      // Label each contour's start with its contour number, so both plots and
      // the visiting order below use the same names.
      var n = 0;
      segments.forEach(function (s, i) {
        if (s.kind !== 'cut' || (segments[i - 1] && segments[i - 1].kind === 'cut')) return;
        var p = project(s.points[0]);
        var id = order ? order[n] : n + 1;
        n += 1;
        svg.appendChild(P.svg('circle', { cx: p[0], cy: p[1], r: 11, fill: '#0b0e14', stroke: '#a3acbb', 'stroke-width': 1 }));
        svg.appendChild(P.svg('text', { x: p[0], y: p[1] + 4.5, fill: '#e7eaf0', 'font-size': 13, 'text-anchor': 'middle' }, String(id)));
      });
    }

    // The visualizer splits each contour into plunge/cut moves; keep the XY ones.
    function xy(segments) { return segments.filter(function (s) { return s.points.length > 1 || s.kind === 'drill'; }); }

    function show(name) {
      var r = st.result, route = r.routes[name];
      st.chosen = name;
      P.pressed(algos, 'button', algos.querySelector('[data-algo="' + name + '"]'));
      var all = [];
      xy(r.before).forEach(function (s) { all.push.apply(all, s.points); });
      var box = bounds(all);
      var pb = plot(before, xy(r.before), box);
      numberStarts(before, pb, xy(r.before));
      var pa = plot(after, xy(route.segments), box);
      numberStarts(after, pa, xy(route.segments), route.order);
      beforeLabel.innerHTML = 'Original order <b>' + fmt(r.before_mm) + ' mm</b>';
      afterLabel.innerHTML = P.esc(route.label) + ' <b>' + fmt(route.rapid_mm) + ' mm</b>';
      stats(dl, [['Less rapid travel', route.saved_pct.toFixed(1) + '%', route.saved_pct > 0],
        ['Distance saved', fmt(r.before_mm - route.rapid_mm) + ' mm'], ['Contours (unchanged)', r.contour_count],
        ['Cut length (unchanged)', fmt(r.cut_mm) + ' mm']]);
      routeEl.textContent = 'Contours in the new visiting order: ' + route.order.join(' → ') + (route.kept_original ? ' (heuristic was worse; original kept)' : '');
    }

    function render(r) {
      st.result = r;
      var best = r.algorithm;
      algos.innerHTML = ['nearest', 'x-sort', 'two-opt'].map(function (name) {
        var route = r.routes[name];
        return '<button type="button" role="radio" aria-checked="false" data-algo="' + name + '">' + P.esc(route.label) +
          '<small>−' + route.saved_pct.toFixed(0) + '%' + (name === best ? ', shortest' : '') + '</small></button>';
      }).join('');
      show(best);
    }

    function body() {
      return layout.value === 'random'
        ? { layout: 'random', seed: st.seed, count: 14, algorithm: 'all' }
        : { sample: layout.value, algorithm: 'all' };
    }

    function run() {
      var mine = ++st.seq;
      P.setStatus(opt, 'loading', 'Optimizing…');
      return cnc('optimize', body()).then(function (r) {
        if (mine !== st.seq) return r;
        render(r);
        P.setStatus(opt, 'live', r.contour_count + ' contours, 3 algorithms');
        return r;
      }).catch(function (error) {
        if (mine === st.seq) {
          P.failStatus(opt, error, 'Cannot optimize');
          routeEl.textContent = error.message;
        }
        throw error;
      });
    }

    function currentGcode() {
      var b = body(); b.algorithm = st.chosen || 'two-opt';
      return cnc('optimize', b).then(function (r) { return r.gcode; });
    }

    algos.addEventListener('click', function (e) {
      var b = e.target.closest('[data-algo]');
      if (b && st.result) show(b.getAttribute('data-algo'));
    });
    layout.addEventListener('change', function () { run().catch(function () {}); });
    opt.querySelector('[data-shuffle]').addEventListener('click', function () {
      st.seed = Math.floor(Math.random() * 1000000);
      layout.value = 'random';
      run().catch(function () {});
    });
    opt.querySelector('[data-download]').addEventListener('click', function () {
      currentGcode().then(function (code) { P.download(code, 'optimized-' + (st.chosen || 'route') + '.nc', 'text/plain'); });
    });
    opt.querySelector('[data-send]').addEventListener('click', function () {
      currentGcode().then(function (code) {
        if (P.openInVisualizer) P.openInVisualizer(code, 'From the optimizer: ' + (st.result.routes[st.chosen] || {}).label);
      });
    });

    P.shared('cnc:optimize:scattered', run).then(function (r) {
      var best = r.routes[r.algorithm];
      P.board('optimizer', '<span class="good">−' + best.saved_pct.toFixed(0) + '%</span> rapid travel');
    }).catch(function () { P.board('optimizer', 'Server unreachable', 'error'); });
  })();
})();
