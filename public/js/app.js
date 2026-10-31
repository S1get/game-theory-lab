/*
 * Роутер (#/путь) и статичные страницы: главная, игры, страница игры, справка.
 */
(function () {
  'use strict';
  const { esc, $, $$ } = UI;
  const app = document.getElementById('app');
  let cleanup = [];
  const onLeave = (fn) => cleanup.push(fn);

  /* ─────────── Оболочка: меню, анимации, статус сервера ─────────── */
  $('#burger').onclick = () => $('#nav').classList.toggle('open');
  window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 8), { passive: true });

  const animBtn = $('#anim-toggle');
  function setAnim(on) {
    document.body.classList.toggle('no-anim', !on);
    animBtn.textContent = on ? '[x] анимации' : '[ ] анимации';
    UI.store.set('anim', on);
  }
  setAnim(UI.store.get('anim', !window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  animBtn.onclick = () => setAnim(document.body.classList.contains('no-anim'));

  async function pollServer() {
    const pill = $('#server-pill');
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const d = await r.json();
      pill.innerHTML = `<span class="dot on"></span><span>онлайн${d.viewers ? ' · ' + d.viewers + ' в эфире' : ''}</span>`;
      pill.title = `Сервер работает ${Math.round(d.uptimeSec / 60)} мин${d.keepalive.enabled ? ' · антислип включён' : ''}`;
    } catch (e) {
      pill.innerHTML = '<span class="dot"></span><span>офлайн-режим</span>';
      pill.title = 'Сервер недоступен: арена и песочница работают в браузере, эфир — нет';
    }
  }
  pollServer();
  setInterval(pollServer, 60000);

  /* ─────────── Роутер ─────────── */
  function route() {
    cleanup.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    cleanup = [];
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = new URLSearchParams(query || '');
    const page = parts[0] || '';
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    $('#nav').classList.remove('open');
    window.scrollTo(0, 0);
    const titles = { learn: 'Уроки', live: 'Эфир', tournament: 'Турниры', arena: 'Арена', games: 'Игры', sandbox: 'Песочница', help: 'Справка' };
    document.title = (titles[page] ? titles[page] + ' — ' : '') + 'GTLab — турниры по теории игр';
    switch (page) {
      case '': return home();
      case 'games': return parts[1] ? gamePage(parts[1], q) : gamesPage();
      case 'learn': return Pages.learn(app, parts[1], onLeave);
      case 'arena': return Pages.arena(app, q, onLeave);
      case 'tournament': return Pages.tournament(app, q, onLeave);
      case 'live': return Pages.live(app, q, onLeave);
      case 'sandbox': return Pages.sandbox(app, q, onLeave);
      case 'help': return helpPage();
      default: return notFound();
    }
  }
  window.addEventListener('hashchange', route);

  /* ─────────── Общие кусочки ─────────── */
  const crumbs = (...items) => `<div class="crumbs"><a href="#/">~</a>${items.map((x) => `<span>/</span>${x}`).join('')}</div>`;

  function matrixHtml(g) {
    const P = g.defaults.payoff;
    const L = g.labels;
    const short = (s) => (s.length > 8 ? s.slice(0, 5) + '.' : s);
    const cell = (a, b) => `<td class="cell" data-a="${a}" data-b="${b}"><span class="a">${P[a + b][0]}</span>, <span class="b">${P[a + b][1]}</span></td>`;
    return `<div class="card matrix-card">
      <table class="matrix"><tr><th></th><th></th><th colspan="2" class="pb">Игрок B</th></tr>
      <tr><th></th><th></th><th>${esc(L.C)}</th><th>${esc(L.D)}</th></tr>
      <tr><th rowspan="2" class="pa">Игрок A</th><th>${esc(short(L.C))}</th>${cell('C', 'C')}${cell('C', 'D')}</tr>
      <tr><th>${esc(short(L.D))}</th>${cell('D', 'C')}${cell('D', 'D')}</tr></table>
      <div class="matrix-hint" data-hint>Наведите на ячейку</div></div>`;
  }
  function bindMatrix(root, g) {
    const hint = $('[data-hint]', root);
    if (!hint) return;
    const L = g.labels;
    const P = g.defaults.payoff;
    $$('td.cell', root).forEach((td) => {
      td.addEventListener('mouseenter', () => {
        const a = td.dataset.a, b = td.dataset.b;
        hint.innerHTML = `A: <b>${esc(L[a].toLowerCase())}</b>, B: <b>${esc(L[b].toLowerCase())}</b> → A получает <span style="color:#f472b6">${P[a + b][0]}</span>, B — <span style="color:#60a5fa">${P[a + b][1]}</span>`;
      });
      td.addEventListener('mouseleave', () => { hint.textContent = 'Наведите на ячейку'; });
    });
  }

  // Примеры исходов считаются самим движком, чтобы не разойтись с правилами
  function examplesHtml(g) {
    const sim = (acts, setup) => {
      const par = Object.assign({}, g.defaults);
      const s = g.init(par, 10);
      if (setup) setup(s);
      return g.resolve(s, acts, par).payoffs;
    };
    let head, rows;
    if (g.id === 'travelers_dilemma') {
      head = ['Вы', 'Соперник', 'Ваши очки', 'Очки соперника'];
      rows = [[50, 50], [30, 70], [80, 40], [2, 2]].map((a) => [...a, ...sim(a)]);
    } else if (g.id === 'public_goods') {
      head = ['Вы вложили', 'Соперник', 'Ваши очки', 'Очки соперника'];
      rows = [[20, 20], [0, 0], [0, 20], [10, 10]].map((a) => [...a, ...sim(a)]);
    } else if (g.id === 'tug_of_war') {
      head = ['Вы потратили', 'Соперник', 'Ваши очки', 'Очки соперника'];
      rows = [[30, 20], [20, 30], [25, 25], [100, 99]].map((a) => [...a, ...sim(a)]);
    } else if (g.id === 'ultimatum') {
      head = ['Вы предлагаете', 'Порог соперника', 'Вам', 'Сопернику'];
      rows = [[50, 40], [20, 30], [10, 1], [1, 1]].map(([o, t]) => [o, t, ...sim([{ offer: o, accept: 0 }, { offer: 0, accept: t }])]);
    } else if (g.id === 'dollar_auction') {
      head = ['Ход торгов', 'Ставки', 'A', 'B'];
      rows = [
        ['A пас', '—', 0, 0],
        ['A→1, B пас', '1 vs 0', 99, 0],
        ['A→50, B→60, A→70, B пас', '70 vs 60', 30, -60],
        ['A→80, B→90, A→110, B пас', '110 vs 90', -10, -90],
      ];
    } else return '';
    return `<div class="card card-pad"><div class="panel-title">Очки за ${esc(g.unit)}</div>
      <div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i >= 2 ? 'num' : 'mono'}">${i >= 2 ? `<b>${GT.fmtNum(v)}</b>` : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }

  const sideCard = (g) => (g.kind === 'matrix' ? matrixHtml(g) : examplesHtml(g));

  /* ─────────── Главная ─────────── */
  const ROBOT = [
    '        .--.                    .--.        ',
    '        |##|                    |##|        ',
    '         \\#\\                  /#/         ',
    '  +==========================================+',
    '  |##########################################|',
    '  |######+----------+######+----------+######|',
    '  |######|   EEEE   |######|   EEEE   |######|',
    '  |######|   EEEE   |######|   EEEE   |######|',
    '  |######+----------+######+----------+######|',
    '  |##########################################|',
    '  |########::::::::::::::::::::::::::########|',
    '  |########::MMMMMMMMMMMMMMMMMMMMMM::########|',
    '  |########::::::::::::::::::::::::::########|',
    '  |##########################################|',
    '  +==========================================+',
    '        |######|              |######|      ',
    '      +=########=+          +=########=+    ',
  ];

  function home() {
    const games = GT.gameList();
    app.innerHTML = `<div class="container">
      <section class="hero">
        <div class="pixels" id="pixels"></div>
        <pre class="ascii" id="ascii" aria-hidden="true"></pre>
        <div class="hero-in">
          <span class="badge">Теория игр в действии</span>
          <h1>Сталкивайте стратегии в реальном времени</h1>
          <p class="lead">GTLab — лаборатория теории игр. Выбирайте ботов, сталкивайте их в турнирах раунд за раундом и смотрите, какая стратегия побеждает — и почему.</p>
          <div class="terminal"><div class="terminal-bar"><span class="tl"></span><span class="tl"></span><span class="tl"></span><span class="t">gtlab ~ strategy</span></div>
            <div class="terminal-body"><span class="prompt">$</span><span class="typed" id="typed"></span><span class="caret"></span></div></div>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="#/tournament">${Pages.trophy} К турнирам</a>
            <a class="btn btn-lg" href="#/games">Правила игр →</a>
          </div>
        </div>
      </section>

      <section class="section" id="live-card" style="margin-top:28px"></section>

      <section class="section">
        <h2 class="section-title">Изучайте на практике</h2>
        <p class="section-sub">12 коротких уроков — от равновесия Нэша до правил турнира как системы. В каждом — эксперименты, которые запускаются в один клик.</p>
        <div class="modes">
          ${[
            ['01', 'Игра, стратегия, выигрыш', 'basics'], ['03', 'Повторение рождает сотрудничество', 'repeated'],
            ['04', 'Ошибки и прощение', 'noise'], ['06', 'Эволюция: кто вытесняет кого', 'evolution'],
            ['10', 'Эскалация и невозвратные затраты', 'escalation'], ['12', 'Правила турнира — тоже система', 'systems'],
          ].map(([n, t, id]) => `<a class="card mode" href="#/learn/${id}"><div class="ic">${n}</div><h3>${t}</h3><p>Урок с экспериментами →</p></a>`).join('')}
        </div>
        <div style="text-align:center;margin-top:24px"><a class="btn btn-primary" href="#/learn">Все уроки и мини-игра «Угадай бота»</a></div>
      </section>

      <section class="section">
        <h2 class="section-title">Игры на платформе</h2>
        <div class="tabs" id="game-tabs">${games.map((g, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}">${esc(g.name)}</button>`).join('')}</div>
        <div id="showcase"></div>
      </section>

      <section class="section">
        <h2 class="section-title">Режимы запуска</h2>
        <p class="section-sub">Одни и те же боты ведут себя по-разному в зависимости от того, как устроено соревнование</p>
        <div class="modes">
          ${[
            ['⇄', 'Один на один', 'Два бота, одна игра. Ходы появляются раунд за раундом, рядом — график счёта.', '#/games/dilemma'],
            ['⟳', 'Круговой турнир', 'Каждый бот играет с каждым. Таблица, победы/ничьи/поражения и перекрёстная матрица.', '#/arena'],
            ['▦', 'Турнир команд', 'Несколько игр сразу: место в каждой, сумма мест, пьедестал и табло на весь экран.', '#/tournament'],
            ['∿', 'Эволюция', 'Репликаторная динамика: успешные стратегии размножаются, слабые вымирают.', '#/arena'],
            ['≈', 'Шум', 'С заданной вероятностью ход бота искажается. Кто устойчив к ошибкам, а кто срывается в войну?', '#/arena'],
            ['?', 'Скрытая длина', 'Боты не знают, когда матч закончится, — обратная индукция перестаёт работать.', '#/arena'],
            ['●', 'Эфир', 'Сервер круглосуточно гоняет турниры, и все зрители смотрят их вместе в реальном времени.', '#/live'],
            ['✎', 'Песочница', 'Напишите свою стратегию на JavaScript и выпустите её против всех.', '#/sandbox'],
          ].map(([ic, t, d, href]) => `<a class="card mode" href="${href}"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></a>`).join('')}
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Ключевые концепции</h2>
        <p class="section-sub">Теория игр — раздел математики, изучающий стратегические взаимодействия между рациональными агентами</p>
        <div class="concepts">
          ${[
            ['Равновесие Нэша', '1950', 'Состояние, при котором ни один игрок не может улучшить свой результат, изменив только свою стратегию.', 'Джон Нэш'],
            ['Оптимальность по Парето', '1896', 'Состояние, при котором невозможно улучшить положение одного игрока, не ухудшив положение другого.', 'Вильфредо Парето'],
            ['Доминирующая стратегия', 'XX век', 'Стратегия, которая приносит лучший результат независимо от действий других игроков.', 'Теория игр'],
            ['Турнир Аксельрода', '1980', 'Компьютерный турнир стратегий в повторяющейся дилемме. Победила простейшая «Око за око» — добрая, мстительная, прощающая и понятная.', 'Роберт Аксельрод'],
            ['Эволюционно стабильная стратегия', '1973', 'Стратегия, которую не может вытеснить ни одна мутация, если её уже придерживается большинство популяции.', 'Джон Мейнард Смит'],
            ['Обратная индукция', '1913', 'Решение игры с конца: если известен последний ход, можно вычислить предпоследний и так далее. Ломается, если длина игры неизвестна.', 'Эрнст Цермело'],
          ].map(([t, y, d, by]) => `<div class="card concept"><div class="concept-head"><h3>${t}</h3><span class="tag">${y}</span></div><p>${d}</p><div class="by">— ${by}</div></div>`).join('')}
        </div>
      </section>

      <section class="cta">
        <h2>Готовы проверить свою стратегию?</h2>
        <p>Соберите турнир из встроенных ботов или напишите своего — и посмотрите, кто кого.</p>
        <a class="btn btn-primary btn-lg" href="#/tournament">${Pages.trophy} Смотреть турниры</a>
      </section>
    </div>`;

    // Витрина игр
    const show = (i) => {
      const g = games[i];
      $$('#game-tabs button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
      $('#showcase').innerHTML = `<div class="games-showcase showcase c-${g.color}">
        <div>
          <h3 class="showcase-title"><span class="ic">${esc(g.icon)}</span>${esc(g.name)}</h3>
          <p>${esc(g.short)}</p>
          <ul class="rule-list">${g.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="insight"><b>Инсайт:</b> ${esc(g.insight)}</div>
          <div class="row" style="margin-top:22px"><a class="btn btn-primary" href="#/games/${g.id}">Подробнее об игре</a><a class="btn" href="#/arena?game=${g.id}">На арену →</a></div>
        </div>
        <div>${sideCard(g)}</div></div>`;
      bindMatrix($('#showcase'), g);
    };
    $('#game-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) show(Number(b.dataset.i)); });
    show(0);

    heroFx();
    liveCard();
  }

  function heroFx() {
    // Пиксельные «созвездия» на фоне
    const px = $('#pixels');
    const colors = ['#6d5bd0', '#3f8f4f', '#5a4ab8'];
    let html = '';
    const rnd = GT.rng(Date.now() & 0xffff);
    for (let c = 0; c < 16; c++) {
      const x = rnd() * 96, y = rnd() * 92;
      const col = colors[Math.floor(rnd() * colors.length)];
      const n = 3 + Math.floor(rnd() * 7);
      for (let k = 0; k < n; k++) {
        html += `<i style="left:calc(${x}% + ${Math.floor(rnd() * 6) * 9}px);top:calc(${y}% + ${Math.floor(rnd() * 4) * 9}px);background:${col};opacity:${0.35 + rnd() * 0.5};animation-delay:${(rnd() * 4).toFixed(2)}s"></i>`;
      }
    }
    px.innerHTML = html;

    // Робот: моргает, а во рту бегут ходы дилеммы заключённого
    const ascii = $('#ascii');
    const sa = GT.strategies.matrix;
    let moves = [];
    let blink = 0;
    let frame = 0;
    const pd = GT.getGame('dilemma');
    function newMatch() {
      const a = sa[Math.floor(Math.random() * sa.length)];
      const b = sa[Math.floor(Math.random() * sa.length)];
      const m = GT.runMatch(pd, a, b, { rounds: 40, seed: Math.floor(Math.random() * 1e6) });
      moves = m.hist[0].map((x, k) => x + m.hist[1][k]);
    }
    newMatch();
    function drawRobot() {
      const mouthLen = 22;
      const stream = moves.join('').padEnd(mouthLen, ' ');
      const off = frame % Math.max(1, stream.length);
      const mouth = (stream + stream).slice(off, off + mouthLen);
      const eyes = blink > 0 ? '----' : '@@@@';
      ascii.innerHTML = ROBOT.map((l) => esc(l).replace(/EEEE/g, `<b>${eyes}</b>`).replace('MMMMMMMMMMMMMMMMMMMMMM', `<b>${esc(mouth)}</b>`)).join('\n');
    }
    drawRobot();
    const tm = setInterval(() => {
      if (document.body.classList.contains('no-anim')) return;
      frame++;
      if (blink > 0) blink--;
      else if (Math.random() < 0.04) blink = 2;
      if (frame % 60 === 0) newMatch();
      drawRobot();
    }, 220);
    onLeave(() => clearInterval(tm));

    // Печатающийся терминал
    const files = ['tit_for_tat.py', 'grim_trigger.js', 'pavlov.cpp', 'generous_tft.go', 'free_rider.rs', 'detective.py', 'sunk_cost.js'];
    const el = $('#typed');
    let fi = 0, ci = 0, dir = 1, hold = 0;
    const tt = setInterval(() => {
      const word = files[fi];
      if (hold > 0) { hold--; return; }
      ci += dir;
      if (ci >= word.length) { dir = -1; hold = 14; }
      if (ci <= 0) { dir = 1; fi = (fi + 1) % files.length; hold = 3; }
      el.textContent = word.slice(0, ci);
    }, 85);
    onLeave(() => clearInterval(tt));
  }

  async function liveCard() {
    const box = $('#live-card');
    try {
      const r = await fetch('/api/live/state', { cache: 'no-store' });
      const d = await r.json();
      const t = d.tournament;
      if (!t || !box.isConnected) return;
      const played = t.results.length;
      box.innerHTML = `<a class="card live-strip" href="#/live">
        <span class="dot live"></span><span class="t">ЭФИР</span>
        <span>Турнир #${t.id} · ${t.games.map((g) => esc(GT.getGame(g).name)).join(', ')}</span>
        <span class="muted">${t.status === 'done' ? 'завершён, скоро следующий' : `сыграно ${played} из ${t.total}`} · ${t.teams.length} команд</span>
        <span class="spacer"></span><span class="btn btn-sm btn-primary">Смотреть →</span></a>`;
    } catch (e) { /* без сервера — без карточки эфира */ }
  }

  /* ─────────── Игры ─────────── */
  function gamesPage() {
    app.innerHTML = `<div class="container page">
      ${crumbs('<span>игры</span>')}
      <h1 class="page-title">Доступные игры</h1>
      <p class="page-sub">Список игр, в которые можно играть на платформе GTLab</p>
      <div class="games-grid" style="margin-top:34px">
        ${GT.gameList().map((g) => `<a class="game-card c-${g.color}" href="#/games/${g.id}">
          <div class="game-card-head"><h3>${esc(g.name)}</h3><span class="icon-tile">${esc(g.icon)}</span></div>
          <span class="code-tag">${g.id}</span>
          <p>${esc(g.short)}</p>
          <span class="more">Подробнее</span></a>`).join('')}
      </div></div>`;
  }

  function gamePage(id, q) {
    const g = GT.getGame(id);
    if (!g) return notFound();
    const bots = UI.botsFor(id);
    // Пресет дуэли из ссылки (уроки): ?a=…&b=…&rounds=…&noise=…&hidden=1&run=1
    const pick = (key, def) => bots.find((b) => b.id === q.get(key)) || def;
    const firstTwo = [pick('a', bots.find((b) => b.id === 'tit_for_tat') || bots[0]), pick('b', bots.find((b) => b.id === 'always_d') || bots[1])];
    const lesson = q.get('lesson');
    const actionHelp = {
      matrix: "'C' или 'D'",
      travelers: 'целое число от 2 до 100',
      public_goods: 'вклад от 0 до 20',
      tug_of_war: 'сколько энергии потратить (0…остаток)',
      ultimatum: '{ offer, accept }',
      dollar_auction: 'новая ставка (больше ставки соперника) или 0 — пас',
    }[g.kind];
    app.innerHTML = `<div class="container page c-${g.color}">
      ${crumbs('<a href="#/games">игры</a>', `<span>${esc(g.name.toLowerCase().replace(/ /g, '-'))}</span>`)}
      ${lesson ? `<a class="btn btn-sm" href="#/learn/${esc(lesson)}" style="margin-bottom:14px">← вернуться к уроку</a>` : ''}
      <div class="row" style="gap:16px;margin-bottom:8px"><span class="icon-tile">${esc(g.icon)}</span>
        <div><h1 class="page-title">${esc(g.name)}</h1><span class="code-tag" style="margin-top:8px">${g.id}</span></div></div>

      <div class="games-showcase showcase">
        <div>
          <h2 style="font-size:22px;margin-bottom:12px">Правила игры</h2>
          <p>${esc(g.short)}</p>
          <ul class="rule-list">${g.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="insight"><b>Инсайт:</b> ${esc(g.insight)}</div>
          ${g.id === 'dilemma' ? '<div class="insight" style="margin-top:12px"><b>Особенность матрицы 5/10/1/0:</b> здесь 2·5 = 10 + 0, поэтому поочерёдно «доить» соперника так же выгодно, как сотрудничать. Обычно в дилемме требуют 2R &gt; T + S — сравните результаты «Чередующего» на арене.</div>' : ''}
        </div>
        <div>${sideCard(g)}</div>
      </div>

      <section class="section" style="margin-top:56px">
        <div class="card card-pad">
          <div class="panel-title">Матч один на один <span class="comment">// выберите двух ботов и смотрите игру раунд за раундом</span></div>
          <div class="settings-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            <div class="field"><label>игрок A</label><select class="input" id="d-a">${bots.map((b) => `<option value="${esc(b.id)}" ${b === firstTwo[0] ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
            <div class="field"><label>игрок B</label><select class="input" id="d-b">${bots.map((b) => `<option value="${esc(b.id)}" ${b === firstTwo[1] ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
            <div class="field"><label>${g.unit === 'аукцион' ? 'аукционов' : 'раундов'}</label><input class="input" type="number" id="d-rounds" min="1" max="2000" value="${Number(q.get('rounds')) || Math.min(g.defaults.rounds, 60)}"></div>
            <div class="field"><label>шум</label><select class="input" id="d-noise">${[['0', 'без шума'], ['0.05', '5%'], ['0.1', '10%']].map(([v, t]) => `<option value="${v}" ${q.get('noise') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
          <div class="row" style="margin-top:14px"><label class="check"><input type="checkbox" id="d-hidden" ${q.get('hidden') === '1' ? 'checked' : ''}> скрытая длина</label><span class="spacer"></span>
            <button class="btn btn-primary" id="d-run">▶ Запустить матч</button></div>
          <div id="duel" style="margin-top:22px"></div>
        </div>
      </section>

      <section class="section" style="margin-top:40px">
        <div class="row" style="margin-bottom:16px"><h2 style="font-size:22px">Боты <span class="comment">[${bots.length}]</span></h2><span class="spacer"></span><a class="btn" href="#/arena?game=${g.id}">Все против всех на арене →</a></div>
        <div class="bots-grid">${bots.map((b) => `<div class="bot"><h4>${b.tag ? `<span class="tag">${esc(b.tag)}</span>` : ''}${b.custom ? '<span class="tag tag-purple">ваш</span>' : ''}${esc(b.name)}</h4><p>${esc(b.desc)}</p></div>`).join('')}</div>
      </section>

      <section class="section" style="margin-top:40px">
        <h2 style="font-size:22px;margin-bottom:12px">Своя стратегия</h2>
        <p class="muted">Функция <code class="mono">play(ctx)</code> вызывается каждый ход и возвращает ${esc(actionHelp)}. Пример:</p>
        <pre class="formula">${esc(GT.templates[g.kind])}</pre>
        <a class="btn btn-primary" style="margin-top:14px" href="#/sandbox?game=${g.id}">Открыть в песочнице</a>
      </section>
    </div>`;
    bindMatrix(app, g);

    let destroy = null;
    onLeave(() => { if (destroy) destroy(); });
    $('#d-run').onclick = async () => {
      const a = bots.find((b) => b.id === $('#d-a').value);
      const b = bots.find((x) => x.id === $('#d-b').value);
      const spec = {
        gameId: g.id, a: UI.ref(a), b: UI.ref(b),
        opts: { seed: Math.floor(Math.random() * 1e9), rounds: Math.min(2000, Math.max(1, Number($('#d-rounds').value) || 10)), noise: Number($('#d-noise').value), hidden: $('#d-hidden').checked },
      };
      const box = $('#duel');
      box.innerHTML = '<div class="empty">⠋ считаю матч…</div>';
      try {
        const match = await UI.replayRunner.full(spec);
        if (destroy) destroy();
        destroy = UI.mountReplay(box, g, [a.name, b.name], match);
      } catch (e) {
        box.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      }
    };
    if (q.get('run') === '1') {
      $('#d-run').click();
      setTimeout(() => $('#duel').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }

  /* ─────────── Справка ─────────── */
  function helpPage() {
    app.innerHTML = `<div class="container page"><div class="doc">
      ${crumbs('<span>справка</span>')}
      <h1 class="page-title">Справка</h1>
      <p class="page-sub">Как устроена платформа и как написать свою стратегию.</p>

      <h2>Как это работает</h2>
      <p>Каждая игра — двухсторонняя и повторяющаяся: два бота играют много раундов подряд и видят всю историю. Матч — серия раундов, турнир — серия матчей. Все матчи считаются прямо в вашем браузере в отдельном потоке, поэтому арена и песочница работают даже без сервера. «Эфир» — общий турнир, который круглосуточно идёт на сервере.</p>
      <ul>
        <li><b>Арена</b> — одна игра, выбранные боты, круговой турнир «каждый с каждым», перекрёстная таблица и эволюция.</li>
        <li><b>Турниры</b> — команды играют сразу в несколько игр. Место в каждой игре — по сумме очков, итоговое место — по сумме мест (меньше — лучше), при равенстве — по числу первых мест и победам.</li>
        <li><b>Матч по раундам</b> — нажмите на любой матч в списке, чтобы пересчитать его и посмотреть каждый ход. Результат детерминирован: один и тот же seed даёт тот же матч.</li>
      </ul>

      <h2>Режимы</h2>
      <ul>
        <li><b>Шум</b> — с вероятностью p действие бота заменяется: в матричных играх C↔D, в остальных — на случайное. Хорошая проверка «доброты»: злопамятные стратегии от одной ошибки скатываются в вечную войну.</li>
        <li><b>Скрытая длина</b> — <code>ctx.rounds</code> равно <code>null</code>, а матч обрывается случайно (в среднем через заданное число раундов). Так бот не может «предать в последнем раунде».</li>
        <li><b>Эволюция</b> — репликаторная динамика по перекрёстной таблице: доля стратегии в следующем поколении пропорциональна её среднему выигрышу против текущей популяции.</li>
      </ul>

      <h2>Своя стратегия</h2>
      <p>В <a href="#/sandbox" style="color:var(--primary)">песочнице</a> напишите функцию <code>play(ctx)</code>. Она вызывается в каждом раунде и возвращает ход:</p>
      <pre><code>function play(ctx) {
  // ctx.round, ctx.rounds, ctx.my, ctx.opp, ctx.myLast, ctx.oppLast,
  // ctx.myScore, ctx.oppScore, ctx.state, ctx.params, ctx.mem, ctx.rng()
  if (ctx.round === 0) return 'C';
  return ctx.oppLast;            // «око за око»
}</code></pre>
      <div class="table-wrap"><table class="table"><thead><tr><th>Игра</th><th>Что вернуть</th><th>ctx.state</th></tr></thead><tbody>
        <tr><td>Дилемма, Олень, Ястреб-голубь</td><td><code>'C'</code> или <code>'D'</code></td><td>—</td></tr>
        <tr><td>Дилемма путешественника</td><td>число 2…100</td><td>—</td></tr>
        <tr><td>Общественное благо</td><td>вклад 0…20</td><td>—</td></tr>
        <tr><td>Перетягивание каната</td><td>трата энергии</td><td><code>myEnergy, oppEnergy, pos, regen</code></td></tr>
        <tr><td>Ультиматум</td><td><code>{ offer, accept }</code></td><td><code>iAmProposer, pie, deals</code></td></tr>
        <tr><td>Аукцион двойной цены</td><td>ставка или <code>0</code> (пас)</td><td><code>myBid, oppBid, prize, cap, history</code></td></tr>
      </tbody></table></div>
      <p>Если функция бросит исключение или вернёт мусор, вместо её хода будет сделан случайный, а матч будет помечен «сбои бота». Бесконечный цикл остановится через 5 секунд.</p>

      <h2>Конфиденциальность</h2>
      <p>Ваши боты и команды хранятся только в localStorage вашего браузера и никуда не отправляются. Сайт закрыт от поисковых систем.</p>
    </div></div>`;
  }

  function notFound() {
    app.innerHTML = `<div class="container page"><div class="empty" style="padding:120px 0"><h1 style="font-size:64px">404</h1><p>Такой страницы нет. <a href="#/" style="color:var(--primary)">На главную</a></p></div></div>`;
  }

  route();
})();
