/* Interactive CNC previews. Geometry and statistics are computed by Python. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var API = (location.protocol === 'https:' || location.port === '8085' || !location.port)
    ? '' : location.protocol + '//' + location.hostname + ':8085';
  var visualizer = document.querySelector('[data-cnc="visualizer"]');
  if (!visualizer) return;
  var editor = document.getElementById('cnc-v-code');
  var programs = {
    plate: editor.value,
    arcs: 'G21 G90 G17\nG0 Z5\nG0 X20 Y40\nG1 Z-1 F600\nG2 X60 Y40 I20 J0\nG2 X20 Y40 I-20 J0\nG0 Z5\nG0 X70 Y40\nG1 Z-1\nG3 I15 J0\nG0 Z5\nM30',
    incremental: 'G21 G90\nG0 Z5\nG0 X15 Y15\nG1 Z-1 F600\nG91\nG1 X70\nG1 Y40\nG1 X-70\nG1 Y-40\nG90\nG0 Z5\nM30'
  };
  var records = new Map();
  function node(tag, attrs, text) {
    var element = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { element.setAttribute(key, attrs[key]); });
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function pretty(value) { return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 }); }
  function stats(card, values) {
    card.querySelectorAll('[data-cnc-stat]').forEach(function (el) {
      var key = el.getAttribute('data-cnc-stat');
      el.textContent = values && values[key] !== undefined ? values[key] : '—';
    });
  }
  function status(card, message, state) {
    var badge = card.querySelector('[data-cnc-state]');
    var output = card.querySelector('[data-cnc-status]');
    output.textContent = message;
    output.classList.toggle('is-error', state === 'error');
    badge.textContent = state === 'live' ? 'Python · computed' : state === 'error' ? 'needs attention' : state === 'busy' ? 'computing…' : 'sample preview';
    badge.classList.toggle('is-live', state === 'live');
    badge.classList.toggle('is-error', state === 'error');
  }
  function plot(svg, segments, sharedBounds) {
    svg.replaceChildren();
    var points = segments.flatMap(function (s) { return s.points; });
    if (!points.length) return;
    var bounds = sharedBounds || points;
    var xs = bounds.map(function (p) { return p[0]; });
    var ys = bounds.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var scale = Math.min(530 / Math.max(maxX - minX, 10), 250 / Math.max(maxY - minY, 10));
    var left = 55 + (530 - (maxX - minX) * scale) / 2;
    var bottom = 300 - (250 - (maxY - minY) * scale) / 2;
    function project(p) { return [left + (p[0] - minX) * scale, bottom - (p[1] - minY) * scale]; }
    for (var x = 55; x <= 585; x += 53) svg.appendChild(node('line', { x1: x, x2: x, y1: 35, y2: 300, stroke: '#243548', 'stroke-width': .5 }));
    for (var y = 35; y <= 300; y += 53) svg.appendChild(node('line', { x1: 55, x2: 585, y1: y, y2: y, stroke: '#243548', 'stroke-width': .5 }));
    svg.appendChild(node('text', { x: 55, y: 325, fill: '#aebacc', 'font-size': 11, 'font-family': 'monospace' }, 'X ' + pretty(minX) + ' → ' + pretty(maxX) + ' mm'));
    svg.appendChild(node('text', { x: 410, y: 325, fill: '#aebacc', 'font-size': 11, 'font-family': 'monospace' }, 'Y ' + pretty(minY) + ' → ' + pretty(maxY) + ' mm'));
    // Draw travel below cuts so the geometry remains legible in dense layouts.
    ['rapid', 'cut'].forEach(function (kind) {
      segments.filter(function (s) { return s.kind === kind; }).forEach(function (segment) {
        var attrs = { points: segment.points.map(function (p) { return project(p).join(','); }).join(' '), fill: 'none', stroke: kind === 'rapid' ? '#fbbf24' : '#67e8f9', 'stroke-width': kind === 'rapid' ? 1.5 : 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: kind === 'rapid' ? .6 : .95 };
        if (kind === 'rapid') attrs['stroke-dasharray'] = '5 5';
        var path = node('polyline', attrs);
        path.appendChild(node('title', {}, segment.line ? segment.motion + ' · source line ' + segment.line : kind + ' move'));
        svg.appendChild(path);
      });
    });
    var marker = node('circle', { r: 5, fill: '#fff', stroke: '#67e8f9', 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(marker);
    return { project: project, marker: marker };
  }
  function rectangle(x, y, w, h) { return [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]; }
  function preview(card) {
    var kind = card.dataset.cnc;
    var contours = kind === 'visualizer' ? [rectangle(10,10,90,55), rectangle(30,30,50,15)] : kind === 'optimizer'
      ? [[90,65],[10,10],[90,10],[10,65],[50,38],[50,10],[90,38],[10,38],[50,65]].map(function (p) { return rectangle(p[0], p[1], 10, 8); })
      : [rectangle(10,10,100,60)].concat([[25,25],[95,25],[95,55],[25,55]].map(function (p) { return Array.from({length: 37}, function (_, i) { return [p[0] + 5 * Math.cos(i * Math.PI / 18), p[1] + 5 * Math.sin(i * Math.PI / 18)]; }); }));
    function segments(paths) {
      var previous = [0,0], result = [];
      paths.forEach(function (path) { result.push({ kind: 'rapid', points: [previous, path[0]] }); result.push({ kind: 'cut', points: path }); previous = path[path.length - 1]; });
      return result;
    }
    if (kind === 'optimizer') {
      var before = segments(contours), after = segments(contours.slice().sort(function (a, b) { return a[0][0] - b[0][0] || a[0][1] - b[0][1]; }));
      var bounds = before.flatMap(function (s) { return s.points; });
      plot(card.querySelector('[data-cnc-before]'), before, bounds);
      plot(card.querySelector('[data-cnc-after]'), after, bounds);
    } else plot(card.querySelector('[data-cnc-plot]'), segments(contours));
  }
  async function post(path, body) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await fetch(API + '/api/cnc/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      var result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Check the input size, feed rate, and supported format.');
      return result;
    } finally { clearTimeout(timeout); }
  }
  function download(text, filename, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function step(record) {
    var range = document.getElementById('cnc-v-move');
    var index = Number(range.value) - 1;
    if (!record.result || !record.plot) return;
    record.plot.marker.setAttribute('visibility', index < 0 ? 'hidden' : 'visible');
    var output = document.getElementById('cnc-v-position');
    if (index < 0) { output.textContent = 'Complete path · drag to inspect each move'; return; }
    var segment = record.result.segments[index];
    var point = record.plot.project(segment.points[segment.points.length - 1]);
    record.plot.marker.setAttribute('cx', point[0]); record.plot.marker.setAttribute('cy', point[1]);
    output.textContent = 'Move ' + (index + 1) + '/' + record.result.moves + ' · line ' + segment.line + ' · ' + segment.motion + ' · ' + (segment.kind === 'rapid' ? 'rapid travel' : 'feed move');
  }
  function invalidate(card) {
    var record = records.get(card.dataset.cnc);
    record.version += 1;
    record.result = null;
    stats(card);
    card.querySelectorAll('[data-cnc-download]:not([data-cnc-download="dxf"]), [data-cnc-send]').forEach(function (button) { button.disabled = true; });
    if (card === visualizer) {
      document.getElementById('cnc-v-move').disabled = true;
      document.getElementById('cnc-v-position').textContent = 'Run to inspect source lines';
    }
    if (card.dataset.cnc === 'optimizer') {
      card.querySelector('[data-cnc-before-label]').textContent = 'Sample preview';
      card.querySelector('[data-cnc-after-label]').textContent = 'Run to compare';
      card.querySelector('[data-cnc-route]').textContent = 'Run to reveal the new contour order.';
    }
    if (card.dataset.cnc === 'converter') card.querySelector('[data-cnc-code]').textContent = 'Input changed. Convert the drawing to generate a new program.';
    preview(card);
    status(card, 'Illustrative sample preview. Run with your current input for computed results.', 'preview');
  }
  async function run(card) {
    var record = records.get(card.dataset.cnc);
    if (record.busy) return;
    invalidate(card);
    record.busy = true;
    var version = record.version;
    var button = card.querySelector('[data-cnc-run]');
    button.disabled = true;
    card.setAttribute('aria-busy', 'true');
    status(card, 'Computing geometry and statistics with Python…', 'busy');
    var kind = card.dataset.cnc;
    var source = kind === 'visualizer' ? editor.value : null;
    try {
      var body = kind === 'visualizer' ? { code: source }
        : kind === 'converter' ? { sample: document.getElementById('cnc-d-sample').value, dxf: document.getElementById('cnc-d-text').value || null, feed: Number(document.getElementById('cnc-d-feed').value) }
        : { sample: document.getElementById('cnc-o-sample').value, algorithm: document.getElementById('cnc-o-algorithm').value };
      var result = await post(kind === 'visualizer' ? 'visualize' : kind === 'converter' ? 'convert' : 'optimize', body);
      if (version !== record.version) return;
      record.result = result;
      record.source = source || result.gcode;
      if (kind === 'visualizer') {
        record.plot = plot(card.querySelector('[data-cnc-plot]'), result.segments);
        stats(card, { moves: result.moves, cut: pretty(result.cut_mm), rapid: pretty(result.rapid_mm) });
        var range = document.getElementById('cnc-v-move');
        range.max = result.moves; range.value = 0; range.disabled = false;
        step(record);
        status(card, result.moves + ' motion commands parsed. Drag the slider to connect each move to its source line.', 'live');
      } else if (kind === 'converter') {
        plot(card.querySelector('[data-cnc-plot]'), result.segments);
        card.querySelector('[data-cnc-code]').textContent = result.gcode;
        stats(card, { entities: result.entity_count, contours: result.contours.length, lines: result.gcode.trim().split('\n').length });
        var types = Object.keys(result.entities).map(function (key) { return result.entities[key] + ' ' + key; }).join(' · ');
        status(card, 'Extracted ' + types + '. Generated a millimetre, absolute-position geometry preview with retracts between contours.', 'live');
      } else {
        var bounds = result.before.flatMap(function (s) { return s.points; });
        plot(card.querySelector('[data-cnc-before]'), result.before, bounds);
        plot(card.querySelector('[data-cnc-after]'), result.after, bounds);
        card.querySelector('[data-cnc-before-label]').textContent = pretty(result.before_mm) + ' mm rapid';
        card.querySelector('[data-cnc-after-label]').textContent = pretty(result.after_mm) + ' mm rapid';
        stats(card, { saved: pretty(result.saved_pct) + '%', distance: pretty(result.saved_mm), contours: result.contour_count, cut: pretty(result.cut_mm) });
        var route = card.querySelector('[data-cnc-route]');
        route.replaceChildren();
        var label = document.createElement('b'); label.textContent = 'Contour order: '; route.appendChild(label);
        route.appendChild(document.createTextNode(result.order.join(' → ')));
        status(card, result.kept_original ? 'This heuristic increased travel, so the original order was retained. Cut geometry is preserved.' : pretty(result.saved_pct) + '% less XY rapid travel for this layout. All ' + result.contour_count + ' contours retain their geometry, direction, and start vertex.', 'live');
      }
      card.querySelectorAll('[data-cnc-download]:not([data-cnc-download="dxf"]), [data-cnc-send]').forEach(function (control) { control.disabled = false; });
    } catch (error) {
      if (version === record.version) {
        var message = error.name === 'AbortError' ? 'The Python demo timed out. Try a smaller input and run again.'
          : error instanceof TypeError ? 'The Python demo is unavailable. Start the portfolio backend, then try again. The displayed path is a sample preview.' : error.message;
        status(card, message, 'error');
      }
    } finally {
      record.busy = false;
      button.disabled = false;
      card.removeAttribute('aria-busy');
    }
  }
  document.querySelectorAll('[data-cnc]').forEach(function (card) {
    records.set(card.dataset.cnc, { result: null, busy: false, version: 0 });
    preview(card);
    card.querySelector('[data-cnc-run]').addEventListener('click', function () { run(card); });
    card.querySelectorAll('select, input[type="number"], textarea').forEach(function (input) {
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', function () { invalidate(card); });
    });
    card.querySelectorAll('[data-cnc-download]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var type = button.dataset.cncDownload;
        var record = records.get(card.dataset.cnc);
        try {
          if (type === 'dxf') {
            var name = document.getElementById('cnc-d-sample').value;
            var text = document.getElementById('cnc-d-text').value;
            if (!text) {
              var response = await fetch(API + '/api/cnc/sample/' + name);
              if (!response.ok) throw new Error('Sample DXF is unavailable. Start the portfolio backend and try again.');
              text = await response.text();
            }
            download(text, (document.getElementById('cnc-d-text').value ? 'uploaded-drawing' : name) + '.dxf', 'application/dxf');
          } else if (record.result) download(type === 'svg' ? record.result.svg : record.source, card.dataset.cnc + (type === 'svg' ? '.svg' : '.nc'), type === 'svg' ? 'image/svg+xml' : 'text/plain');
        } catch (error) { status(card, error.message, 'error'); }
      });
    });
    var send = card.querySelector('[data-cnc-send]');
    if (send) send.addEventListener('click', function () {
      var record = records.get(card.dataset.cnc);
      if (!record.result) return;
      editor.value = record.result.gcode;
      var select = document.getElementById('cnc-v-sample');
      if (!select.querySelector('[value="custom"]')) {
        var option = document.createElement('option'); option.value = 'custom'; option.textContent = 'From CNC workflow'; select.appendChild(option);
      }
      select.value = 'custom';
      invalidate(visualizer);
      visualizer.closest('article').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      visualizer.querySelector('[data-cnc-run]').focus({ preventScroll: true });
      run(visualizer);
    });
  });
  document.getElementById('cnc-v-sample').addEventListener('change', function (event) {
    if (programs[event.target.value]) editor.value = programs[event.target.value];
  });
  document.getElementById('cnc-v-move').addEventListener('input', function () { step(records.get('visualizer')); });
  document.getElementById('cnc-d-sample').addEventListener('change', function () {
    document.getElementById('cnc-d-text').value = '';
    document.getElementById('cnc-d-file').value = '';
  });
  document.getElementById('cnc-d-file').addEventListener('change', async function (event) {
    var card = event.target.closest('[data-cnc]');
    var file = event.target.files[0];
    if (!file) return;
    invalidate(card);
    document.getElementById('cnc-d-text').value = '';
    if (file.size > 500000) {
      event.target.value = '';
      status(card, 'Use an ASCII DXF smaller than 500 KB. The selected sample remains available.', 'error');
      return;
    }
    var runButton = card.querySelector('[data-cnc-run]');
    runButton.disabled = true;
    try {
      document.getElementById('cnc-d-text').value = await file.text();
      invalidate(card);
      status(card, 'Loaded ' + file.name + '. Convert to inspect its geometry.', 'preview');
    } catch (error) {
      event.target.value = '';
      status(card, 'Could not read this file. Try a bundled drawing.', 'error');
    } finally { runButton.disabled = records.get('converter').busy; }
  });
})();
