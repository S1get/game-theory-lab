/*
 * Общие компоненты интерфейса: хранилище, запуск матчей в воркере,
 * просмотр матча раунд за раундом, таблицы, пьедестал, табло, графики.
 */
(function () {
  'use strict';
  const UI = (window.UI = {});

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  UI.esc = esc;
  UI.$ = (sel, root) => (root || document).querySelector(sel);
  UI.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  UI.fmt = (x, d) => GT.fmtNum(x, d);

  UI.PALETTE = ['#a78bfa', '#4ade80', '#f472b6', '#60a5fa', '#facc15', '#fb923c', '#2dd4bf', '#f87171', '#c084fc', '#a3e635', '#38bdf8', '#e879f9', '#fbbf24', '#94a3b8', '#34d399', '#fda4af', '#818cf8', '#bef264'];
  UI.color = (i) => UI.PALETTE[i % UI.PALETTE.length];

  UI.toast = function (text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  /* ─────────── Хранилище (только в браузере пользователя) ─────────── */
  UI.store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('gtlab.' + key);
        return v ? JSON.parse(v) : def;
      } catch (e) { return def; }
    },
    set(key, v) {
      try { localStorage.setItem('gtlab.' + key, JSON.stringify(v)); } catch (e) { /* приватный режим */ }
    },
  };
  UI.customBots = () => UI.store.get('bots', []);
  UI.saveCustomBots = (list) => UI.store.set('bots', list);
  UI.customTeams = () => UI.store.get('teams', []);
  UI.saveCustomTeams = (list) => UI.store.set('teams', list);

  // Все боты игры: встроенные + сохранённые в песочнице
  UI.botsFor = function (gameId) {
    const g = GT.getGame(gameId);
    const builtin = GT.strategies[g.kind].map((s) => ({ id: s.id, name: s.name, desc: s.desc, tag: s.tag }));
    const custom = UI.customBots().filter((b) => b.kind === g.kind)
      .map((b) => ({ id: b.id, name: b.name, desc: 'Ваша стратегия из песочницы', custom: true, code: b.code }));
    return builtin.concat(custom);
  };
  UI.botsForKind = function (kind) {
    const g = GT.gameList().find((x) => x.kind === kind);
    return UI.botsFor(g.id);
  };
  UI.ref = (bot) => (bot.custom ? { id: bot.id, code: bot.code } : { id: bot.id });
  UI.allTeams = () => GT.teams.map((t) => Object.assign({ preset: true }, t)).concat(UI.customTeams());
  UI.teamBot = function (team, kind) {
    const id = team.bots[kind];
    return UI.botsForKind(kind).find((b) => b.id === id) || UI.botsForKind(kind)[0];
  };

  /* ─────────── Запуск матчей в Web Worker ─────────── */
  class Runner {
    constructor() {
      this.worker = null;
      this.job = 0;
      this.handlers = new Map();
      this.lastMsg = 0;
      this.timer = null;
      this.limit = 5000;
    }
    ensure() {
      if (this.worker) return this.worker;
      this.worker = new Worker('/js/worker.js');
      this.worker.onmessage = (e) => {
        this.lastMsg = Date.now();
        const h = this.handlers.get(e.data.jobId);
        if (h) h(e.data);
      };
      this.worker.onerror = (e) => { e.preventDefault(); this.fail(e.message || 'Ошибка в воркере'); };
      return this.worker;
    }
    fail(reason) {
      const hs = Array.from(this.handlers.values());
      this.kill();
      hs.forEach((h) => h({ type: 'fatal', error: reason }));
    }
    kill() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.handlers.clear();
      clearInterval(this.timer);
      this.timer = null;
    }
    // Если воркер долго молчит — в пользовательской стратегии, скорее всего, бесконечный цикл
    watch(limit) {
      this.limit = limit;
      this.lastMsg = Date.now();
      if (this.timer) return;
      this.timer = setInterval(() => {
        if (!this.handlers.size) { clearInterval(this.timer); this.timer = null; return; }
        if (Date.now() - this.lastMsg > this.limit) {
          this.fail(`Стратегия не ответила за ${Math.round(this.limit / 1000)} с — похоже на бесконечный цикл.`);
        }
      }, 400);
    }
    batch(specs, o) {
      const w = this.ensure();
      const id = ++this.job;
      this.handlers.set(id, (d) => {
        if (d.type === 'result') o.onResult(d);
        else if (d.type === 'done') { this.handlers.delete(id); if (o.onDone) o.onDone(); }
        else if (d.type === 'fatal' && o.onFatal) o.onFatal(d.error);
      });
      this.watch(5000 + (o.delay || 0));
      w.postMessage({ type: 'batch', jobId: id, specs, delay: o.delay || 0 });
      return { cancel: () => { if (this.handlers.has(id)) this.kill(); } };
    }
    full(spec) {
      return new Promise((resolve, reject) => {
        const w = this.ensure();
        const id = ++this.job;
        this.handlers.set(id, (d) => {
          this.handlers.delete(id);
          if (d.type === 'fatal' || d.error) reject(new Error(d.error));
          else resolve(d.match);
        });
        this.watch(5000);
        w.postMessage({ type: 'full', jobId: id, spec });
      });
    }
  }
  UI.Runner = Runner;
  UI.runner = new Runner();
  UI.replayRunner = new Runner();

  /* ─────────── Графики на canvas ─────────── */
  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 220;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Линии накопленного счёта
  UI.lineChart = function (canvas, series, colors, xMax) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pad = { l: 46, r: 12, t: 10, b: 22 };
    let lo = 0, hi = 1;
    series.forEach((s) => s.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    const X = (i) => pad.l + (i / Math.max(1, xMax)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#646b82';
    ctx.strokeStyle = '#1e2234';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4;
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(GT.fmtNum(Math.round(v)), 4, y + 4);
    }
    ctx.fillText('0', pad.l, h - 6);
    ctx.fillText(String(xMax), w - pad.r - 24, h - 6);
    if (lo < 0) {
      ctx.strokeStyle = '#3a4060';
      ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke();
    }
    series.forEach((s, i) => {
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      s.forEach((v, k) => ctx.lineTo(X(k + 1), Y(v)));
      ctx.stroke();
    });
  };

  // Доли стратегий в популяции по поколениям
  UI.areaChart = function (canvas, series, colors) {
    const { ctx, w, h } = setupCanvas(canvas);
    const pad = { l: 34, r: 8, t: 8, b: 20 };
    const n = series[0].length;
    const G = series.length - 1;
    const X = (g) => pad.l + (g / G) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v) * (h - pad.t - pad.b);
    const base = new Array(series.length).fill(0);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      series.forEach((x, g) => ctx.lineTo(X(g), Y(base[g] + x[i])));
      for (let g = G; g >= 0; g--) ctx.lineTo(X(g), Y(base[g]));
      ctx.closePath();
      ctx.fill();
      series.forEach((x, g) => { base[g] += x[i]; });
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#646b82';
    ['100%', '50%', '0%'].forEach((t, k) => ctx.fillText(t, 0, Y(1 - k / 2) + 4));
    ctx.fillText('поколение ' + G, w - pad.r - 92, h - 4);
  };

  /* ─────────── Сетка матча и просмотр раунд за раундом ─────────── */
  function cellHtml(c) {
    if (!c) return '<span class="cellx ghost"></span>';
    let style = '';
    let cls = 'cellx';
    if (c.cls) cls += ' ' + c.cls;
    else if (c.t != null) style = `background:hsl(262 ${40 + c.t * 45}% ${16 + c.t * 44}%)`;
    if (c.dim) cls += ' dimc';
    return `<span class="${cls}" style="${style}" title="${esc(c.text)}">${esc(c.text)}</span>`;
  }
  UI.cellHtml = cellHtml;

  UI.mountReplay = function (root, game, names, match) {
    const units = match.units;
    const n = units.length;
    const big = n <= 40;
    const err = [0, 1].filter((p) => match.errors[p]).map((p) =>
      `<div class="error-box">Стратегия «${esc(names[p])}» упала ${match.errors[p]} раз(а) — вместо её хода делался случайный. Последняя ошибка: ${esc(match.lastError[p])}</div>`).join('');
    root.innerHTML = `
      <div class="duel">
        <div class="duel-score">
          <div class="side a"><span class="label">игрок A</span><span class="nm">${esc(names[0])}</span></div>
          <div class="big"><span data-s="0">0</span><span class="sep">:</span><span data-s="1">0</span></div>
          <div class="side b"><span class="label">игрок B</span><span class="nm">${esc(names[1])}</span></div>
        </div>
        ${err}
        <div class="duel-controls">
          <button class="btn btn-sm btn-mono" data-play>⏸ пауза</button>
          <button class="btn btn-sm btn-mono" data-restart>⟲ заново</button>
          <div class="btn-group" data-speed>
            <button data-v="3">1×</button><button data-v="12" class="on">4×</button><button data-v="50">16×</button><button data-v="0">⏭ итог</button>
          </div>
          <span class="spacer"></span>
          <span class="comment" data-prog></span>
        </div>
        <div class="strip-wrap"><div class="strip ${big ? 'big' : ''}" data-strip></div></div>
        <canvas class="chart" data-chart></canvas>
        <div class="legend"><span><i style="background:#f472b6"></i>${esc(names[0])}</span><span><i style="background:#60a5fa"></i>${esc(names[1])}</span>
          <span class="dim">· зелёный — выиграл раунд / сотрудничал, красный — проиграл / предал${match.hidden ? ' · длина матча была скрыта от ботов' : ''}</span></div>
        <div class="log" data-log></div>
      </div>`;

    const strip = root.querySelector('[data-strip]');
    const log = root.querySelector('[data-log]');
    const chart = root.querySelector('[data-chart]');
    const prog = root.querySelector('[data-prog]');
    const sEl = [root.querySelector('[data-s="0"]'), root.querySelector('[data-s="1"]')];
    const playBtn = root.querySelector('[data-play]');
    const unitName = game.unit === 'аукцион' ? 'аукцион' : 'раунд';
    let k = 0, acc = 0, speed = 12, playing = true, prev = 0;
    const cum = [[], []];
    const total = [0, 0];

    function reset() {
      k = 0; acc = 0; cum[0] = []; cum[1] = []; total[0] = total[1] = 0;
      strip.innerHTML = '<span class="lbl a">A</span><span class="lbl b">B</span><span></span>';
      log.innerHTML = '';
      draw();
    }
    function add() {
      const u = units[k];
      for (const p of [0, 1]) { total[p] += u.pay[p]; cum[p].push(total[p]); }
      strip.insertAdjacentHTML('beforeend', cellHtml(u.c[0]) + cellHtml(u.c[1]) +
        `<span class="rn">${big || (k + 1) % 10 === 0 ? k + 1 : ''}</span>`);
      const line = document.createElement('div');
      line.innerHTML = `<span class="r">${unitName} ${String(k + 1).padStart(3, ' ')}</span>  <span class="a">A: ${esc(u.c[0].text)}</span>  <span class="b">B: ${esc(u.c[1].text)}</span>  → ${GT.fmtNum(u.pay[0])} : ${GT.fmtNum(u.pay[1])}`;
      log.prepend(line);
      while (log.childElementCount > 60) log.lastChild.remove();
      k++;
    }
    function draw() {
      sEl[0].textContent = GT.fmtNum(total[0]);
      sEl[1].textContent = GT.fmtNum(total[1]);
      prog.textContent = `${unitName} ${k} / ${n}`;
      UI.lineChart(chart, cum, ['#f472b6', '#60a5fa'], n);
      if (k >= n) { playBtn.textContent = '▶ ещё раз'; playing = false; }
    }
    function tick() {
      const t = performance.now();
      const dt = prev ? Math.min(1, (t - prev) / 1000) : 0;
      prev = t;
      if (playing && k < n) {
        if (speed === 0) { while (k < n) add(); }
        else {
          acc += dt * speed;
          let added = 0;
          while (acc >= 1 && k < n) { add(); acc -= 1; added++; }
          if (k === 0 && !added) { add(); }
        }
        draw();
        strip.parentElement.scrollLeft = strip.parentElement.scrollWidth;
      }
    }
    playBtn.onclick = () => {
      if (k >= n) { reset(); playing = true; playBtn.textContent = '⏸ пауза'; return; }
      playing = !playing;
      playBtn.textContent = playing ? '⏸ пауза' : '▶ играть';
    };
    root.querySelector('[data-restart]').onclick = () => { reset(); playing = true; playBtn.textContent = '⏸ пауза'; };
    root.querySelectorAll('[data-speed] button').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('[data-speed] button').forEach((x) => x.classList.toggle('on', x === b));
        speed = Number(b.dataset.v);
        if (!playing && k < n) { playing = true; playBtn.textContent = '⏸ пауза'; }
      };
    });
    reset();
    // Таймер, а не requestAnimationFrame: в фоновой вкладке матч тоже доигрывается
    const timer = setInterval(tick, 40);
    return () => clearInterval(timer);
  };

  // Модальное окно с повтором конкретного матча
  UI.openReplay = async function (spec, names, title) {
    const game = GT.getGame(spec.gameId);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-head"><div class="row"><span class="icon-tile sm c-${game.color}">${esc(game.icon)}</span>
        <div><b>${esc(title || game.name)}</b><div class="comment">${esc(names[0])} vs ${esc(names[1])} · seed ${spec.opts.seed}${spec.opts.noise ? ' · шум ' + Math.round(spec.opts.noise * 100) + '%' : ''}</div></div></div>
        <button class="btn btn-sm" data-close>✕ закрыть</button></div>
      <div class="modal-body"><div class="empty">⠋ пересчитываю матч…</div></div></div>`;
    document.body.appendChild(modal);
    let destroy = null;
    const close = () => { if (destroy) destroy(); modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
    try {
      const match = await UI.replayRunner.full(spec);
      if (!modal.isConnected) return;
      destroy = UI.mountReplay(modal.querySelector('.modal-body'), game, names, match);
    } catch (e) {
      modal.querySelector('.modal-body').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };

  /* ─────────── Таблицы ─────────── */
  const placeBadge = (p) => `<span class="place ${p <= 3 ? 'p' + p : ''}">${p}</span>`;
  const wdl = (r) => `<span class="wdl"><span class="w">${r.w}</span>/<span class="d">${r.d}</span>/<span class="l">${r.l}</span></span>`;
  UI.wdl = wdl;

  // Одна игра: место, бот, очки, среднее за раунд, W/D/L
  UI.singleTable = function (names, standings, opts) {
    opts = opts || {};
    const rows = standings.rows.slice().sort((a, b) => a.place - b.place || a.i - b.i);
    const max = Math.max(1e-9, ...rows.map((r) => r.total));
    const min = Math.min(0, ...rows.map((r) => r.total));
    return `<div class="table-wrap"><table class="table lb">
      <thead><tr><th style="width:70px">Место</th><th>Бот</th><th class="num">Очки</th><th class="num">За ${esc(opts.unit || 'раунд')}</th><th class="center">W / D / L</th><th style="width:22%"></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.place === 1 && r.matches ? 'top1' : ''} ${opts.flash && opts.flash.has(r.i) ? 'flash' : ''}">
        <td>${placeBadge(r.place)}</td>
        <td class="team">${esc(names[r.i])}${opts.custom && opts.custom.has(r.i) ? ' <span class="tag tag-purple">ваш</span>' : ''}</td>
        <td class="num">${GT.fmtNum(r.total)}</td>
        <td class="num">${GT.fmtNum(r.perUnit, 2)}</td>
        <td class="center mono">${wdl(r)}</td>
        <td><div class="bar"><i style="width:${Math.max(0, ((r.total - min) / (max - min || 1)) * 100)}%"></i></div></td>
      </tr>`).join('')}</tbody></table></div>`;
  };

  // Несколько игр: место в каждой игре и сумма мест
  UI.multiTable = function (names, gameIds, overall, opts) {
    opts = opts || {};
    return `<div class="table-wrap"><table class="table lb">
      <thead><tr><th style="width:70px">Место</th><th>Команда</th>${gameIds.map((g) => `<th class="center">${esc(GT.getGame(g).name)}</th>`).join('')}<th class="num">Сумма мест</th></tr></thead>
      <tbody>${overall.map((r) => `<tr class="${r.place === 1 ? 'top1' : ''} ${opts.mine && opts.mine.has(r.i) ? 'mine' : ''}">
        <td>${placeBadge(r.place)}</td>
        <td class="team">${esc(names[r.i])}${opts.mine && opts.mine.has(r.i) ? ' <span class="comment">&gt; ваша</span>' : ''}</td>
        ${gameIds.map((g) => {
          const x = r.places[g];
          if (!x || !x.matches) return '<td class="center dim">–</td>';
          return `<td><div class="gplace">${x.place}</div><div class="gsub">${GT.fmtNum(x.total)} · ${wdl(x)}</div></td>`;
        }).join('')}
        <td class="sum">${r.sum}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="comment" style="margin-top:10px">// место — по сумме мест в играх, чем меньше, тем выше; место в игре — по её очкам; W/D/L — победы, ничьи, поражения в матчах</p>`;
  };

  UI.podium = function (names, overall, title) {
    const top = overall.slice(0, 3);
    if (top.length < 3) return '';
    const order = [top[1], top[0], top[2]];
    const cls = ['s2', 's1', 's3'];
    return `<div class="podium-card"><h3>${esc(title || 'Победители турнира')}</h3><div class="muted" style="margin-top:6px">Поздравляем финалистов!</div>
      <div class="podium">${order.map((r, k) => `<div class="step ${cls[k]}"><div class="who">${esc(names[r.i])}</div>
        <div class="val">${r.sum}</div><div class="cap">сумма мест · ${r.w}W / ${r.l}L</div><div class="blk">${r.place}</div></div>`).join('')}</div></div>`;
  };

  UI.highlightsHtml = function (list) {
    if (!list.length) return '<div class="empty">Сюжеты появятся, когда сыграют матчи</div>';
    return `<div class="highlights">${list.map((h) => `<div><div class="h-title">${esc(h.title)}</div><p>${esc(h.text)}</p></div>`).join('')}</div>`;
  };

  // Перекрёстная таблица: средний выигрыш строки против столбца
  UI.heatmap = function (names, matrix) {
    let lo = Infinity, hi = -Infinity;
    matrix.forEach((r) => r.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const color = (v) => {
      if (v == null) return 'background:#151827';
      const t = (v - lo) / (hi - lo || 1);
      return `background:hsl(${t * 130} 65% ${22 + t * 18}%)`;
    };
    const short = (s) => (s.length > 14 ? s.slice(0, 13) + '…' : s);
    return `<div style="overflow-x:auto"><table class="heat"><thead><tr><th></th>${names.map((n) => `<th class="rot" title="${esc(n)}">${esc(short(n))}</th>`).join('')}</tr></thead>
      <tbody>${matrix.map((row, i) => `<tr><th style="text-align:right" title="${esc(names[i])}">${esc(short(names[i]))}</th>${row.map((v, j) =>
        `<td style="${color(v)}" title="${esc(names[i])} против ${esc(names[j])}: ${v == null ? '—' : v.toFixed(2)}">${v == null ? '' : GT.fmtNum(v, Math.abs(v) >= 10 ? 0 : 1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="comment">// строка — чей выигрыш, столбец — против кого; среднее очков за раунд</p>`;
  };

  /*
   * Список «Матчи по раундам». groups: [{ key, title, tag, items: [{ k, a, b, res }] }]
   * res: undefined — ещё не сыгран, { error } — ошибка, иначе сводка матча.
   */
  UI.roundsHtml = function (groups, names, open) {
    return `<div class="rounds">${groups.map((g, gi) => {
      const done = g.items.filter((x) => x.res).length;
      const errs = g.items.filter((x) => x.res && (x.res.error || (x.res.errors && (x.res.errors[0] || x.res.errors[1])))).length;
      const pct = g.items.length ? Math.round((done / g.items.length) * 100) : 0;
      const state = done === g.items.length ? 'done' : done ? 'running' : 'pending';
      const w1 = g.items.filter((x) => x.res && x.res.winner === 0).length;
      const w2 = g.items.filter((x) => x.res && x.res.winner === 1).length;
      const dr = g.items.filter((x) => x.res && x.res.winner === -1).length;
      const isOpen = open.has(g.key);
      return `<div class="round ${state === 'done' ? '' : state} ${errs ? 'has-err' : ''} ${isOpen ? 'open' : ''}" data-group="${esc(g.key)}">
        <div class="round-head" data-toggle="${esc(g.key)}">
          <span class="chev">›</span><b>${esc(g.title)}</b>${g.tag ? `<span class="tag tag-purple">${esc(g.tag)}</span>` : ''}
          <span class="meta">${g.items.length} матчей</span><span class="spacer"></span>
          ${done ? `<span class="tag tag-green">${done} сыграно</span>` : ''}${errs ? `<span class="tag tag-red">${errs} с ошибками</span>` : ''}
          <div class="progress"><i style="width:${pct}%"></i></div><span class="pct">${pct}%</span>
        </div>
        ${isOpen ? `<div class="round-body">
          <div class="round-stats"><span>Побед P1: <b class="good">${w1}</b></span><span>Побед P2: <b style="color:#60a5fa">${w2}</b></span><span>Ничьих: <b>${dr}</b></span><span class="dim">· нажмите на матч, чтобы посмотреть его по раундам</span></div>
          <table class="table"><thead><tr><th style="width:120px">Статус</th><th>Игрок 1</th><th class="center" style="width:160px">Счёт</th><th>Игрок 2</th></tr></thead><tbody>
          ${g.items.map((x) => {
            const r = x.res;
            const status = !r ? '<span class="tag">ожидает</span>' : r.error ? '<span class="tag tag-red">ошибка</span>'
              : (r.errors && (r.errors[0] || r.errors[1])) ? '<span class="tag tag-red">сбои бота</span>' : '<span class="tag tag-green">● сыгран</span>';
            const sc = !r || r.error ? '<span class="dim">–</span>'
              : `<span class="${r.winner === 0 ? 'w' : ''}">${GT.fmtNum(r.score[0])}</span> <span class="dim">:</span> <span class="${r.winner === 1 ? 'w' : ''}">${GT.fmtNum(r.score[1])}</span>`;
            return `<tr class="match-row" data-match="${x.k}"><td>${status}</td><td>${esc(names[x.a])}</td><td class="score-cell">${sc}</td><td>${esc(names[x.b])}</td></tr>`;
          }).join('')}
          </tbody></table></div>` : ''}
      </div>`;
    }).join('')}</div>`;
  };

  /* ─────────── Многоигровой турнир: подсчёт ─────────── */
  // T: { games:[gameId], names:[...], results:[{ gameId, a, b, score, avg, winner, units }] }
  UI.computeTournament = function (T) {
    const n = T.names.length;
    const ok = T.results.filter((r) => r && !r.error);
    const perGame = T.games.map((gameId) => ({
      gameId,
      standings: GT.standings(n, ok.filter((r) => r.gameId === gameId)),
      played: T.results.filter((r) => r && r.gameId === gameId).length,
      total: T.perGameTotal,
    }));
    const overall = GT.overall(n, perGame.filter((g) => g.played > 0));
    const gameNames = {};
    T.games.forEach((g) => { gameNames[g] = GT.getGame(g).name; });
    const highlights = ok.length ? GT.highlights(T.names, gameNames, overall, perGame, ok) : [];
    return { perGame, overall, highlights };
  };

  /* ─────────── Табло на весь экран ─────────── */
  UI.openBoard = function (getData) {
    const el = document.createElement('div');
    el.className = 'board';
    const close = document.createElement('button');
    close.className = 'btn btn-sm board-close';
    close.textContent = '✕ Esc';
    let prevPlaces = new Map();
    let lastPlaces = new Map();
    let ago = Date.now();
    function render() {
      const d = getData();
      if (!d) return;
      const { T, comp } = d;
      const curPlaces = new Map(comp.overall.map((r) => [r.i, r.place]));
      if ([...curPlaces].some(([i, p]) => lastPlaces.get(i) !== p)) { prevPlaces = lastPlaces; lastPlaces = curPlaces; ago = Date.now(); }
      const finished = comp.perGame.filter((g) => g.played >= g.total && g.total);
      const lastDone = finished[finished.length - 1];
      let ticker;
      if (lastDone) {
        const top = lastDone.standings.rows.slice().sort((a, b) => a.place - b.place).slice(0, 3);
        ticker = `итог: игра «${GT.getGame(lastDone.gameId).name}» завершена · ${top.map((r, k) => `${k + 1}. ${T.names[r.i]} ${GT.fmtNum(r.total)}`).join(' · ')}`;
      } else {
        const cur = comp.perGame.find((g) => g.played < g.total) || comp.perGame[0];
        ticker = `идёт игра «${GT.getGame(cur.gameId).name}» · сыграно ${cur.played}/${cur.total}`;
      }
      const lastRes = T.results.filter(Boolean).slice(-1)[0];
      const tail = lastRes ? `${T.names[lastRes.a]} ${GT.fmtNum(lastRes.score[0])} : ${GT.fmtNum(lastRes.score[1])} ${T.names[lastRes.b]} · ${GT.getGame(lastRes.gameId).name}` : 'результаты появятся, когда пойдут матчи';
      const secs = Math.round((Date.now() - ago) / 1000);
      el.innerHTML = `
        <div class="board-ticker">${esc(ticker)}</div>
        <h1>${esc(T.title)}</h1>
        <div class="board-status">
          ${d.status ? `<span class="gp"><span class="dot ${d.live ? 'live' : 'on'}"></span>${esc(d.status)}</span><span class="sep">|</span>` : ''}
          ${comp.perGame.map((g) => `<span class="gp" style="color:${g.played >= g.total ? 'var(--text)' : 'var(--primary)'}">● ${esc(GT.getGame(g.gameId).name)} <span class="mini"><i style="width:${(g.played / Math.max(1, g.total)) * 100}%"></i></span> ${g.played}/${g.total}</span>`).join('<span class="sep">|</span>')}
          <span class="sep">|</span><span>обновлено ${secs} с назад</span>
        </div>
        <table>
          <thead><tr><th>Место</th><th>Команда</th>${T.games.map((g) => `<th class="g">${esc(GT.getGame(g).name)}</th>`).join('')}<th class="s">Сумма мест</th></tr></thead>
          <tbody>${comp.overall.map((r) => {
            const was = prevPlaces.get(r.i);
            const mv = was && was !== r.place ? `<span class="move ${was < r.place ? 'down' : ''}">${was > r.place ? '▲' : '▼'}${Math.abs(was - r.place)}</span>` : '';
            return `<tr><td class="pl">${r.place}${mv}</td><td class="nm">${esc(T.names[r.i])}</td>
              ${T.games.map((g) => { const x = r.places[g]; return x && x.matches ? `<td class="g"><span class="p">${x.place}</span><span class="v">${GT.fmtNum(x.total)}</span></td>` : '<td class="g dim">–</td>'; }).join('')}
              <td class="s">${r.sum}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <div class="board-foot"><div><div>// место — по последним итогам игр, очки идущей (●) предварительные</div><div class="tail">tail -f matches.log <span class="dim">// ${esc(tail)}</span></div></div>
          <div style="text-align:right">таблица на своём ПК<br><b style="color:var(--text)">${esc(location.host)}/#/${esc(d.route || '')}</b></div></div>`;
      el.appendChild(close);
    }
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    const timer = setInterval(render, 1000);
    const onKey = (e) => { if (e.key === 'Escape') shut(); };
    function shut() {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      document.body.style.overflow = '';
      el.remove();
    }
    el.addEventListener('click', (e) => { if (e.target.closest('.board-close')) shut(); });
    document.addEventListener('keydown', onKey);
    render();
    return { refresh: render, close: shut };
  };
})();
