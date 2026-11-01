/*
 * Движок: проведение матча, расписание турнира, таблицы, места, эволюция.
 * Чистые функции без DOM — работают в браузере, Web Worker и Node.
 */
(function (root) {
  'use strict';
  const GT = root.GT || (root.GT = {});

  // mulberry32: быстрый воспроизводимый генератор
  GT.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const last = (arr) => arr[arr.length - 1];

  /*
   * opts: { seed, rounds, noise (0..1), hidden (скрыть длину матча), params }
   * Возвращает полный протокол матча.
   */
  GT.runMatch = function (game, sa, sb, opts) {
    opts = opts || {};
    const seed = opts.seed == null ? 1 : opts.seed;
    const par = Object.assign({}, game.defaults, opts.params || {});
    const rng = GT.rng(seed);
    const srng = [GT.rng(seed * 7919 + 17), GT.rng(seed * 104729 + 31)];
    let n = Math.max(1, Math.round(opts.rounds || par.rounds));
    // Скрытая длина: матч обрывается случайно, в среднем через n раундов
    if (opts.hidden) {
      const q = 1 / n;
      let k = 1;
      while (rng() > q && k < n * 4) k++;
      n = k;
    }
    const s = game.init(par, n);
    const strats = [sa, sb];
    const hist = [[], []];
    const pays = [[], []];
    const score = [0, 0];
    const infos = [];
    const errors = [0, 0];
    let lastError = [null, null];
    const ctxs = [0, 1].map((p) => ({
      player: p,
      rounds: opts.hidden ? null : n,
      params: par,
      my: hist[p], opp: hist[1 - p],
      myPay: pays[p], oppPay: pays[1 - p],
      mem: {},
      rng: srng[p],
    }));

    let steps = 0;
    while (!game.done(s) && steps < 100000) {
      const act = [null, null];
      for (const p of game.active(s)) {
        const c = ctxs[p];
        c.round = s.round;
        c.myScore = score[p];
        c.oppScore = score[1 - p];
        c.myLast = last(hist[p]);
        c.oppLast = last(hist[1 - p]);
        c.state = game.view(s, p, par);
        let a;
        try {
          a = strats[p].play(c);
        } catch (e) {
          errors[p]++;
          lastError[p] = String((e && e.message) || e);
          a = game.randomAction(s, p, par, srng[p]);
        }
        a = game.sanitize(a, s, p, par);
        if (opts.noise && rng() < opts.noise) a = game.sanitize(game.noisy(a, s, p, par, rng), s, p, par);
        act[p] = a;
      }
      const r = game.resolve(s, act, par);
      for (const p of [0, 1]) {
        hist[p].push(act[p]);
        pays[p].push(r.payoffs[p]);
        score[p] += r.payoffs[p];
      }
      infos.push(r.info || null);
      steps++;
    }
    return {
      gameId: game.id, params: par, hidden: !!opts.hidden,
      hist, pays, infos, score, units: s.round, steps, errors, lastError,
    };
  };

  // Сжатая сводка матча (для таблиц и передачи из воркера)
  GT.summary = function (m) {
    const u = Math.max(1, m.units);
    return {
      score: m.score.slice(),
      avg: [m.score[0] / u, m.score[1] / u],
      units: m.units,
      winner: m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1,
      errors: m.errors.slice(),
      lastError: m.lastError.slice(),
    };
  };

  // Ячейки сетки «раунд за раундом»
  GT.matchUnits = function (game, m) {
    if (game.units) return game.units(m);
    return m.hist[0].map((_, k) => {
      const pay = [m.pays[0][k], m.pays[1][k]];
      return {
        c: [0, 1].map((p) => game.cell(m.hist[p][k], m.params, m.infos[k] || {}, p, pay)),
        pay,
      };
    });
  };

  /*
   * Расписание кругового турнира между n участниками.
   * repeats — сколько матчей на пару (места меняются), selfPlay — играть ли с собой.
   */
  GT.schedule = function (n, repeats, selfPlay) {
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let j = selfPlay ? i : i + 1; j < n; j++) {
        for (let r = 0; r < repeats; r++) {
          out.push(r % 2 === 0 || i === j ? { a: i, b: j, r } : { a: j, b: i, r });
        }
      }
    }
    return out;
  };

  // Места с учётом ничьих: 1, 2, 2, 4…
  GT.places = function (values, higherIsBetter) {
    const idx = values.map((v, i) => i).sort((x, y) => (higherIsBetter === false ? values[x] - values[y] : values[y] - values[x]));
    const place = new Array(values.length);
    idx.forEach((i, k) => {
      const prev = idx[k - 1];
      place[i] = k > 0 && values[prev] === values[i] ? place[prev] : k + 1;
    });
    return place;
  };

  /*
   * Таблица по одной игре. results: [{ a, b, score:[x,y], avg:[..], winner, units }]
   */
  GT.standings = function (n, results) {
    const rows = Array.from({ length: n }, (_, i) => ({ i, total: 0, perUnit: 0, w: 0, d: 0, l: 0, matches: 0, units: 0 }));
    const cross = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ sum: 0, cnt: 0 })));
    for (const r of results) {
      const side = [r.a, r.b];
      for (const p of [0, 1]) {
        const row = rows[side[p]];
        if (r.a === r.b && p === 1) {
          // матч с самим собой: учитываем один раз
          cross[r.a][r.a].sum += (r.avg[0] + r.avg[1]) / 2;
          cross[r.a][r.a].cnt++;
          continue;
        }
        cross[side[p]][side[1 - p]].sum += r.avg[p];
        cross[side[p]][side[1 - p]].cnt++;
        if (r.a === r.b) continue;
        row.total += r.score[p];
        row.units += r.units;
        row.matches++;
        if (r.winner === -1) row.d++;
        else if (r.winner === p) row.w++;
        else row.l++;
      }
    }
    rows.forEach((row) => { row.perUnit = row.units ? row.total / row.units : 0; });
    const place = GT.places(rows.map((r) => r.total));
    rows.forEach((row) => { row.place = place[row.i]; });
    const matrix = cross.map((line) => line.map((c) => (c.cnt ? c.sum / c.cnt : null)));
    return { rows, matrix };
  };

  /*
   * Репликаторная динамика: доля стратегии растёт пропорционально её
   * приспособленности против текущей популяции. A[i][j] — средний выигрыш i против j.
   */
  GT.evolution = function (A, generations) {
    const n = A.length;
    const M = A.map((row, i) => row.map((v, j) => (v == null ? (A[j][i] == null ? 0 : A[j][i]) : v)));
    let lo = Infinity;
    M.forEach((row) => row.forEach((v) => { lo = Math.min(lo, v); }));
    const shift = lo <= 0 ? -lo + 1 : 0;
    let x = new Array(n).fill(1 / n);
    const series = [x.slice()];
    for (let g = 0; g < generations; g++) {
      const f = x.map((_, i) => M[i].reduce((s, v, j) => s + (v + shift) * x[j], 0));
      const mean = f.reduce((s, v, i) => s + v * x[i], 0);
      x = x.map((xi, i) => (xi * f[i]) / mean);
      // вымершие стратегии обнуляем, чтобы график не тянулся бесконечно малыми долями
      x = x.map((v) => (v < 1e-4 ? 0 : v));
      const z = x.reduce((a, b) => a + b, 0);
      x = x.map((v) => v / z);
      series.push(x.slice());
    }
    return series;
  };

  /*
   * Итоги турнира по нескольким играм: место в каждой игре, сумма мест, общий зачёт.
   * perGame: [{ gameId, standings }]
   */
  GT.overall = function (n, perGame) {
    const rows = Array.from({ length: n }, (_, i) => ({ i, sum: 0, w: 0, d: 0, l: 0, firsts: 0, places: {} }));
    for (const g of perGame) {
      for (const r of g.standings.rows) {
        const row = rows[r.i];
        row.places[g.gameId] = r;
        row.sum += r.place;
        row.w += r.w; row.d += r.d; row.l += r.l;
        if (r.place === 1) row.firsts++;
      }
    }
    // меньше сумма мест — выше; при равенстве — больше первых мест, затем больше побед
    const key = (r) => r.sum * 1e6 - r.firsts * 1e3 - r.w;
    const place = GT.places(rows.map(key), false);
    rows.forEach((r) => { r.place = place[r.i]; });
    return rows.sort((a, b) => a.place - b.place || a.i - b.i);
  };

  // «Сюжеты» турнира, как в сводке после соревнования
  GT.highlights = function (names, gameNames, overallRows, perGame, results) {
    const out = [];
    const leader = overallRows[0] && overallRows[0].i;
    if (leader != null) {
      const beat = new Map();
      for (const r of results) {
        if (r.a === r.b || r.winner === -1) continue;
        const win = r.winner === 0 ? r.a : r.b;
        const lose = r.winner === 0 ? r.b : r.a;
        if (lose !== leader) continue;
        if (!beat.has(win)) beat.set(win, new Map());
        const m = beat.get(win);
        m.set(r.gameId, (m.get(r.gameId) || 0) + 1);
      }
      if (beat.size) {
        const parts = [...beat.entries()].map(([who, games]) =>
          `«${names[who]}» (${[...games.entries()].map(([g, c]) => `${gameNames[g]} ×${c}`).join(', ')})`);
        out.push({ title: 'кто обыгрывал лидера', text: `«${names[leader]}» уступал${parts.length > 3 ? ' (показаны первые 3)' : ''}: ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ` и ещё ${parts.length - 3}` : ''}` });
      } else {
        out.push({ title: 'кто обыгрывал лидера', text: `Никто: «${names[leader]}» не проиграл ни одного матча.` });
      }
    }
    // Сенсация: самая низкая строчка обыграла самую высокую в одной игре
    let best = null;
    for (const r of results) {
      if (r.a === r.b || r.winner === -1) continue;
      const g = perGame.find((x) => x.gameId === r.gameId);
      if (!g) continue;
      const win = r.winner === 0 ? r.a : r.b;
      const lose = r.winner === 0 ? r.b : r.a;
      const gap = g.standings.rows[win].place - g.standings.rows[lose].place;
      if (gap > 0 && (!best || gap > best.gap)) best = { gap, win, lose, r, g };
    }
    if (best) {
      const pw = best.g.standings.rows[best.win].place;
      const pl = best.g.standings.rows[best.lose].place;
      const sc = best.r.winner === 0 ? best.r.score : best.r.score.slice().reverse();
      out.push({ title: 'главная сенсация', text: `«${names[best.win]}» (${pw}-е место в игре «${gameNames[best.g.gameId]}») обыграл «${names[best.lose]}» (${pl}-е), ${fmtNum(sc[0])} : ${fmtNum(sc[1])}` });
    }
    // Ничьи
    const draws = perGame.map((g) => {
      const rs = results.filter((r) => r.gameId === g.gameId && r.a !== r.b);
      const d = rs.filter((r) => r.winner === -1).length;
      return { g, share: rs.length ? d / rs.length : 0 };
    }).sort((a, b) => b.share - a.share)[0];
    if (draws && draws.share > 0) {
      out.push({ title: 'ничьи', text: `Больше всего ничьих в игре «${gameNames[draws.g.gameId]}»: ${Math.round(draws.share * 100)}% сыгранных матчей` });
    }
    return out;
  };

  function fmtNum(x) {
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }
  GT.fmtNum = function (x, digits) {
    if (x == null || Number.isNaN(x)) return '–';
    const d = digits == null ? (Number.isInteger(x) ? 0 : 1) : digits;
    return x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  // Пользовательская стратегия из текста (выполняется только в воркере)
  GT.compile = function (code) {
    // eslint-disable-next-line no-new-func
    const factory = new Function('"use strict";\n' + code + '\n;return typeof play === "function" ? play : null;');
    const fn = factory();
    if (!fn) throw new Error('Не найдена функция play(ctx)');
    return fn;
  };

  /*
   * Команды для многоигрового турнира: у каждой — свой бот в каждой игре.
   * Ключ — kind игры (матричные игры делят один набор ботов).
   */
  GT.teams = [
    { id: 'avengers', name: 'Мстители', bots: { matrix: 'tit_for_tat', travelers: 'mirror', public_goods: 'conditional', tug_of_war: 'outbid', ultimatum: 'tit_for_tat', dollar_auction: 'learner' } },
    { id: 'saints', name: 'Добряки', bots: { matrix: 'always_c', travelers: 'honest', public_goods: 'full', tug_of_war: 'even', ultimatum: 'fair', dollar_auction: 'abstain' } },
    { id: 'sharks', name: 'Акулы', bots: { matrix: 'always_d', travelers: 'undercut', public_goods: 'free_rider', tug_of_war: 'all_in', ultimatum: 'rational', dollar_auction: 'escalator' } },
    { id: 'diplomats', name: 'Дипломаты', bots: { matrix: 'generous_tft', travelers: 'forgiving', public_goods: 'generous', tug_of_war: 'shadow', ultimatum: 'reciprocal', dollar_auction: 'cautious' } },
    { id: 'elephants', name: 'Слоны (всё помнят)', bots: { matrix: 'grim', travelers: 'endgame', public_goods: 'grim', tug_of_war: 'saver', ultimatum: 'proud', dollar_auction: 'value' } },
    { id: 'scientists', name: 'Учёные', bots: { matrix: 'pavlov', travelers: 'average', public_goods: 'average', tug_of_war: 'analyst', ultimatum: 'explorer', dollar_auction: 'jump' } },
    { id: 'detectives', name: 'Детективы', bots: { matrix: 'detective', travelers: 'slow_descent', public_goods: 'bait', tug_of_war: 'burst', ultimatum: 'greedy', dollar_auction: 'one_shot' } },
    { id: 'gamblers', name: 'Азартные', bots: { matrix: 'joss', travelers: 'cautious', public_goods: 'half', tug_of_war: 'minimal', ultimatum: 'fair', dollar_auction: 'sunk_cost' } },
    { id: 'chaos', name: 'Хаос', bots: { matrix: 'random', travelers: 'random', public_goods: 'random', tug_of_war: 'random', ultimatum: 'random', dollar_auction: 'random_limit' } },
    { id: 'adaptive', name: 'Адаптивные', bots: { matrix: 'adaptive', travelers: 'adaptive', public_goods: 'adaptive', tug_of_war: 'adaptive', ultimatum: 'adaptive', dollar_auction: 'last_word' } },
    { id: 'humans', name: 'Человечные', bots: { matrix: 'contrite_tft', travelers: 'holder', public_goods: 'halfway_up', tug_of_war: 'noisy_even', ultimatum: 'random_fair', dollar_auction: 'limit75' } },
    { id: 'nash', name: 'Равновесники', bots: { matrix: 'hard_majority', travelers: 'nash', public_goods: 'decay', tug_of_war: 'even', ultimatum: 'rational', dollar_auction: 'value' } },
  ];
})(typeof self !== 'undefined' ? self : globalThis);
