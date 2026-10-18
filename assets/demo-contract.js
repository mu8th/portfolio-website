/* API Contract Tester demo: direction-aware diff, editable spec, validation. */
(function () {
  'use strict';
  var P = window.Portfolio;
  var demo = document.querySelector('[data-demo="contract"]');
  if (!P || !demo) return;

  var state = { data: null, diff: null, filter: 'all', view: 'new', edited: null, selected: -1 };
  var verdictEl = demo.querySelector('[data-contract-verdict]');
  var listEl = demo.querySelector('[data-changes]');
  var viewEl = demo.querySelector('[data-spec-view]');
  var editEl = demo.querySelector('[data-spec-edit]');
  var noteEl = demo.querySelector('[data-spec-note]');
  var resetBtn = demo.querySelector('[data-spec-reset]');
  var bodyEl = demo.querySelector('[data-body]');
  var versionEl = demo.querySelector('[data-version]');
  var violationsEl = demo.querySelector('[data-violations]');
  var debounce = null, seq = 0;

  P.tabs(demo.querySelector('.tabs'));

  function verdict(diff) {
    if (diff.breaking_count) {
      verdictEl.innerHTML = '<span class="fail">Block the release:</span> ' + diff.breaking_count +
        ' of ' + diff.changes.length + ' changes break existing clients. <span>' +
        diff.non_breaking_count + ' are safe.</span>';
    } else {
      verdictEl.innerHTML = '<span class="pass">Safe to release:</span> no breaking changes' +
        (diff.changes.length ? '. <span>' + diff.changes.length + ' compatible changes.</span>' : '. <span>The specs are compatible.</span>');
    }
  }

  function renderList() {
    var diff = state.diff;
    listEl.replaceChildren();
    var items = diff.changes.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) {
      return state.filter === 'all' || x.c.severity === state.filter;
    });
    if (!items.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.filter === 'breaking' ? 'No breaking changes.' : 'No changes in this group.';
      listEl.appendChild(li);
      return;
    }
    items.forEach(function (x) {
      var c = x.c, breaking = c.severity === 'breaking';
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'change' + (breaking ? ' breaking' : '') + (x.i === state.selected ? ' is-selected' : '');
      b.innerHTML = '<span class="change-top"><span class="change-target">' + P.esc(c.target) + '</span>' +
        '<span class="badge ' + (breaking ? 'breaking">Breaking' : 'safe">Safe') + '</span>' +
        (c.direction ? '<span class="badge dir">' + (c.direction === 'both' ? 'request + response' : c.direction) + '</span>' : '') +
        '</span><span class="change-detail">' + P.esc(c.detail) + '</span>' +
        '<span class="change-impact">' + P.esc(c.impact) + '</span>';
      b.addEventListener('click', function () { select(x.i); });
      li.appendChild(b);
      listEl.appendChild(li);
    });
  }

  function specText(which) {
    if (which === 'old') return state.data.old_spec;
    return state.edited != null ? state.edited : state.data.new_spec;
  }

  function renderSpec() {
    var editing = state.view === 'edit';
    editEl.hidden = !editing;
    viewEl.hidden = editing;
    if (editing) return;
    var which = state.view;
    var lines = specText(which).split('\n');
    var marks = {};
    state.diff.changes.forEach(function (c, i) {
      var line = which === 'old' ? c.old_line : c.new_line;
      if (!line) return;
      marks[line] = i === state.selected ? 'is-hl' : (c.severity === 'breaking' ? 'is-breaking' : 'is-safe');
    });
    var frag = document.createDocumentFragment();
    lines.forEach(function (text, i) {
      var row = document.createElement('div');
      row.className = 'code-line' + (marks[i + 1] ? ' ' + marks[i + 1] : '');
      row.dataset.line = String(i + 1);
      row.innerHTML = '<span class="ln">' + (i + 1) + '</span><span class="tx">' + P.esc(text) + '</span>';
      frag.appendChild(row);
    });
    viewEl.replaceChildren(frag);
  }

  function select(index) {
    state.selected = index;
    var c = state.diff.changes[index];
    var view = c.new_line ? (state.view === 'old' && c.old_line ? 'old' : 'new') : 'old';
    setView(view);
    renderList();
    var line = view === 'old' ? c.old_line : c.new_line;
    var row = viewEl.querySelector('[data-line="' + line + '"]');
    if (row) {
      viewEl.scrollTop = Math.max(0, row.offsetTop - viewEl.clientHeight / 2);
    }
    noteEl.textContent = (c.severity === 'breaking' ? 'Breaking: ' : 'Safe: ') + c.impact;
  }

  function setView(view) {
    state.view = view;
    P.pressed(demo.querySelector('.spec-tabs'), '[data-spec]', demo.querySelector('[data-spec="' + view + '"]'));
    if (view === 'edit' && editEl.value === '') editEl.value = specText('new');
    renderSpec();
    if (view === 'edit') {
      noteEl.textContent = 'Edit the spec; the diff against v1.2.0 updates as you type.';
      editEl.focus();
    }
  }

  function apply(diff) {
    state.diff = diff;
    if (state.selected >= diff.changes.length) state.selected = -1;
    verdict(diff);
    renderList();
    renderSpec();
  }

  function rediff() {
    var text = editEl.value;
    state.edited = text === state.data.new_spec ? null : text;
    resetBtn.hidden = state.edited == null;
    var mine = ++seq;
    P.setStatus(demo, 'loading', 'Checking your edit…');
    P.post('/api/contract', { spec: text }).then(function (diff) {
      if (mine !== seq) return;
      state.selected = -1;
      apply(diff);
      P.setStatus(demo, 'live', state.edited == null ? diff.breaking_count + ' breaking' : 'Your edit: ' + diff.breaking_count + ' breaking');
      noteEl.textContent = 'Diff updated from your edit.';
    }).catch(function (error) {
      if (mine !== seq) return;
      P.failStatus(demo, error, error.status === 422 ? 'Spec has an error' : 'Check failed');
      noteEl.textContent = error.message;
    });
  }

  function validate() {
    var version = versionEl.value;
    var body = { body: bodyEl.value };
    if (version === 'old') body.spec = state.data.old_spec;
    if (version === 'edited') body.spec = specText('new');
    violationsEl.innerHTML = '<p class="empty">Validating…</p>';
    P.post('/api/contract/validate', body).then(function (r) {
      if (r.status === 'ERROR') throw new Error(r.error || 'Validation is unavailable.');
      if (!r.violations.length) {
        violationsEl.innerHTML = '<p class="contract-verdict"><span class="pass">PASS:</span> the response matches ' +
          P.esc(r.method + ' ' + r.path) + ' in v' + P.esc(r.version) + '.</p>';
        return;
      }
      violationsEl.innerHTML = '<p class="contract-verdict"><span class="fail">FAIL:</span> ' + r.violations.length +
        ' fields drift from v' + P.esc(r.version) + ', ' + r.breaking + ' breaking.</p>' +
        '<table><thead><tr><th>Field</th><th>Contract says</th><th>Response has</th><th></th></tr></thead><tbody>' +
        r.violations.map(function (v) {
          return '<tr><td><code>' + P.esc(v.field_name) + '</code></td><td>' + P.esc(v.expected_type) + '</td><td>' +
            P.esc(v.actual_type) + '</td><td class="' + (v.breaking_change ? 'breaking">Breaking' : '">Minor') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (error) {
      violationsEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
    });
  }

  demo.querySelector('.filters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b || !state.diff) return;
    state.filter = b.getAttribute('data-filter');
    P.pressed(b.parentNode, '[data-filter]', b);
    renderList();
  });
  demo.querySelector('.spec-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-spec]');
    if (b && state.data) setView(b.getAttribute('data-spec'));
  });
  editEl.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(rediff, 450);
  });
  resetBtn.addEventListener('click', function () {
    editEl.value = state.data.new_spec;
    rediff();
    setView('new');
  });
  demo.querySelector('[data-validate]').addEventListener('click', validate);

  P.setStatus(demo, 'loading', 'Loading…');
  P.shared('contract', function () { return P.get('/api/contract'); }).then(function (data) {
    if (data.status === 'ERROR') throw new Error(data.error || 'The diff failed.');
    state.data = data;
    editEl.value = data.new_spec;
    bodyEl.value = JSON.stringify(data.sample_response, null, 2);
    apply(data);
    var first = data.changes.findIndex(function (c) { return c.severity === 'breaking' && c.new_line; });
    if (first >= 0) select(first);
    P.setStatus(demo, 'live', data.breaking_count + ' breaking changes');
    P.board('contract', '<span class="bad">' + data.breaking_count + ' of ' + data.changes.length + '</span> changes breaking');
    P.onVisible(demo, validate);
  }).catch(function (error) {
    P.failStatus(demo, error, 'Diff failed');
    verdictEl.innerHTML = '<p class="error-box">' + P.esc(error.message) + '</p>';
    P.board('contract', 'Server unreachable', 'error');
  });
})();
