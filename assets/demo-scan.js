/* Vulnerability scanner demo: graded sample app and live snippet scanning. */
(function () {
  'use strict';
  var P = window.Portfolio;
  var demo = document.querySelector('[data-demo="scan"]');
  if (!P || !demo) return;

  var scoresEl = demo.querySelector('[data-scan-scores]');
  var filesEl = demo.querySelector('[data-scan-files]');
  var snippetEl = demo.querySelector('[data-snippet]');
  var languageEl = demo.querySelector('[data-language]');
  var resultEl = demo.querySelector('[data-snippet-result]');
  var data = null, filter = 'all', debounce = null, seq = 0;

  var VERDICT = {
    true_positive: 'Caught',
    correctly_ignored: 'Safe, not flagged',
    missed: 'Missed',
    false_positive: 'False alarm',
  };
  var EXAMPLES = {
    python: 'def find_user(conn, name):\n    query = "SELECT * FROM users WHERE name = \'" + name + "\'"\n    return conn.execute(query).fetchone()\n\n\ndef find_order(conn, order_id):\n    return conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()\n\n\nAPI_KEY = "live-key-1234567890"\nDB_PASSWORD = os.environ["DB_PASSWORD"]\n',
    javascript: "function show(list, query, items) {\n  list.innerHTML = '';\n  list.innerHTML = '<li>Results for ' + query + '</li>';\n  items.forEach((item) => {\n    row.innerHTML = `<td>${esc(item.name)}</td>`;\n  });\n}\n",
    config: 'DATABASE_URL=postgres://app@db/app\nPOSTGRES_PASSWORD=postgres\nAPI_KEY=${API_KEY}\nAWS_KEY=AKIAIOSFODNN7EXAMPLE\n',
  };

  // Highlight the matched span (1-based columns) within one line of code.
  function highlight(code, finding) {
    if (!finding || !finding.column || !finding.end_column) return P.esc(code);
    var a = finding.column - 1, b = finding.end_column - 1;
    return P.esc(code.slice(0, a)) + '<mark class="hit">' + P.esc(code.slice(a, b)) + '</mark>' + P.esc(code.slice(b));
  }

  function renderScores(s) {
    function box(value, label, cls) {
      return '<div class="score-box ' + (cls || '') + '"><b>' + value + '</b><span>' + label + '</span></div>';
    }
    scoresEl.innerHTML =
      box(P.pct(s.precision), 'precision: flags that were real', s.precision >= 0.9 ? 'good' : 'warn') +
      box(P.pct(s.recall), 'recall: real flaws it found', s.recall >= 0.9 ? 'good' : 'warn') +
      box(s.true_positive + ' / ' + (s.true_positive + s.missed), 'planted flaws caught') +
      box(s.correctly_ignored + ' / ' + (s.correctly_ignored + s.false_positive), 'safe look-alikes left alone');
  }

  function renderFiles() {
    var groups = {};
    data.lines.forEach(function (row) {
      if (filter !== 'all' && row.verdict !== filter) return;
      (groups[row.file] = groups[row.file] || []).push(row);
    });
    var files = Object.keys(groups);
    if (!files.length) { filesEl.innerHTML = '<p class="empty">No lines in this group.</p>'; return; }
    filesEl.innerHTML = files.map(function (file) {
      return '<div class="scan-file"><h4>' + P.esc(file) + '</h4>' + groups[file].map(function (row) {
        var label = row.finding ? row.finding.label : row.expected ? row.expected : '';
        return '<div class="scan-line ' + row.verdict + '"><span class="ln">' + row.line + '</span>' +
          '<pre><code>' + highlight(row.code, row.finding) + '</code></pre>' +
          '<span class="why"><span class="verdict">' + VERDICT[row.verdict] + (label && row.verdict === 'true_positive' ? ' (' + P.esc(label) + ')' : '') + '.</span>' +
          P.esc(row.why) + '</span></div>';
      }).join('') + '</div>';
    }).join('');
  }

  function scanSnippet() {
    var code = snippetEl.value;
    var mine = ++seq;
    if (!code.trim()) { resultEl.innerHTML = '<p class="empty">Paste some code to scan it.</p>'; return; }
    P.post('/api/scan/snippet', { code: code, language: languageEl.value }).then(function (r) {
      if (mine !== seq) return;
      if (r.error) throw new Error(r.error);
      var lines = code.split('\n');
      if (!r.findings.length) {
        resultEl.innerHTML = '<p class="contract-verdict"><span class="pass">No findings</span> <span>in ' + r.line_count +
          ' lines (' + Number(r.scan_time_ms).toFixed(1) + ' ms).</span></p>';
        return;
      }
      resultEl.innerHTML = '<p class="contract-verdict"><span class="fail">' + r.findings.length + ' finding' + (r.findings.length > 1 ? 's' : '') +
        '</span> <span>in ' + r.line_count + ' lines (' + Number(r.scan_time_ms).toFixed(1) + ' ms).</span></p>' +
        r.findings.map(function (f) {
          return '<div class="finding"><b>' + P.esc(f.label) + '</b> on line ' + f.line +
            '<pre><code>' + highlight(lines[f.line - 1] || f.code, f) + '</code></pre><p>' + P.esc(f.remediation) + '</p></div>';
        }).join('');
    }).catch(function (error) {
      if (mine !== seq) return;
      resultEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
    });
  }

  P.tabs(demo.querySelector('.tabs'), function (tab) {
    if (tab === 'snippet' && !resultEl.innerHTML) scanSnippet();
  });
  demo.querySelector('.filters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b || !data) return;
    filter = b.getAttribute('data-filter');
    P.pressed(b.parentNode, '[data-filter]', b);
    renderFiles();
  });
  snippetEl.value = EXAMPLES.python;
  snippetEl.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(scanSnippet, 400);
  });
  languageEl.addEventListener('change', function () {
    snippetEl.value = EXAMPLES[languageEl.value];
    scanSnippet();
  });

  P.setStatus(demo, 'loading', 'Scanning…');
  P.shared('scan', function () { return P.get('/api/scan'); }).then(function (d) {
    if (d.error) throw new Error(d.error);
    data = d;
    renderScores(d.summary);
    renderFiles();
    P.setStatus(demo, 'live', 'Scanned ' + d.files_scanned + ' files in ' + Number(d.scan_time_ms).toFixed(0) + ' ms');
    P.board('scan', 'Precision <span class="good">' + P.pct(d.summary.precision) + '</span>, recall ' + P.pct(d.summary.recall));
  }).catch(function (error) {
    P.failStatus(demo, error, 'Scan failed');
    filesEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
    P.board('scan', 'Server unreachable', 'error');
  });
})();
