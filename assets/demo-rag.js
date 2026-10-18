/* CodeRAG demo: ask, read a cited answer, expand each citation into its code. */
(function () {
  'use strict';
  var P = window.Portfolio;
  var demo = document.querySelector('[data-demo="rag"]');
  if (!P || !demo) return;

  var form = demo.querySelector('[data-rag-form]');
  var input = demo.querySelector('[data-rag-input]');
  var answerEl = demo.querySelector('[data-rag-answer]');
  var sourcesEl = demo.querySelector('[data-rag-sources]');
  var presets = demo.querySelector('.rag-presets');
  var busy = false;

  function where(s) {
    var symbol = s.symbol && s.symbol !== '<module>' ? ' ' + s.symbol : ' (module)';
    var range = s.start_line ? ':' + s.start_line + (s.end_line && s.end_line !== s.start_line ? '–' + s.end_line : '') : '';
    return s.path + range + symbol;
  }

  function renderAnswer(d) {
    var text = P.esc(String(d.answer || '').trim());
    // Turn [n] markers into buttons that open source n.
    text = text.replace(/\[(\d)\]/g, function (_, n) {
      return '<button type="button" class="cite" data-cite="' + n + '" aria-label="Open source ' + n + '">' + n + '</button>';
    }).replace(/`([^`]+)`/g, '<code>$1</code>');
    var meta = d.confident === false
      ? 'Refused: the best passage scored ' + Number(d.best_score || 0).toFixed(2) + ', below the 0.20 relevance floor.'
      : 'Answered in ' + Math.max(1, Math.round(d.latency_ms || 0)) + ' ms by BM25 retrieval and extractive synthesis' +
        (d.model && d.model !== 'simulated' ? ' (model ' + P.esc(d.model) + ')' : ', no language model') + '.';
    answerEl.className = 'rag-answer' + (d.confident === false ? ' refused' : '');
    answerEl.innerHTML = text + '<span class="rag-meta">' + meta + '</span>';
  }

  function renderSources(sources) {
    sourcesEl.replaceChildren();
    sources.forEach(function (s, i) {
      var li = document.createElement('li');
      var details = document.createElement('details');
      details.className = 'rag-source';
      details.id = 'rag-source-' + (i + 1);
      var score = Math.max(0, Math.min(1, Number(s.score) || 0));
      details.innerHTML = '<summary><span class="rank">[' + (i + 1) + ']</span>' +
        '<span class="where" title="' + P.esc(where(s)) + '">' + P.esc(where(s)) + '</span>' +
        '<span class="score">' + score.toFixed(2) + '<i style="width:' + Math.round(score * 100) + '%"></i></span></summary>' +
        '<pre><code>' + P.esc(s.text || s.snippet || '') + '</code></pre>';
      li.appendChild(details);
      sourcesEl.appendChild(li);
    });
  }

  function ask(question) {
    question = String(question || '').trim();
    if (!question || busy) return;
    busy = true;
    input.value = question;
    form.querySelector('button').disabled = true;
    P.setStatus(demo, 'loading', 'Searching the code…');
    presets.querySelectorAll('[data-question]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-question') === question ? 'true' : 'false');
    });
    var key = 'rag:' + question;
    var call = question === presets.querySelector('[data-question]').getAttribute('data-question')
      ? P.shared(key, function () { return P.post('/api/rag', { question: question }); })
      : P.post('/api/rag', { question: question });
    return call.then(function (d) {
      if (d.status === 'ERROR') throw new Error('The CodeRAG server is offline right now.');
      renderAnswer(d);
      renderSources(d.sources || []);
      P.setStatus(demo, 'live', d.confident === false ? 'No confident match' : (d.sources || []).length + ' cited passages');
      return d;
    }).catch(function (error) {
      answerEl.className = 'rag-answer';
      answerEl.innerHTML = '<span class="error-box">' + P.esc(error.message) + '</span>';
      sourcesEl.replaceChildren();
      P.failStatus(demo, error, 'CodeRAG offline');
      throw error;
    }).finally(function () {
      busy = false;
      form.querySelector('button').disabled = false;
    });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value).catch(function () {}); });
  presets.addEventListener('click', function (e) {
    var b = e.target.closest('[data-question]');
    if (b) ask(b.getAttribute('data-question')).catch(function () {});
  });
  answerEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cite]');
    if (!b) return;
    var details = document.getElementById('rag-source-' + b.getAttribute('data-cite'));
    if (!details) return;
    details.open = true;
    details.classList.add('flash');
    setTimeout(function () { details.classList.remove('flash'); }, 1200);
    details.scrollIntoView({ block: 'nearest', behavior: P.reducedMotion ? 'auto' : 'smooth' });
  });

  ask(input.value).then(function (d) {
    var top = (d.sources || [])[0];
    P.board('rag', top ? 'Cites <span class="good">' + P.esc(top.symbol && top.symbol !== '<module>' ? top.symbol : top.path.split('/').pop()) +
      '</span>, score ' + Number(top.score).toFixed(2) : 'Answers with citations');
  }).catch(function () { P.board('rag', 'Server unreachable', 'error'); });
})();
