/*
 * Интерактивные страницы: Арена (одна игра), Турниры (несколько игр, команды),
 * Эфир (турнир на сервере в реальном времени), Песочница.
 */
(function () {
  'use strict';
  const { esc, $, $$ } = UI;
  const Pages = (window.Pages = {});

  const NOISES = [[0, 'без шума'], [0.01, '1%'], [0.05, '5%'], [0.1, '10%']];
  const SPEEDS = [['live', 'вживую'], ['fast', 'быстро'], ['instant', 'мгновенно']];
  const delayFor = (speed, n) => (speed === 'live' ? Math.min(250, Math.max(15, Math.round(9000 / n)))
    : speed === 'fast' ? Math.min(40, Math.round(2000 / n)) : 0);
  const randomSeed = () => Math.floor(Math.random() * 1e9);

  const trophy = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';
  Pages.trophy = trophy;

  function selectHtml(id, options, value) {
    return `<select class="input" id="${id}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  }

  // Перерисовка не чаще раза в ~120 мс, даже если результаты сыплются быстрее.
  // Без requestAnimationFrame: в фоновой вкладке он замирает, а таблица должна догонять.
  function throttle(fn) {
    let queued = false, last = 0;
    return function () {
      if (queued) return;
      queued = true;
      const wait = Math.max(0, 120 - (performance.now() - last));
      setTimeout(() => { queued = false; last = performance.now(); fn(); }, wait);
    };
  }

  /* ════════════════════════ АРЕНА ════════════════════════ */
  Pages.arena = function (app, q, onLeave) {
    const saved = UI.store.get('arena', {});
    const S = {
      gameId: GT.getGame(q.get('game')) ? q.get('game') : saved.gameId || 'dilemma',
      selected: null,
      rounds: null,
      repeats: saved.repeats || 2,
      noise: saved.noise || 0,
      hidden: !!saved.hidden,
      selfPlay: saved.selfPlay !== false,
      speed: saved.speed || 'live',
      tab: 'table',
      open: new Set(['r0']),
      run: null,
    };
    const persist = () => UI.store.set('arena', { gameId: S.gameId, repeats: S.repeats, noise: S.noise, hidden: S.hidden, selfPlay: S.selfPlay, speed: S.speed, sel: Object.assign(saved.sel || {}, { [S.gameId]: [...S.selected] }) });

    function initGame() {
      const g = GT.getGame(S.gameId);
      const bots = UI.botsFor(S.gameId);
      const prev = saved.sel && saved.sel[S.gameId];
      S.selected = new Set(prev ? prev.filter((id) => bots.some((b) => b.id === id)) : bots.filter((b) => !b.custom).map((b) => b.id));
      S.rounds = g.defaults.rounds;
    }
    initGame();
    // Пресет из ссылки (уроки): ?game=…&bots=a,b,c&rounds=…&noise=…&hidden=1&tab=evo&run=1
    if (q.get('bots')) {
      const ids = q.get('bots').split(',');
      S.selected = new Set(UI.botsFor(S.gameId).filter((b) => ids.includes(b.id)).map((b) => b.id));
    }
    if (q.get('rounds')) S.rounds = Number(q.get('rounds')) || S.rounds;
    if (q.has('noise')) S.noise = Number(q.get('noise')) || 0;
    if (q.has('hidden')) S.hidden = q.get('hidden') === '1';
    if (q.has('self')) S.selfPlay = q.get('self') === '1';
    if (q.get('tab')) S.tab = q.get('tab');
    if (q.get('run') === '1') S.speed = 'live';
    const fromLesson = q.get('lesson');

    app.innerHTML = `<div class="container page">
      <div class="crumbs"><a href="#/">~</a><span>/</span><span>арена</span></div>
      ${fromLesson ? `<a class="btn btn-sm" href="#/learn/${esc(fromLesson)}" style="margin-bottom:14px">← вернуться к уроку</a>` : ''}
      <div class="page-head"><div><h1 class="page-title">Арена</h1>
        <p class="page-sub">Выберите игру и ботов — и столкните их каждый с каждым. Любой матч можно открыть и посмотреть раунд за раундом.</p></div></div>
      <div class="chips" id="game-chips"></div>
      <div class="setup" style="margin-top:22px">
        <div class="card card-pad">
          <div class="panel-title">Боты <span class="comment" id="sel-count"></span><span class="spacer"></span>
            <button class="btn btn-sm" id="sel-all">все</button><button class="btn btn-sm" id="sel-none">никого</button></div>
          <div class="chips" id="bot-chips"></div>
          <p class="comment" style="margin:14px 0 0">// наведите на бота, чтобы прочитать стратегию · свои боты добавляются в <a href="#/sandbox" style="color:var(--primary)">песочнице</a></p>
        </div>
        <div class="setup-side card card-pad">
          <div class="settings-grid">
            <div class="field"><label id="rounds-label">раундов в матче</label><input class="input" type="number" id="rounds" min="1" max="2000"></div>
            <div class="field"><label>матчей на пару</label><input class="input" type="number" id="repeats" min="1" max="10" value="${S.repeats}"></div>
            <div class="field"><label>шум (ошибки ходов)</label>${selectHtml('noise', NOISES, S.noise)}</div>
            <div class="field"><label>скорость</label>${selectHtml('speed', SPEEDS, S.speed)}</div>
          </div>
          <label class="check"><input type="checkbox" id="hidden" ${S.hidden ? 'checked' : ''}> скрытая длина матча</label>
          <label class="check"><input type="checkbox" id="selfplay" ${S.selfPlay ? 'checked' : ''}> играть с собственной копией</label>
          <button class="btn btn-primary" id="run">▶ Запустить турнир</button>
          <div class="comment" id="run-info"></div>
        </div>
      </div>
      <div id="results" style="margin-top:32px"></div>
    </div>`;

    const gameChips = $('#game-chips', app);
    const botChips = $('#bot-chips', app);
    const results = $('#results', app);

    function renderGames() {
      gameChips.innerHTML = GT.gameList().map((g) => `<span class="chip ${g.id === S.gameId ? 'on' : ''}" data-game="${g.id}"><span class="x">${esc(g.icon)}</span>${esc(g.name)}</span>`).join('');
    }
    function renderBots() {
      const bots = UI.botsFor(S.gameId);
      botChips.innerHTML = bots.map((b) => `<span class="chip ${S.selected.has(b.id) ? 'on' : ''} ${b.custom ? 'custom' : ''}" data-bot="${esc(b.id)}" title="${esc(b.desc)}">${b.tag ? `<span class="x">${esc(b.tag)}</span>` : b.custom ? '<span class="x">ваш</span>' : ''}${esc(b.name)}</span>`).join('');
      $('#sel-count', app).textContent = `// выбрано ${S.selected.size} из ${bots.length}`;
      const g = GT.getGame(S.gameId);
      $('#rounds', app).value = S.rounds;
      $('#rounds-label', app).textContent = g.unit === 'аукцион' ? 'аукционов в матче' : 'раундов в матче';
      const n = S.selected.size;
      const matches = GT.schedule(n, Number($('#repeats', app).value) || 1, $('#selfplay', app).checked).length;
      $('#run-info', app).textContent = n >= 2 ? `// ${matches} матчей в турнире` : '// выберите хотя бы двух ботов';
    }
    renderGames();
    renderBots();

    gameChips.addEventListener('click', (e) => {
      const c = e.target.closest('[data-game]');
      if (!c || c.dataset.game === S.gameId) return;
      stop();
      S.gameId = c.dataset.game;
      initGame();
      S.run = null;
      results.innerHTML = '';
      renderGames();
      renderBots();
      history.replaceState(null, '', '#/arena?game=' + S.gameId);
    });
    botChips.addEventListener('click', (e) => {
      const c = e.target.closest('[data-bot]');
      if (!c) return;
      const id = c.dataset.bot;
      if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
      persist();
      renderBots();
    });
    $('#sel-all', app).onclick = () => { UI.botsFor(S.gameId).forEach((b) => S.selected.add(b.id)); persist(); renderBots(); };
    $('#sel-none', app).onclick = () => { S.selected.clear(); persist(); renderBots(); };
    ['repeats', 'selfplay'].forEach((id) => $('#' + id, app).addEventListener('change', renderBots));
    // при выборе игры кнопкой поле раундов сбрасывается к умолчанию, а из ссылки — нет
    $('#rounds', app).value = S.rounds;

    let job = null;
    function stop() {
      if (job) { job.cancel(); job = null; }
      $('#run', app).textContent = '▶ Запустить турнир';
    }
    onLeave(stop);

    $('#run', app).onclick = () => {
      if (job) { stop(); if (S.run) { S.run.stopped = true; draw(); } return; }
      const bots = UI.botsFor(S.gameId).filter((b) => S.selected.has(b.id));
      if (bots.length < 2) { UI.toast('Выберите хотя бы двух ботов'); return; }
      S.rounds = Math.min(2000, Math.max(1, Number($('#rounds', app).value) || GT.getGame(S.gameId).defaults.rounds));
      S.repeats = Math.min(10, Math.max(1, Number($('#repeats', app).value) || 1));
      S.noise = Number($('#noise', app).value);
      S.speed = $('#speed', app).value;
      S.hidden = $('#hidden', app).checked;
      S.selfPlay = $('#selfplay', app).checked;
      persist();
      const seed = randomSeed();
      const pairs = GT.schedule(bots.length, S.repeats, S.selfPlay);
      const opts = { rounds: S.rounds, noise: S.noise, hidden: S.hidden };
      const specs = pairs.map((p, k) => ({ gameId: S.gameId, a: UI.ref(bots[p.a]), b: UI.ref(bots[p.b]), opts: Object.assign({ seed: seed + k }, opts) }));
      S.run = { gameId: S.gameId, bots, names: bots.map((b) => b.name), pairs, specs, results: new Array(specs.length), played: 0, done: false, seed, opts, fatal: null };
      S.open = new Set(['r0']);
      $('#run', app).textContent = '■ Остановить';
      const redraw = throttle(draw);
      draw();
      job = UI.runner.batch(specs, {
        delay: delayFor(S.speed, specs.length),
        onResult(d) {
          S.run.results[d.k] = d.error ? { error: d.error } : d.summary;
          S.run.played++;
          redraw();
        },
        onDone() { S.run.done = true; job = null; stop(); draw(); },
        onFatal(err) { S.run.fatal = err; job = null; stop(); draw(); },
      });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (q.get('run') === '1') setTimeout(() => $('#run', app).click(), 300);

    function compute() {
      const R = S.run;
      const list = [];
      R.results.forEach((r, k) => { if (r && !r.error) list.push(Object.assign({ a: R.pairs[k].a, b: R.pairs[k].b }, r)); });
      return GT.standings(R.bots.length, list);
    }

    function draw() {
      const R = S.run;
      if (!R) return;
      const g = GT.getGame(R.gameId);
      const st = compute();
      const custom = new Set(R.bots.map((b, i) => (b.custom ? i : -1)).filter((i) => i >= 0));
      const pct = Math.round((R.played / R.specs.length) * 100);
      const tabs = [['table', 'Таблица'], ['matches', `Матчи <span class="count">[${R.specs.length}]</span>`], ['cross', 'Перекрёстная'], ['evo', 'Эволюция']];
      let body = '';
      if (S.tab === 'table') {
        body = UI.singleTable(R.names, st, { custom, unit: g.unit });
      } else if (S.tab === 'matches') {
        const groups = [];
        for (let r = 0; r < S.repeats; r++) {
          groups.push({ key: 'r' + r, title: `Раунд ${r + 1}`, tag: g.name, items: R.pairs.map((p, k) => ({ k, a: p.a, b: p.b, r: p.r, res: R.results[k] })).filter((x) => x.r === r) });
        }
        body = UI.roundsHtml(groups, R.names, S.open);
      } else if (S.tab === 'cross') {
        body = `<div class="card card-pad">${UI.heatmap(R.names, st.matrix)}</div>`;
      } else {
        body = R.done
          ? `<div class="card card-pad"><div class="panel-title">Репликаторная динамика <span class="comment">// доля стратегии растёт, если она зарабатывает больше среднего по популяции</span></div>
              <canvas class="chart" id="evo" style="height:300px"></canvas>
              <div class="legend" style="margin-top:12px">${R.names.map((n, i) => `<span><i style="background:${UI.color(i)}"></i>${esc(n)}</span>`).join('')}</div>
              <div id="evo-final" style="margin-top:14px"></div></div>`
          : '<div class="empty">Эволюция считается после окончания турнира</div>';
      }
      results.innerHTML = `
        <div class="row" style="margin-bottom:12px"><h2 style="font-size:24px">${esc(g.name)}</h2><span class="tag ${R.done ? 'tag-done' : 'tag-purple'}">${R.done ? 'Завершён' : R.stopped || R.fatal ? 'Остановлен' : '● идёт'}</span>
          <span class="spacer"></span><span class="comment">seed ${R.seed} · ${R.opts.rounds} ${g.unit === 'аукцион' ? 'аукц.' : 'раунд.'}${R.opts.noise ? ' · шум ' + R.opts.noise * 100 + '%' : ''}${R.opts.hidden ? ' · длина скрыта' : ''}</span></div>
        <div class="card card-pad" style="margin-bottom:18px"><div class="row"><span class="mono" style="font-size:14px">Общий прогресс</span><span class="spacer"></span><span class="mono">${R.played} / ${R.specs.length} (${pct}%)</span></div>
          <div class="progress" style="margin-top:10px"><i style="width:${pct}%"></i></div></div>
        ${R.fatal ? `<div class="error-box" style="margin-bottom:16px">${esc(R.fatal)} Турнир остановлен.</div>` : ''}
        <div class="tabs" id="res-tabs" style="margin-bottom:20px">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        ${body}`;
      if (S.tab === 'evo' && R.done) {
        const evo = GT.evolution(st.matrix, 150);
        UI.areaChart($('#evo', results), evo, R.names.map((_, i) => UI.color(i)));
        const fin = evo[evo.length - 1].map((v, i) => [i, v]).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
        $('#evo-final', results).innerHTML = `<span class="mono" style="font-size:14px">Выжили через 150 поколений: </span>${fin.map(([i, v]) => `<span class="tag" style="margin:2px"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${UI.color(i)}"></i> ${esc(R.names[i])} ${Math.round(v * 100)}%</span>`).join(' ')}`;
      }
    }

    results.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { S.tab = t.dataset.tab; draw(); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) { const k = tg.dataset.toggle; if (S.open.has(k)) S.open.delete(k); else S.open.add(k); draw(); return; }
      const m = e.target.closest('[data-match]');
      if (m && S.run) {
        const k = Number(m.dataset.match);
        const p = S.run.pairs[k];
        UI.openReplay(S.run.specs[k], [S.run.names[p.a], S.run.names[p.b]], GT.getGame(S.run.gameId).name);
      }
    });
  };

  /* ════════════════════════ ТУРНИР КОМАНД ════════════════════════ */
  function kindsOf(gameIds) {
    return [...new Set(gameIds.map((g) => GT.getGame(g).kind))];
  }

  // Общий вывод результатов многоигрового турнира (локального и эфира)
  function tournamentView(container, getState, opts) {
    const V = { tab: 'table', open: new Set() };
    function draw() {
      const T = getState();
      if (!T) { container.innerHTML = ''; return; }
      const comp = UI.computeTournament(T);
      const played = T.results.filter(Boolean).length;
      const pct = Math.round((played / Math.max(1, T.total)) * 100);
      const done = played >= T.total;
      const tabs = [['table', 'Таблица'], ['matches', `Матчи <span class="count">[${T.total}]</span>`], ['games', `Игры <span class="count">[${T.games.length}]</span>`], ['teams', `Команды <span class="count">[${T.names.length}]</span>`]];
      let body = '';
      if (V.tab === 'table') {
        body = `${done ? UI.podium(T.names, comp.overall) : ''}
          <div style="margin-top:22px">${UI.multiTable(T.names, T.games, comp.overall, { mine: T.mine })}</div>
          <div class="card card-pad" style="margin-top:22px"><div class="panel-title">Итоги турнира</div>${UI.highlightsHtml(comp.highlights)}</div>`;
      } else if (V.tab === 'matches') {
        const groups = T.games.map((gid, gi) => ({
          key: gid, title: `Раунд ${gi + 1}`, tag: GT.getGame(gid).name,
          items: T.schedule.map((p, j) => { const k = gi * T.schedule.length + j; return { k, a: p.a, b: p.b, res: T.results[k] }; }),
        }));
        body = UI.roundsHtml(groups, T.names, V.open);
      } else if (V.tab === 'games') {
        body = comp.perGame.map((pg) => {
          const g = GT.getGame(pg.gameId);
          const botNames = T.names.map((n, i) => `${n} · ${T.botName(i, g.kind)}`);
          return `<div style="margin-bottom:28px"><div class="row" style="margin-bottom:12px"><span class="icon-tile sm c-${g.color}">${esc(g.icon)}</span><h3 style="font-size:20px">${esc(g.name)}</h3><span class="comment">${pg.played}/${pg.total} матчей</span></div>
            ${UI.singleTable(botNames, pg.standings, { unit: g.unit })}</div>`;
        }).join('');
      } else {
        const kinds = kindsOf(T.games);
        body = `<div class="table-wrap"><table class="table"><thead><tr><th>Команда</th>${kinds.map((k) => `<th>${esc(T.games.filter((g) => GT.getGame(g).kind === k).map((g) => GT.getGame(g).name).join(', '))}</th>`).join('')}</tr></thead>
          <tbody>${T.names.map((n, i) => `<tr><td class="team" style="font-weight:700">${esc(n)}</td>${kinds.map((k) => `<td>${esc(T.botName(i, k))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      container.innerHTML = `
        <div class="row" style="margin-bottom:14px"><h2 style="font-size:26px">${esc(T.title)}</h2><span class="tag ${done ? 'tag-done' : 'tag-purple'}">${done ? 'Завершён' : T.stopped ? 'Остановлен' : '● идёт'}</span>
          ${opts.extraTags ? opts.extraTags(T) : ''}<span class="spacer"></span>
          <button class="btn btn-sm" data-board>⛶ Табло</button></div>
        ${opts.banner ? opts.banner(T) : ''}
        <div class="card card-pad" style="margin-bottom:18px"><div class="row"><span class="mono" style="font-size:14px">Общий прогресс</span><span class="spacer"></span><span class="mono">${played} / ${T.total} (${pct}%)</span></div>
          <div class="progress" style="margin-top:10px"><i style="width:${pct}%"></i></div></div>
        ${T.fatal ? `<div class="error-box" style="margin-bottom:16px">${esc(T.fatal)}</div>` : ''}
        <div class="tabs" style="margin-bottom:22px">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        ${body}`;
      if (board) board.refresh();
    }
    let board = null;
    container.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { V.tab = t.dataset.tab; draw(); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) { const k = tg.dataset.toggle; if (V.open.has(k)) V.open.delete(k); else V.open.add(k); draw(); return; }
      if (e.target.closest('[data-board]')) {
        board = UI.openBoard(() => { const T = getState(); return T && { T, comp: UI.computeTournament(T), status: opts.status && opts.status(T), live: opts.live, route: opts.route }; });
        const origClose = board.close;
        board.close = () => { origClose(); board = null; };
        return;
      }
      const m = e.target.closest('[data-match]');
      if (m) {
        const T = getState();
        const k = Number(m.dataset.match);
        const gi = Math.floor(k / T.schedule.length);
        const p = T.schedule[k % T.schedule.length];
        const g = GT.getGame(T.games[gi]);
        const spec = T.spec(k);
        UI.openReplay(spec, [`${T.names[p.a]} · ${T.botName(p.a, g.kind)}`, `${T.names[p.b]} · ${T.botName(p.b, g.kind)}`], g.name);
      }
    });
    onLeaveRef.push(() => { if (board) board.close(); });
    return { draw };
  }
  let onLeaveRef = [];

  Pages.tournament = function (app, q, onLeave) {
    onLeaveRef = [];
    onLeave(() => onLeaveRef.forEach((f) => f()));
    const saved = UI.store.get('tournament', {});
    const S = {
      games: saved.games || ['tug_of_war', 'public_goods', 'travelers_dilemma'],
      teams: new Set(saved.teams || GT.teams.map((t) => t.id)),
      repeats: saved.repeats || 2,
      noise: saved.noise || 0,
      hidden: !!saved.hidden,
      speed: saved.speed || 'live',
      counter: saved.counter || 1,
      T: null,
    };
    const persist = () => UI.store.set('tournament', { games: S.games, teams: [...S.teams], repeats: S.repeats, noise: S.noise, hidden: S.hidden, speed: S.speed, counter: S.counter });

    app.innerHTML = `<div class="container page">
      <div class="crumbs"><a href="#/">~</a><span>/</span><span>турниры</span></div>
      <div class="page-head"><div><h1 class="page-title">Турниры</h1>
        <p class="page-sub">Командный турнир по нескольким играм — как на соревнованиях: место в каждой игре, сумма мест, пьедестал и табло на весь экран.</p></div>
        <a class="btn" href="#/live"><span class="dot live"></span> Эфир на сервере</a></div>
      <div class="setup">
        <div class="grid" style="gap:18px">
          <div class="card card-pad"><div class="panel-title">Игры <span class="comment">// каждая игра — отдельный раунд турнира</span></div><div class="chips" id="t-games"></div></div>
          <div class="card card-pad"><div class="panel-title">Команды <span class="comment" id="t-count"></span><span class="spacer"></span><button class="btn btn-sm" id="t-all">все</button><button class="btn btn-sm" id="t-none">никого</button></div>
            <div class="chips" id="t-teams"></div>
            <details style="margin-top:16px"><summary class="mono" style="cursor:pointer;font-size:14px;color:var(--muted)">составы команд: какой бот играет за команду в каждой игре</summary><div id="t-roster" style="margin-top:12px"></div></details>
            <details style="margin-top:12px"><summary class="mono" style="cursor:pointer;font-size:14px;color:var(--primary)">+ собрать свою команду</summary><div id="t-builder" style="margin-top:12px"></div></details>
          </div>
        </div>
        <div class="setup-side card card-pad">
          <div class="field"><label>название</label><input class="input" id="t-title" value="Турнир #${S.counter}"></div>
          <div class="settings-grid">
            <div class="field"><label>матчей на пару</label><input class="input" type="number" id="t-repeats" min="1" max="6" value="${S.repeats}"></div>
            <div class="field"><label>шум</label>${selectHtml('t-noise', NOISES, S.noise)}</div>
            <div class="field"><label>скорость</label>${selectHtml('t-speed', SPEEDS, S.speed)}</div>
          </div>
          <label class="check"><input type="checkbox" id="t-hidden" ${S.hidden ? 'checked' : ''}> скрытая длина матчей</label>
          <button class="btn btn-primary" id="t-run">${trophy} Запустить турнир</button>
          <div class="comment" id="t-info"></div>
        </div>
      </div>
      <div id="t-results" style="margin-top:36px"></div>
    </div>`;

    function renderSetup() {
      $('#t-games', app).innerHTML = GT.gameList().map((g) => `<span class="chip ${S.games.includes(g.id) ? 'on' : ''}" data-game="${g.id}"><span class="x">${esc(g.icon)}</span>${esc(g.name)}</span>`).join('');
      const teams = UI.allTeams();
      $('#t-teams', app).innerHTML = teams.map((t) => `<span class="chip ${S.teams.has(t.id) ? 'on' : ''} ${t.preset ? '' : 'custom'}" data-team="${esc(t.id)}">${t.preset ? '' : '<span class="x">ваша</span>'}${esc(t.name)}${t.preset ? '' : ` <span class="x" data-del-team="${esc(t.id)}" title="удалить">✕</span>`}</span>`).join('');
      $('#t-count', app).textContent = `// выбрано ${[...S.teams].filter((id) => teams.some((t) => t.id === id)).length}`;
      const kinds = kindsOf(S.games);
      $('#t-roster', app).innerHTML = kinds.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Команда</th>${kinds.map((k) => `<th>${esc(S.games.filter((g) => GT.getGame(g).kind === k).map((g) => GT.getGame(g).name).join(', '))}</th>`).join('')}</tr></thead>
        <tbody>${teams.filter((t) => S.teams.has(t.id)).map((t) => `<tr><td style="font-weight:700">${esc(t.name)}</td>${kinds.map((k) => `<td title="${esc(UI.teamBot(t, k).desc)}">${esc(UI.teamBot(t, k).name)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">выберите игры</div>';
      const allKinds = [...new Set(GT.gameList().map((g) => g.kind))];
      const kindName = (k) => GT.gameList().filter((g) => g.kind === k).map((g) => g.name).join(' / ');
      $('#t-builder', app).innerHTML = `<div class="settings-grid">
          <div class="field" style="grid-column:1/-1"><label>название команды</label><input class="input" id="b-name" placeholder="Например: 6SOT" maxlength="40"></div>
          ${allKinds.map((k) => `<div class="field"><label>${esc(kindName(k))}</label><select class="input" data-kind="${k}">${UI.botsForKind(k).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.custom ? ' (ваш)' : ''}</option>`).join('')}</select></div>`).join('')}
        </div><button class="btn btn-primary btn-sm" id="b-save" style="margin-top:12px">Сохранить команду</button>`;
      const n = [...S.teams].filter((id) => teams.some((t) => t.id === id)).length;
      const per = GT.schedule(n, Number($('#t-repeats', app).value) || 1, false).length;
      $('#t-info', app).textContent = n >= 2 && S.games.length ? `// ${per * S.games.length} матчей: ${S.games.length} игр × ${per}` : '// нужны хотя бы одна игра и две команды';
    }
    renderSetup();

    app.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-team]');
      if (del) {
        e.stopPropagation();
        UI.saveCustomTeams(UI.customTeams().filter((t) => t.id !== del.dataset.delTeam));
        S.teams.delete(del.dataset.delTeam);
        persist(); renderSetup(); return;
      }
      const g = e.target.closest('#t-games [data-game]');
      if (g) {
        const id = g.dataset.game;
        S.games = S.games.includes(id) ? S.games.filter((x) => x !== id) : GT.gameList().map((x) => x.id).filter((x) => x === id || S.games.includes(x));
        persist(); renderSetup(); return;
      }
      const t = e.target.closest('#t-teams [data-team]');
      if (t) {
        const id = t.dataset.team;
        if (S.teams.has(id)) S.teams.delete(id); else S.teams.add(id);
        persist(); renderSetup(); return;
      }
      if (e.target.closest('#t-all')) { UI.allTeams().forEach((x) => S.teams.add(x.id)); persist(); renderSetup(); return; }
      if (e.target.closest('#t-none')) { S.teams.clear(); persist(); renderSetup(); return; }
      if (e.target.closest('#b-save')) {
        const name = $('#b-name', app).value.trim();
        if (!name) { UI.toast('Назовите команду'); return; }
        const bots = {};
        $$('#t-builder [data-kind]', app).forEach((s) => { bots[s.dataset.kind] = s.value; });
        const team = { id: 'team_' + Date.now().toString(36), name, bots };
        UI.saveCustomTeams(UI.customTeams().concat(team));
        S.teams.add(team.id);
        persist(); renderSetup();
        UI.toast(`Команда «${name}» добавлена`);
      }
    });
    $('#t-repeats', app).addEventListener('change', renderSetup);

    const out = $('#t-results', app);
    const view = tournamentView(out, () => S.T, { route: 'tournament' });
    let job = null;
    const stop = () => { if (job) { job.cancel(); job = null; } $('#t-run', app).innerHTML = `${trophy} Запустить турнир`; };
    onLeave(stop);

    $('#t-run', app).onclick = () => {
      if (job) { stop(); if (S.T) { S.T.stopped = true; view.draw(); } return; }
      const teams = UI.allTeams().filter((t) => S.teams.has(t.id));
      if (teams.length < 2 || !S.games.length) { UI.toast('Нужны хотя бы одна игра и две команды'); return; }
      S.repeats = Math.min(6, Math.max(1, Number($('#t-repeats', app).value) || 1));
      S.noise = Number($('#t-noise', app).value);
      S.speed = $('#t-speed', app).value;
      S.hidden = $('#t-hidden', app).checked;
      const title = $('#t-title', app).value.trim() || `Турнир #${S.counter}`;
      S.counter++;
      $('#t-title', app).value = `Турнир #${S.counter}`;
      persist();
      const seed = randomSeed();
      const schedule = GT.schedule(teams.length, S.repeats, false);
      const specs = [];
      S.games.forEach((gid) => {
        const kind = GT.getGame(gid).kind;
        schedule.forEach((p) => {
          specs.push({ gameId: gid, a: UI.ref(UI.teamBot(teams[p.a], kind)), b: UI.ref(UI.teamBot(teams[p.b], kind)), opts: { seed: seed + specs.length, noise: S.noise, hidden: S.hidden } });
        });
      });
      const mine = new Set(teams.map((t, i) => (t.preset ? -1 : i)).filter((i) => i >= 0));
      S.T = {
        title, games: S.games.slice(), names: teams.map((t) => t.name), schedule, perGameTotal: schedule.length,
        total: specs.length, results: new Array(specs.length), mine,
        botName: (i, kind) => UI.teamBot(teams[i], kind).name,
        spec: (k) => specs[k],
      };
      $('#t-run', app).textContent = '■ Остановить';
      const redraw = throttle(view.draw);
      view.draw();
      job = UI.runner.batch(specs, {
        delay: delayFor(S.speed, specs.length),
        onResult(d) {
          const s = specs[d.k];
          const p = schedule[d.k % schedule.length];
          S.T.results[d.k] = d.error ? { error: d.error, gameId: s.gameId, a: p.a, b: p.b } : Object.assign({ gameId: s.gameId, a: p.a, b: p.b }, d.summary);
          redraw();
        },
        onDone() { job = null; stop(); view.draw(); },
        onFatal(err) { S.T.fatal = err; job = null; stop(); view.draw(); },
      });
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  };

  /* ════════════════════════ ЭФИР ════════════════════════ */
  Pages.live = function (app, q, onLeave) {
    onLeaveRef = [];
    onLeave(() => onLeaveRef.forEach((f) => f()));
    let T = null;
    let viewers = 0;
    let connected = false;
    app.innerHTML = `<div class="container page">
      <div class="crumbs"><a href="#/">~</a><span>/</span><span>эфир</span></div>
      <div class="page-head"><div><h1 class="page-title">Эфир</h1>
        <p class="page-sub">Сервер круглосуточно проводит турниры команд-ботов. Все зрители видят одно и то же в реальном времени; каждый матч можно открыть и разобрать по раундам.</p></div>
        <span class="pill" id="live-pill"><span class="dot"></span>подключение…</span></div>
      <div id="live-out"><div class="empty">⠋ подключаюсь к эфиру…</div></div>
    </div>`;
    const out = $('#live-out', app);
    const pill = $('#live-pill', app);

    function adapt(t) {
      const schedule = GT.schedule(t.teams.length, 2, false);
      const results = new Array(t.total);
      t.results.forEach((r) => { results[r.k] = r; });
      return {
        title: `Эфир · турнир #${t.id}`, games: t.games, names: t.teams.map((x) => x.name), schedule,
        perGameTotal: t.perGameTotal || schedule.length, total: t.total, results, raw: t,
        botName: (i, kind) => { const b = GT.strategies[kind].find((s) => s.id === t.teams[i].bots[kind]); return b ? b.name : '?'; },
        spec: (k) => {
          const gi = Math.floor(k / schedule.length);
          const p = schedule[k % schedule.length];
          const kind = GT.getGame(t.games[gi]).kind;
          return { gameId: t.games[gi], a: { id: t.teams[p.a].bots[kind] }, b: { id: t.teams[p.b].bots[kind] }, opts: { seed: t.seed + k, noise: t.noise, hidden: t.hidden } };
        },
      };
    }
    const statusText = (x) => {
      const t = x.raw;
      if (t.status === 'done') {
        const sec = Math.max(0, Math.round((t.nextAt - Date.now()) / 1000));
        return `завершён · следующий через ${sec} с`;
      }
      return `в эфире · ${viewers} ${viewers === 1 ? 'зритель' : viewers < 5 ? 'зрителя' : 'зрителей'}`;
    };
    const view = tournamentView(out, () => T, {
      live: true,
      route: 'live',
      status: statusText,
      extraTags: (x) => `<span class="tag">${x.raw.noise ? 'шум ' + Math.round(x.raw.noise * 100) + '%' : 'без шума'}</span>${x.raw.hidden ? '<span class="tag">длина скрыта</span>' : ''}`,
      banner: (x) => (x.raw.status === 'done' ? `<div class="card card-pad" style="margin-bottom:16px;border-color:var(--primary-line)"><span class="mono">✓ Турнир завершён.</span> <span class="muted">${esc(statusText(x))}</span></div>` : ''),
    });
    const redraw = throttle(view.draw);

    function setPill() {
      pill.innerHTML = connected ? `<span class="dot live"></span>LIVE · ${viewers} ${viewers === 1 ? 'зритель' : 'зрит.'}` : '<span class="dot"></span>нет связи — переподключаюсь';
    }
    if (!window.EventSource) { out.innerHTML = '<div class="empty">Браузер не поддерживает EventSource</div>'; return; }
    const es = new EventSource('/api/live');
    onLeave(() => es.close());
    es.onopen = () => { connected = true; setPill(); };
    es.onerror = () => { connected = false; setPill(); };
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'snapshot') {
        viewers = d.viewers || viewers;
        T = d.tournament ? adapt(d.tournament) : null;
        if (!T) out.innerHTML = '<div class="empty">Эфир готовится — первый турнир начнётся через пару секунд</div>';
        else view.draw();
      } else if (d.type === 'start') {
        T = adapt(d.tournament);
        view.draw();
      } else if (d.type === 'match' && T) {
        T.results[d.result.k] = d.result;
        T.raw.results.push(d.result);
        redraw();
      } else if (d.type === 'done' && T) {
        T.raw.status = 'done';
        T.raw.finishedAt = d.finishedAt;
        T.raw.nextAt = d.nextAt;
        view.draw();
      } else if (d.type === 'viewers') {
        viewers = d.n;
      }
      setPill();
    };
    // обратный отсчёт до следующего турнира
    const tick = setInterval(() => { if (T && T.raw.status === 'done') view.draw(); }, 1000);
    onLeave(() => clearInterval(tick));
  };

  /* ════════════════════════ ПЕСОЧНИЦА ════════════════════════ */
  Pages.sandbox = function (app, q, onLeave) {
    const kinds = [...new Set(GT.gameList().map((g) => g.kind))];
    const firstGame = (k) => GT.gameList().find((g) => g.kind === k);
    const editId = q.get('edit');
    const editing = editId && UI.customBots().find((b) => b.id === editId);
    const draft = UI.store.get('draft', null);
    const S = {
      gameId: editing ? firstGame(editing.kind).id : (GT.getGame(q.get('game')) ? q.get('game') : (draft && draft.gameId) || 'dilemma'),
      id: editing ? editing.id : null,
    };
    const kindOf = () => GT.getGame(S.gameId).kind;
    const initialCode = editing ? editing.code : draft && draft.gameId === S.gameId && draft.code ? draft.code : GT.templates[kindOf()];

    app.innerHTML = `<div class="container page">
      <div class="crumbs"><a href="#/">~</a><span>/</span><span>песочница</span></div>
      <div class="page-head"><div><h1 class="page-title">Песочница</h1>
        <p class="page-sub">Напишите свою стратегию на JavaScript, проверьте её против всех встроенных ботов и добавьте на арену и в турниры. Код хранится только в вашем браузере.</p></div></div>
      <div class="setup">
        <div class="grid" style="gap:16px">
          <div class="card card-pad">
            <div class="settings-grid" style="margin-bottom:14px">
              <div class="field"><label>игра</label><select class="input" id="sb-game">${GT.gameList().map((g) => `<option value="${g.id}" ${g.id === S.gameId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
              <div class="field"><label>имя бота</label><input class="input" id="sb-name" maxlength="40" value="${esc(editing ? editing.name : 'Мой бот')}"></div>
            </div>
            <textarea class="editor" id="sb-code" spellcheck="false">${esc(initialCode)}</textarea>
            <div class="row" style="margin-top:14px">
              <button class="btn btn-primary" id="sb-test">▶ Проверить против всех</button>
              <button class="btn" id="sb-save">💾 Сохранить бота</button>
              <button class="btn" id="sb-reset">Шаблон</button>
              <span class="spacer"></span><span class="comment" id="sb-status"></span>
            </div>
          </div>
          <div id="sb-results"></div>
        </div>
        <div class="setup-side">
          <div class="card card-pad"><div class="panel-title">Мои боты</div><div id="sb-list"></div></div>
          <div class="card card-pad"><div class="panel-title">Что есть в ctx</div>
            <div class="formula" style="font-size:12.5px">ctx.round     номер раунда (с 0)
ctx.rounds    всего раундов (null — скрыто)
ctx.my        мои прошлые ходы
ctx.opp       ходы соперника
ctx.myLast    мой прошлый ход
ctx.oppLast   прошлый ход соперника
ctx.myPay     мои выигрыши по раундам
ctx.myScore   мой счёт · oppScore
ctx.state     состояние игры (см. шаблон)
ctx.params    параметры игры
ctx.mem       память бота на матч
ctx.rng()     случайное число 0..1</div>
            <p class="comment" style="margin:10px 0 0">// код выполняется в отдельном потоке; бесконечный цикл остановится через 5 с</p></div>
        </div>
      </div>
    </div>`;

    const codeEl = $('#sb-code', app);
    const status = $('#sb-status', app);
    const saveDraft = () => UI.store.set('draft', { gameId: S.gameId, code: codeEl.value });
    codeEl.addEventListener('input', saveDraft);
    codeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = codeEl.selectionStart;
        codeEl.setRangeText('  ', s, codeEl.selectionEnd, 'end');
        saveDraft();
      }
    });
    $('#sb-game', app).onchange = (e) => {
      const prevKind = kindOf();
      S.gameId = e.target.value;
      if (kindOf() !== prevKind) { codeEl.value = GT.templates[kindOf()]; S.id = null; }
      saveDraft();
    };
    $('#sb-reset', app).onclick = () => { codeEl.value = GT.templates[kindOf()]; saveDraft(); };

    function renderList() {
      const list = UI.customBots();
      $('#sb-list', app).innerHTML = list.length ? list.map((b) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0;flex:1"><b>${esc(b.name)}</b><div class="comment">${esc(firstGame(b.kind).name)}${b.kind === 'matrix' ? ' и др.' : ''}</div></div>
          <a class="btn btn-sm" href="#/sandbox?edit=${esc(b.id)}">ред.</a><button class="btn btn-sm btn-danger" data-del="${esc(b.id)}">✕</button></div>`).join('')
        : '<div class="comment">// пока пусто — сохраните первого бота</div>';
    }
    renderList();
    $('#sb-list', app).addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      UI.saveCustomBots(UI.customBots().filter((b) => b.id !== d.dataset.del));
      if (S.id === d.dataset.del) S.id = null;
      renderList();
    });

    function check() {
      try {
        GT.compile(codeEl.value);
        return true;
      } catch (e) {
        status.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
        return false;
      }
    }

    $('#sb-save', app).onclick = () => {
      if (!check()) return;
      const name = $('#sb-name', app).value.trim() || 'Мой бот';
      const list = UI.customBots();
      const kind = kindOf();
      const existing = S.id && list.find((b) => b.id === S.id && b.kind === kind);
      if (existing) Object.assign(existing, { name, code: codeEl.value });
      else { S.id = 'my_' + Date.now().toString(36); list.push({ id: S.id, name, kind, code: codeEl.value }); }
      UI.saveCustomBots(list);
      renderList();
      status.innerHTML = '<span class="good">сохранено ✓ — бот доступен на арене и в турнирах</span>';
    };

    let job = null;
    onLeave(() => { if (job) job.cancel(); });
    $('#sb-test', app).onclick = () => {
      if (job) return;
      if (!check()) return;
      const game = GT.getGame(S.gameId);
      const name = $('#sb-name', app).value.trim() || 'Мой бот';
      const mine = { id: 'draft', code: codeEl.value };
      const opps = GT.strategies[game.kind];
      const seed = randomSeed();
      const specs = [];
      opps.forEach((o, j) => {
        specs.push({ gameId: S.gameId, a: mine, b: { id: o.id }, opts: { seed: seed + j * 2 } });
        specs.push({ gameId: S.gameId, a: { id: o.id }, b: mine, opts: { seed: seed + j * 2 + 1 } });
      });
      const res = new Array(specs.length);
      status.textContent = '⠋ играю…';
      const out = $('#sb-results', app);
      const draw = () => {
        let w = 0, d = 0, l = 0, total = 0, errs = 0, lastErr = '';
        const rows = opps.map((o, j) => {
          const r1 = res[j * 2], r2 = res[j * 2 + 1];
          const mineScore = (r1 ? r1.score[0] : 0) + (r2 ? r2.score[1] : 0);
          const theirs = (r1 ? r1.score[1] : 0) + (r2 ? r2.score[0] : 0);
          [[r1, 0], [r2, 1]].forEach(([r, p]) => {
            if (!r) return;
            if (r.winner === -1) d++; else if (r.winner === p) w++; else l++;
            if (r.errors[p]) { errs += r.errors[p]; lastErr = r.lastError[p]; }
          });
          total += mineScore;
          const verdict = !r1 || !r2 ? '' : mineScore > theirs ? '<span class="tag tag-green">выигрыш</span>' : mineScore < theirs ? '<span class="tag tag-red">проигрыш</span>' : '<span class="tag">ничья</span>';
          return `<tr class="match-row" data-j="${j}"><td><b>${esc(o.name)}</b><div class="comment">${esc(o.desc)}</div></td><td class="score-cell">${r1 && r2 ? `${GT.fmtNum(mineScore)} : ${GT.fmtNum(theirs)}` : '–'}</td><td class="center">${verdict}</td></tr>`;
        }).join('');
        out.innerHTML = `<div class="card card-pad">
          <div class="row" style="margin-bottom:12px"><div class="panel-title" style="margin:0">«${esc(name)}» против всех ботов</div><span class="spacer"></span>
            <span class="mono">${UI.wdl({ w, d, l })} · очков ${GT.fmtNum(total)}</span></div>
          ${errs ? `<div class="error-box" style="margin-bottom:12px">Стратегия упала ${errs} раз(а), вместо её хода делался случайный. Последняя ошибка: ${esc(lastErr)}</div>` : ''}
          <div class="table-wrap"><table class="table"><thead><tr><th>Соперник</th><th class="center">Ваши : его (2 матча)</th><th class="center">Итог</th></tr></thead><tbody>${rows}</tbody></table></div>
          <p class="comment" style="margin:10px 0 0">// нажмите на строку, чтобы посмотреть матч по раундам</p></div>`;
      };
      draw();
      job = UI.runner.batch(specs, {
        onResult(d) { res[d.k] = d.summary || { score: [0, 0], winner: -1, errors: [1, 0], lastError: [d.error, null] }; },
        onDone() { job = null; status.innerHTML = '<span class="good">готово ✓</span>'; draw(); },
        onFatal(err) { job = null; status.innerHTML = `<span class="bad">${esc(err)}</span>`; draw(); },
      });
      out.onclick = (e) => {
        const r = e.target.closest('[data-j]');
        if (!r) return;
        const j = Number(r.dataset.j);
        UI.openReplay(specs[j * 2], [name, opps[j].name], game.name);
      };
    };
  };
})();
