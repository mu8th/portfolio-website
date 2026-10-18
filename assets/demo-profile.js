/* Profiler demo: measure the report, fix the hot path, measure again. */
(function () {
  'use strict';
  var P = window.Portfolio;
  var demo = document.querySelector('[data-demo="profile"]');
  if (!P || !demo) return;

  var ALL = ['load_orders', 'match_vip', 'totals_by_day'];
  var summaryEl = demo.querySelector('[data-profile-summary]');
  var barsEl = demo.querySelector('[data-profile-bars]');
  var nextEl = demo.querySelector('[data-profile-next]');
  var historyEl = demo.querySelector('[data-profile-history]');
  var state = { fixes: [], baseline: null, scale: 1, runs: [] };

  function fetchProfile(fixes) {
    var key = fixes.slice().sort().join(',');
    return P.shared('profile:' + key, function () {
      return P.get('/api/profile?fixes=' + encodeURIComponent(key), { timeout: 60000 }).then(function (r) {
        // The server may reuse a result for up to a minute; record when it was measured.
        r.measuredAt = Date.now() / 1000 - (r.cached ? 30 : 0);
        return r;
      });
    });
  }

  function times(a, b) { return b > 0 ? (a / b).toFixed(a / b >= 10 ? 0 : 1) + '×' : '–'; }

  function render(r) {
    var base = state.baseline;
    summaryEl.innerHTML = base && r !== base
      ? '<span class="big">' + P.ms(r.report_wall_ms) + '</span><span>per report, down from ' + P.ms(base.report_wall_ms) +
        '</span><span class="speedup">' + times(base.report_wall_ms, r.report_wall_ms) + ' faster</span>'
      : '<span class="big">' + P.ms(r.report_wall_ms) + '</span><span>per report: ' + r.workload.orders.toLocaleString('en-US') +
        ' orders, ' + r.workload.days + ' days, measured ' + r.workload.repeat + ' times</span>';

    barsEl.innerHTML = r.functions.map(function (f) {
      var wall = f.avg_wall_time_ms, cpu = Math.min(f.avg_cpu_time_ms, wall);
      var wallPct = Math.max(0.4, wall / state.scale * 100), cpuPct = cpu / state.scale * 100;
      return '<div class="pbar"><div class="pbar-top"><span class="pbar-name">' + P.esc(f.function_name) + '()' +
        (f.fixed ? '<span class="fixed">fixed</span>' : '') + '</span>' +
        '<span class="pbar-values">' + P.ms(wall) + ' wall · ' + P.ms(cpu) + ' CPU · ' + f.memory_kb + ' KB</span></div>' +
        '<div class="pbar-track" role="img" aria-label="' + P.esc(f.function_name) + ': ' + P.ms(wall) + ' wall, ' + P.ms(cpu) + ' CPU">' +
        '<span class="pbar-cpu" style="width:' + cpuPct.toFixed(2) + '%"></span>' +
        '<span class="pbar-wait" style="left:' + cpuPct.toFixed(2) + '%;width:' + Math.max(0, wallPct - cpuPct).toFixed(2) + '%"></span>' +
        '</div></div>';
    }).join('');

    var next = r.functions.filter(function (f) { return !f.fixed; })[0];
    if (next) {
      var share = next.wall_pct;
      var waiting = next.waiting_pct > 40 ? ', and ' + Math.round(next.waiting_pct) + '% of that is waiting rather than computing' : '';
      nextEl.innerHTML = '<p><b>Next target: <code>' + P.esc(next.function_name) + '()</code></b> takes ' + Math.round(share) +
        '% of the report' + waiting + '.</p><p class="fix-text">Problem: ' + P.esc(next.problem).replace(/`([^`]+)`/g, '<code>$1</code>') +
        '<br>Fix: ' + P.esc(next.fix) + '</p><div class="row-actions"><button type="button" class="btn btn-run" data-apply="' +
        P.esc(next.function_name) + '">Apply the fix and profile again</button>' +
        (state.fixes.length ? '<button type="button" class="link-btn" data-reset>Start over</button>' : '') + '</div>';
    } else {
      nextEl.innerHTML = '<p><b>All three fixes applied.</b> The report went from ' + P.ms(base.report_wall_ms) + ' to ' +
        P.ms(r.report_wall_ms) + ', ' + times(base.report_wall_ms, r.report_wall_ms) + ' faster, with the same output.</p>' +
        '<div class="row-actions"><button type="button" class="link-btn" data-reset>Start over</button></div>';
    }

    historyEl.innerHTML = state.runs.map(function (run, i) {
      var label = i === 0 ? 'Before any fix' : 'After fixing ' + run.fixes[run.fixes.length - 1] + '()';
      return '<li>' + label + ': <b>' + P.ms(run.report_wall_ms) + '</b></li>';
    }).join('');
  }

  function profile(fixes) {
    P.setStatus(demo, 'loading', 'Profiling on the server…');
    nextEl.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    return fetchProfile(fixes).then(function (r) {
      if (r.error) throw new Error(r.error);
      state.fixes = fixes;
      if (!fixes.length) {
        state.baseline = r;
        state.scale = Math.max.apply(null, r.functions.map(function (f) { return f.avg_wall_time_ms; }));
        state.runs = [r];
      } else {
        state.runs.push(r);
      }
      render(r);
      P.setStatus(demo, 'live', 'Measured on the server ' + P.ago(r.measuredAt));
      return r;
    }).catch(function (error) {
      P.failStatus(demo, error, 'Profiling failed');
      nextEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
      throw error;
    });
  }

  nextEl.addEventListener('click', function (e) {
    var apply = e.target.closest('[data-apply]');
    if (apply) { profile(state.fixes.concat([apply.getAttribute('data-apply')])).catch(function () {}); return; }
    if (e.target.closest('[data-reset]')) profile([]).catch(function () {});
  });

  profile([]).then(function (before) {
    return fetchProfile(ALL).then(function (after) {
      P.board('profile', '<span class="bad">' + P.ms(before.report_wall_ms) + '</span> → <span class="good">' +
        P.ms(after.report_wall_ms) + '</span> after fixes');
    });
  }).catch(function () { P.board('profile', 'Server unreachable', 'error'); });
})();
