/*
 * Описания игр. Файл работает и в браузере, и в Web Worker, и в Node (сервер «Эфира»):
 * всё вешается на глобальный объект GT.
 *
 * Контракт игры:
 *   defaults            параметры по умолчанию (rounds — число раундов/аукционов)
 *   init(par, n)        состояние матча на n раундов
 *   done(s)             матч окончен?
 *   active(s)           индексы игроков, которые ходят сейчас ([0,1] — одновременный ход)
 *   view(s, p, par)     что игрок p видит о текущем состоянии (ctx.state)
 *   sanitize(a, ...)    приводит ответ стратегии к допустимому действию
 *   noisy(a, ...)       искажённое действие для режима «шум»
 *   resolve(s, a, par)  применяет ходы, возвращает { payoffs:[x,y], info }
 *   cell(a, par, info, p) как показать действие в сетке матча
 */
(function (root) {
  'use strict';
  const GT = root.GT || (root.GT = {});

  const clampInt = (v, lo, hi, def) => {
    v = Math.round(Number(v));
    if (!Number.isFinite(v)) v = def;
    return Math.min(hi, Math.max(lo, v));
  };
  GT.clampInt = clampInt;

  const simultaneous = {
    sequential: false,
    init(par, n) { return { round: 0, rounds: n }; },
    done(s) { return s.round >= s.rounds; },
    active() { return [0, 1]; },
    view() { return {}; },
  };

  function matrixGame(cfg) {
    const P = cfg.payoff;
    return Object.assign({}, simultaneous, {
      kind: 'matrix',
      unit: 'раунд',
      defaults: { rounds: 200, payoff: P },
      sanitize(a) { return String(a).toUpperCase() === 'D' ? 'D' : 'C'; },
      randomAction(s, p, par, rng) { return rng() < 0.5 ? 'C' : 'D'; },
      noisy(a) { return a === 'C' ? 'D' : 'C'; },
      resolve(s, a, par) {
        const pay = par.payoff[a[0] + a[1]];
        s.round++;
        return { payoffs: [pay[0], pay[1]] };
      },
      cell(a) { return { text: a, cls: a === 'C' ? 'good' : 'bad' }; },
    }, cfg);
  }

  const games = [
    matrixGame({
      id: 'dilemma',
      name: 'Дилемма заключённого',
      icon: '⇄',
      color: 'purple',
      short: 'Каждый раунд два игрока одновременно выбирают: сотрудничать (C) или предать (D). Предать выгоднее всегда — но если предают оба, оба проигрывают.',
      rules: [
        'Оба игрока одновременно выбирают C (сотрудничать) или D (предать).',
        'Взаимное сотрудничество даёт обоим по 5 очков, взаимное предательство — по 1.',
        'Предатель против сотрудничающего получает 10, а «наивный» — 0.',
        'Игра повторяется много раундов: репутация и месть начинают иметь значение.',
      ],
      insight: 'В одном раунде доминирует предательство (равновесие Нэша D/D), но в повторяющейся игре выигрывают «добрые, но не наивные» стратегии — вывод знаменитых турниров Аксельрода.',
      labels: { C: 'Сотрудничать', D: 'Предать' },
      payoff: { CC: [5, 5], CD: [0, 10], DC: [10, 0], DD: [1, 1] },
    }),
    matrixGame({
      id: 'stag_hunt',
      name: 'Охота на оленя',
      icon: '◎',
      color: 'teal',
      short: 'Двое охотников: вместе можно добыть оленя, поодиночке — только зайца. Выгоднее всего доверять, но доверие рискованно.',
      rules: [
        'C — охотиться на оленя (нужен напарник), D — на зайца (можно в одиночку).',
        'Олень вдвоём: по 5 очков. Заяц: 3 очка независимо от напарника.',
        'Кто пошёл на оленя один, остаётся ни с чем — 0.',
      ],
      insight: 'Два равновесия Нэша: эффективное (олень/олень) и безопасное (заяц/заяц). Это игра про координацию и доверие, а не про жадность.',
      labels: { C: 'Олень', D: 'Заяц' },
      payoff: { CC: [5, 5], CD: [0, 3], DC: [3, 0], DD: [3, 3] },
    }),
    matrixGame({
      id: 'hawk_dove',
      name: 'Ястреб и голубь',
      icon: '⚔',
      color: 'red',
      short: 'Делим ресурс ценностью 4. Ястреб дерётся, голубь уступает. Два ястреба калечат друг друга — драка обходится дороже самого ресурса.',
      rules: [
        'C — голубь (уступить/поделиться), D — ястреб (драться).',
        'Голубь + голубь делят ресурс: по 2. Ястреб против голубя забирает всё: 4 и 0.',
        'Два ястреба дерутся: ценность 4 минус травмы 6, пополам — по −1.',
      ],
      insight: 'Он же «игра в цыплёнка». Чистых равновесий два (кто-то уступает), а смешанное — быть ястребом с вероятностью V/C = 2/3. Классика эволюционной теории игр.',
      labels: { C: 'Голубь', D: 'Ястреб' },
      payoff: { CC: [2, 2], CD: [0, 4], DC: [4, 0], DD: [-1, -1] },
    }),

    Object.assign({}, simultaneous, {
      id: 'travelers_dilemma',
      kind: 'travelers',
      name: 'Дилемма путешественника',
      icon: '≤',
      color: 'blue',
      unit: 'раунд',
      short: 'Два путешественника потеряли одинаковые чемоданы и независимо называют их стоимость. Кто назвал меньше — получает бонус, кто больше — штраф.',
      rules: [
        'Каждый называет целое число от 2 до 100.',
        'Если числа равны — оба получают это число.',
        'Иначе оба получают меньшее число; назвавший меньшее получает +2, большее — −2.',
      ],
      insight: 'Обратная индукция доводит «рациональных» игроков до 2 — единственного равновесия Нэша. Люди в экспериментах называют числа около 100 и выигрывают больше.',
      defaults: { rounds: 100, min: 2, max: 100, bonus: 2 },
      sanitize(a, s, p, par) { return clampInt(a, par.min, par.max, par.max); },
      randomAction(s, p, par, rng) { return par.min + Math.floor(rng() * (par.max - par.min + 1)); },
      noisy(a, s, p, par, rng) { return this.randomAction(s, p, par, rng); },
      resolve(s, a, par) {
        const [x, y] = a;
        let p0, p1;
        if (x === y) { p0 = p1 = x; }
        else if (x < y) { p0 = x + par.bonus; p1 = x - par.bonus; }
        else { p0 = y - par.bonus; p1 = y + par.bonus; }
        s.round++;
        return { payoffs: [p0, p1] };
      },
      cell(a, par) { return { text: a, t: (a - par.min) / (par.max - par.min) }; },
    }),

    Object.assign({}, simultaneous, {
      id: 'public_goods',
      kind: 'public_goods',
      name: 'Общественное благо',
      icon: 'Σ',
      color: 'orange',
      unit: 'раунд',
      short: 'У каждого игрока в начале раунда 20 токенов. Оба одновременно решают, сколько вложить в общий пул. Пул умножается на 1.5 и делится поровну.',
      rules: [
        'Каждый раунд у игрока 20 токенов, вложить можно от 0 до 20.',
        'Сумма вкладов умножается на 1.5 и делится пополам.',
        'Невложенные токены остаются у игрока, выплата усекается до целого.',
      ],
      insight: 'Каждый вложенный токен возвращается вкладчику только на 0.75 — выгоднее ничего не давать. Но если вкладывают все, каждый получает 30 вместо 20. Это модель налогов, экологии и open source.',
      defaults: { rounds: 50, endowment: 20, multiplier: 1.5 },
      sanitize(a, s, p, par) { return clampInt(a, 0, par.endowment, 0); },
      randomAction(s, p, par, rng) { return Math.floor(rng() * (par.endowment + 1)); },
      noisy(a, s, p, par, rng) { return this.randomAction(s, p, par, rng); },
      resolve(s, a, par) {
        const share = (a[0] + a[1]) * par.multiplier / 2;
        s.round++;
        return { payoffs: [Math.floor(par.endowment - a[0] + share), Math.floor(par.endowment - a[1] + share)] };
      },
      cell(a, par) { return { text: a, t: a / par.endowment }; },
    }),

    {
      id: 'tug_of_war',
      kind: 'tug_of_war',
      name: 'Перетягивание каната',
      icon: '↔',
      color: 'green',
      unit: 'раунд',
      sequential: false,
      short: 'Игра на управление ресурсами. У каждого игрока есть запас энергии. Каждый раунд оба одновременно решают, сколько энергии потратить: кто потратил больше — тянет канат на себя.',
      rules: [
        'У каждого 100 энергии на весь матч. Восстановления нет (его можно включить в параметрах).',
        'Оба одновременно тратят от 0 до всей своей энергии.',
        'Потративший больше выигрывает раунд (+1 очко) и сдвигает канат на шаг к себе. Ничья — никому.',
        'Потраченная энергия сгорает у обоих — даже у проигравшего.',
      ],
      insight: 'Динамическая версия «игры полковника Блотто»: важно не сколько у тебя сил, а где их применить. Переплатить за раунд так же плохо, как недоплатить.',
      defaults: { rounds: 10, energy: 100, regen: 0 },
      init(par, n) { return { round: 0, rounds: n, e: [par.energy, par.energy], pos: 0 }; },
      done(s) { return s.round >= s.rounds; },
      active() { return [0, 1]; },
      view(s, p, par) {
        return { myEnergy: s.e[p], oppEnergy: s.e[1 - p], pos: p === 0 ? s.pos : -s.pos, maxEnergy: par.energy, regen: par.regen };
      },
      sanitize(a, s, p) { return clampInt(a, 0, Math.floor(s.e[p]), 0); },
      randomAction(s, p, par, rng) { return Math.floor(rng() * (Math.floor(s.e[p]) + 1)); },
      noisy(a, s, p, par, rng) { return this.randomAction(s, p, par, rng); },
      resolve(s, a, par) {
        s.e[0] -= a[0]; s.e[1] -= a[1];
        let pay = [0, 0];
        if (a[0] > a[1]) { pay = [1, 0]; s.pos++; }
        else if (a[1] > a[0]) { pay = [0, 1]; s.pos--; }
        s.e[0] = Math.min(par.energy, s.e[0] + par.regen);
        s.e[1] = Math.min(par.energy, s.e[1] + par.regen);
        s.round++;
        return { payoffs: pay, info: { pos: s.pos, e: s.e.slice() } };
      },
      cell(a, par, info, p, pay) { return { text: a, cls: pay[p] > pay[1 - p] ? 'good' : pay[p] < pay[1 - p] ? 'bad' : 'tie' }; },
    },

    {
      id: 'ultimatum',
      kind: 'ultimatum',
      name: 'Ультиматум',
      icon: '÷',
      color: 'pink',
      unit: 'раунд',
      sequential: false,
      short: 'Игроки по очереди делят 100 монет. Предлагающий называет долю партнёра, отвечающий принимает или отвергает. Отказ — оба получают ноль.',
      rules: [
        'Роли чередуются: в чётных раундах предлагает игрок A, в нечётных — B.',
        'Стратегия каждый раунд возвращает { offer, accept }: сколько предложить, будучи предлагающим, и минимум, который примет, будучи отвечающим.',
        'Если offer ≥ accept — делёж состоялся, иначе оба получают 0.',
      ],
      insight: '«Рациональный» ответ — соглашаться на 1 монету, но люди отвергают предложения меньше 20–30%: наказание несправедливости — тоже стратегия, особенно в повторяющейся игре.',
      defaults: { rounds: 50, pie: 100 },
      init(par, n) { return { round: 0, rounds: n, deals: [[], []] }; },
      done(s) { return s.round >= s.rounds; },
      active() { return [0, 1]; },
      view(s, p, par) { return { iAmProposer: s.round % 2 === p, pie: par.pie, deals: s.deals[p] }; },
      sanitize(a, s, p, par) {
        if (typeof a === 'number') a = { offer: a, accept: a };
        a = a || {};
        return { offer: clampInt(a.offer, 0, par.pie, Math.floor(par.pie / 2)), accept: clampInt(a.accept, 0, par.pie, 0) };
      },
      randomAction(s, p, par, rng) { return { offer: Math.floor(rng() * (par.pie + 1)), accept: Math.floor(rng() * (par.pie / 2 + 1)) }; },
      noisy(a, s, p, par, rng) { return this.randomAction(s, p, par, rng); },
      resolve(s, a, par) {
        const prop = s.round % 2;
        const offer = a[prop].offer;
        const threshold = a[1 - prop].accept;
        const ok = offer >= threshold;
        const pay = [0, 0];
        if (ok) { pay[prop] = par.pie - offer; pay[1 - prop] = offer; }
        // Предлагающий узнаёт только «принято / отказ»; свой порог знает лишь отвечающий
        for (const p of [0, 1]) s.deals[p].push(p === prop ? { iProposed: true, offer, accepted: ok } : { iProposed: false, offer, threshold, accepted: ok });
        s.round++;
        return { payoffs: pay, info: { proposer: prop, offer, threshold, ok } };
      },
      cell(a, par, info, p) {
        const text = info.proposer === p ? String(a.offer) : '≥' + a.accept;
        return { text, cls: info.ok ? 'good' : 'bad', dim: info.proposer !== p };
      },
    },

    {
      id: 'dollar_auction',
      kind: 'dollar_auction',
      name: 'Аукцион двойной цены',
      icon: '$',
      color: 'yellow',
      unit: 'аукцион',
      sequential: true,
      short: 'На торги выставляется приз стоимостью 100. Игроки поочерёдно делают ставки. Ключевое правило: оба платят свои последние ставки, но приз получает только победитель.',
      rules: [
        'Матч — серия аукционов (по умолчанию 10). Первым ходит A, в следующем аукционе — B, и так по очереди.',
        'В свой ход стратегия возвращает число — новую ставку, строго больше ставки соперника. 0 (или ставка не выше соперника) — пас.',
        'После паса торги заканчиваются: победитель получает «приз − своя ставка», проигравший платит свою ставку.',
        'Бюджет ограничен 200, торги длятся не больше 20 ходов.',
      ],
      insight: 'Аукцион Шубика: проигрывающему всегда кажется выгодным поднять ещё чуть-чуть, и торги легко уходят выше ценности приза. Модель эскалации конфликтов, ценовых войн и «невозвратных затрат».',
      defaults: { rounds: 10, prize: 100, cap: 200, maxMoves: 20 },
      init(par, n) { return { round: 0, rounds: n, bids: [0, 0], turn: 0, moves: 0, results: [[], []] }; },
      done(s) { return s.round >= s.rounds; },
      active(s) { return [s.turn]; },
      view(s, p, par) {
        return {
          myBid: s.bids[p], oppBid: s.bids[1 - p], minBid: s.bids[1 - p] + 1,
          prize: par.prize, cap: par.cap, movesLeft: par.maxMoves - s.moves,
          auction: s.round, iStarted: s.round % 2 === p, history: s.results[p],
        };
      },
      sanitize(a, s, p, par) { return clampInt(a, 0, par.cap, 0); },
      randomAction(s, p, par, rng) { return rng() < 0.5 ? 0 : s.bids[1 - p] + 1 + Math.floor(rng() * 20); },
      noisy(a, s, p, par, rng) { return a > 0 ? 0 : this.randomAction(s, p, par, rng); },
      resolve(s, a, par) {
        const p = s.turn;
        const bid = a[p];
        const pay = [0, 0];
        s.moves++;
        if (bid > s.bids[1 - p] && bid <= par.cap) {
          s.bids[p] = bid;
          s.turn = 1 - p;
          if (s.moves < par.maxMoves) return { payoffs: pay, info: { p, bid } };
        }
        const b = s.bids;
        const winner = b[0] > b[1] ? 0 : b[1] > b[0] ? 1 : -1;
        for (const i of [0, 1]) {
          pay[i] = (winner === i ? par.prize : 0) - b[i];
          s.results[i].push({ myBid: b[i], oppBid: b[1 - i], won: winner === i, payoff: pay[i] });
        }
        const info = { p, bid, end: true, winner, bids: b.slice() };
        s.bids = [0, 0];
        s.moves = 0;
        s.round++;
        s.turn = s.round % 2;
        return { payoffs: pay, info };
      },
      // В сетке показываем не каждый ход, а итог каждого аукциона
      units(m) {
        const out = [];
        let acc = [0, 0];
        m.infos.forEach((info, k) => {
          acc[0] += m.pays[0][k]; acc[1] += m.pays[1][k];
          if (!info || !info.end) return;
          out.push({
            c: [0, 1].map((p) => ({ text: info.bids[p], cls: info.winner === p ? 'good' : info.bids[p] > 0 ? 'bad' : 'tie' })),
            pay: acc,
          });
          acc = [0, 0];
        });
        return out;
      },
    },
  ];

  GT.games = {};
  games.forEach((g) => { GT.games[g.id] = g; });
  GT.gameList = () => games;
  GT.getGame = (id) => GT.games[id] || null;
})(typeof self !== 'undefined' ? self : globalThis);
