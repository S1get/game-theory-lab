/*
 * Встроенные боты. У каждого: id, name, desc и play(ctx).
 *
 * ctx:
 *   round, rounds        номер раунда и их общее число (null, если длина скрыта)
 *   my, opp              история действий (своих и соперника)
 *   myPay, oppPay        история выигрышей
 *   myLast, oppLast      последние действия (undefined в первом раунде)
 *   myScore, oppScore    текущий счёт
 *   state                что видно о состоянии игры (зависит от игры)
 *   params               параметры игры
 *   mem                  объект для собственной памяти бота на весь матч
 *   rng()                случайное число [0, 1), воспроизводимое по seed
 */
(function (root) {
  'use strict';
  const GT = root.GT || (root.GT = {});

  const count = (arr, v) => arr.reduce((n, x) => n + (x === v ? 1 : 0), 0);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const remaining = (ctx, guess) => (ctx.rounds == null ? guess : ctx.rounds - ctx.round);
  const isLast = (ctx) => ctx.rounds != null && ctx.round === ctx.rounds - 1;

  const matrix = [
    { id: 'tit_for_tat', name: 'Око за око', tag: 'TFT',
      desc: 'Начинает с сотрудничества, дальше повторяет прошлый ход соперника. Победитель турниров Аксельрода.',
      play: (c) => c.oppLast || 'C' },
    { id: 'always_c', name: 'Всегда сотрудничать', tag: 'ALLC',
      desc: 'Безусловно добрый. Отлично играет с добрыми, беззащитен перед хищниками.',
      play: () => 'C' },
    { id: 'always_d', name: 'Всегда предавать', tag: 'ALLD',
      desc: 'Безусловный хищник. Равновесие Нэша однораундовой дилеммы.',
      play: () => 'D' },
    { id: 'grim', name: 'Злопамятный', tag: 'GRIM',
      desc: 'Сотрудничает, пока соперник ни разу не предал. После первого предательства — предаёт навсегда.',
      play: (c) => (c.opp.includes('D') ? 'D' : 'C') },
    { id: 'tf2t', name: 'Око за два ока', tag: 'TF2T',
      desc: 'Мстит только после двух предательств подряд. Устойчив к случайным ошибкам, но его можно доить.',
      play: (c) => (c.opp.length >= 2 && c.opp[c.opp.length - 1] === 'D' && c.opp[c.opp.length - 2] === 'D' ? 'D' : 'C') },
    { id: 'suspicious_tft', name: 'Подозрительный TFT', tag: 'STFT',
      desc: 'Как «Око за око», но первым ходом предаёт. Против TFT застревает в цикле взаимной мести.',
      play: (c) => c.oppLast || 'D' },
    { id: 'generous_tft', name: 'Щедрый TFT', tag: 'GTFT',
      desc: 'Отвечает на предательство предательством, но в 1/3 случаев прощает. Лучший выбор при шуме.',
      play: (c) => (c.oppLast === 'D' && c.rng() > 1 / 3 ? 'D' : 'C') },
    { id: 'pavlov', name: 'Павлов', tag: 'WSLS',
      desc: '«Выиграл — не меняй, проиграл — меняй». Повторяет ход, если соперник сотрудничал, иначе переключается.',
      play: (c) => (c.myLast === undefined ? 'C' : c.oppLast === 'C' ? c.myLast : (c.myLast === 'C' ? 'D' : 'C')) },
    { id: 'random', name: 'Случайный', tag: 'RAND',
      desc: 'Подбрасывает монетку. Полезен как фон и проверка на устойчивость.',
      play: (c) => (c.rng() < 0.5 ? 'C' : 'D') },
    { id: 'alternator', name: 'Чередующий', tag: 'ALT',
      desc: 'C, D, C, D… не обращая внимания на соперника.',
      play: (c) => (c.round % 2 === 0 ? 'C' : 'D') },
    { id: 'detective', name: 'Детектив', tag: 'PROBE',
      desc: 'Первые ходы C, D, C, C. Если соперник ни разу не отомстил — эксплуатирует его, иначе играет TFT.',
      play: (c) => {
        const opening = ['C', 'D', 'C', 'C'];
        if (c.round < 4) return opening[c.round];
        return c.opp.slice(0, 4).includes('D') ? c.oppLast : 'D';
      } },
    { id: 'joss', name: 'Джосс', tag: 'JOSS',
      desc: 'TFT с подлостью: в 10% случаев предаёт там, где должен был сотрудничать.',
      play: (c) => (c.oppLast === 'D' ? 'D' : c.rng() < 0.1 ? 'D' : 'C') },
    { id: 'gradual', name: 'Постепенный', tag: 'GRAD',
      desc: 'На n-е предательство соперника отвечает n предательствами подряд, затем двумя C для примирения.',
      play: (c) => {
        const m = c.mem;
        if (m.queue === undefined) { m.queue = []; m.seen = 0; }
        if (c.oppLast === 'D' && m.queue.length === 0) {
          m.seen++;
          for (let i = 0; i < m.seen; i++) m.queue.push('D');
          m.queue.push('C', 'C');
        }
        return m.queue.length ? m.queue.shift() : 'C';
      } },
    { id: 'soft_majority', name: 'Мягкое большинство', tag: 'SM',
      desc: 'Сотрудничает, если соперник сотрудничал не реже, чем предавал.',
      play: (c) => (count(c.opp, 'C') >= count(c.opp, 'D') ? 'C' : 'D') },
    { id: 'hard_majority', name: 'Жёсткое большинство', tag: 'HM',
      desc: 'Предаёт, если соперник предавал не реже, чем сотрудничал. Начинает с D.',
      play: (c) => (count(c.opp, 'D') >= count(c.opp, 'C') ? 'D' : 'C') },
    { id: 'endgame_tft', name: 'TFT с финальным ударом', tag: 'TFT-E',
      desc: 'Играет «Око за око», но в последнем раунде предаёт — если знает, что он последний. Сравните с режимом «скрытая длина».',
      play: (c) => (isLast(c) ? 'D' : c.oppLast || 'C') },
  ];

  const travelers = [
    { id: 'honest', name: 'Честный 100', desc: 'Всегда называет максимум. Лучший исход, если соперник такой же.',
      play: (c) => c.params.max },
    { id: 'nash', name: 'Равновесие Нэша', desc: 'Всегда называет минимум (2). Никогда не проигрывает много — и никогда не выигрывает.',
      play: (c) => c.params.min },
    { id: 'undercut', name: 'Подрезающий', desc: 'Начинает со 100, затем называет «прошлое число соперника − 1», чтобы забрать бонус.',
      play: (c) => (c.oppLast === undefined ? c.params.max : c.oppLast - 1) },
    { id: 'mirror', name: 'Зеркало', desc: 'Начинает со 100 и повторяет прошлое число соперника.',
      play: (c) => (c.oppLast === undefined ? c.params.max : c.oppLast) },
    { id: 'forgiving', name: 'Прощающий', desc: 'Называет 100; если соперник подрезал — один раз отвечает его числом, затем снова 100.',
      play: (c) => (c.oppLast !== undefined && c.oppLast < c.myLast ? c.oppLast : c.params.max) },
    { id: 'slow_descent', name: 'Медленный спуск', desc: 'Каждый раунд называет на 1 меньше, начиная со 100.',
      play: (c) => c.params.max - c.round },
    { id: 'average', name: 'Средний', desc: 'Называет среднее всех чисел соперника (первым ходом — 100).',
      play: (c) => (c.opp.length ? Math.round(avg(c.opp)) : c.params.max) },
    { id: 'cautious', name: 'Осторожный', desc: 'Случайное число от 95 до 99 — чуть ниже максимума.',
      play: (c) => 95 + Math.floor(c.rng() * 5) },
    { id: 'endgame', name: 'Финишёр', desc: 'Называет 100, а в последних 5 раундах резко падает до 2 (если знает длину матча).',
      play: (c) => (c.rounds != null && c.rounds - c.round <= 5 ? c.params.min : c.params.max) },
    { id: 'random', name: 'Случайный', desc: 'Случайное число от 2 до 100.',
      play: (c) => c.params.min + Math.floor(c.rng() * (c.params.max - c.params.min + 1)) },
  ];

  const publicGoods = [
    { id: 'full', name: 'Меценат', desc: 'Всегда вкладывает все токены.',
      play: (c) => c.params.endowment },
    { id: 'free_rider', name: 'Безбилетник', desc: 'Никогда ничего не вкладывает и пользуется чужими вкладами.',
      play: () => 0 },
    { id: 'conditional', name: 'Условный кооператор', desc: 'Начинает с полного вклада, затем вкладывает столько же, сколько соперник в прошлом раунде.',
      play: (c) => (c.oppLast === undefined ? c.params.endowment : c.oppLast) },
    { id: 'generous', name: 'Щедрый', desc: 'Вкладывает на 2 больше, чем соперник в прошлом раунде — тянет вверх.',
      play: (c) => (c.oppLast === undefined ? c.params.endowment : c.oppLast + 2) },
    { id: 'half', name: 'Половинка', desc: 'Всегда вкладывает половину.',
      play: (c) => Math.floor(c.params.endowment / 2) },
    { id: 'grim', name: 'Принципиальный', desc: 'Вкладывает всё, пока соперник хоть раз не вложил меньше половины. Потом — 0 навсегда.',
      play: (c) => (c.opp.some((x) => x < c.params.endowment / 2) ? 0 : c.params.endowment) },
    { id: 'decay', name: 'Усталость', desc: 'Начинает с полного вклада и каждые 5 раундов уменьшает его на 1.',
      play: (c) => c.params.endowment - Math.floor(c.round / 5) },
    { id: 'bait', name: 'Приманка', desc: 'Вкладывает всё первые 3 раунда, чтобы вызвать доверие, затем перестаёт.',
      play: (c) => (c.round < 3 ? c.params.endowment : 0) },
    { id: 'average', name: 'Усредняющий', desc: 'Вкладывает среднее от вкладов соперника, округляя вверх.',
      play: (c) => (c.opp.length ? Math.ceil(avg(c.opp)) : c.params.endowment) },
    { id: 'random', name: 'Случайный', desc: 'Случайный вклад от 0 до максимума.',
      play: (c) => Math.floor(c.rng() * (c.params.endowment + 1)) },
  ];

  const tugOfWar = [
    { id: 'even', name: 'Равномерный', desc: 'Распределяет энергию поровну на оставшиеся раунды (с учётом восстановления).',
      play: (c) => Math.ceil(c.state.myEnergy / Math.max(1, remaining(c, 10)) + c.state.regen) },
    { id: 'all_in', name: 'Всё и сразу', desc: 'Каждый раунд тратит всю доступную энергию.',
      play: (c) => c.state.myEnergy },
    { id: 'minimal', name: 'Минималист', desc: 'Всегда тратит 1 — побеждает тех, кто экономит до нуля.',
      play: () => 1 },
    { id: 'outbid', name: 'Опережающий', desc: 'Тратит «прошлая трата соперника + 1», если хватает энергии, иначе копит.',
      play: (c) => {
        const want = (c.oppLast === undefined ? 10 : c.oppLast) + 1;
        return want <= c.state.myEnergy ? want : 0;
      } },
    { id: 'saver', name: 'Накопитель', desc: 'Первые два раунда пропускает, потом тратит по 20, пока хватает.',
      play: (c) => (c.round < 2 ? 0 : Math.min(20, c.state.myEnergy)) },
    { id: 'analyst', name: 'Аналитик', desc: 'Оценивает среднюю трату соперника и перебивает её на 1, если может себе позволить; иначе копит.',
      play: (c) => {
        const want = Math.floor(avg(c.opp.slice(-5))) + 1;
        return want <= c.state.myEnergy * 0.6 ? want : c.state.regen;
      } },
    { id: 'burst', name: 'Рывки', desc: 'Каждый третий раунд тратит половину энергии, в остальные — ничего.',
      play: (c) => (c.round % 3 === 2 ? Math.floor(c.state.myEnergy / 2) : 0) },
    { id: 'shadow', name: 'Тень', desc: 'Тратит понемногу (восстановление + 2): дёшево, но выигрывает у тех, кто копит.',
      play: (c) => c.state.regen + 2 },
    { id: 'random', name: 'Случайный', desc: 'Тратит случайную часть энергии (до 40%).',
      play: (c) => Math.floor(c.rng() * c.state.myEnergy * 0.4) },
  ];

  const ultimatum = [
    { id: 'fair', name: 'Справедливый', desc: 'Предлагает 50, принимает от 40.',
      play: () => ({ offer: 50, accept: 40 }) },
    { id: 'rational', name: '«Рациональный»', desc: 'Предлагает 1, принимает что угодно от 1. Так советует учебник — но не люди.',
      play: () => ({ offer: 1, accept: 1 }) },
    { id: 'greedy', name: 'Жадный', desc: 'Предлагает 20, принимает от 20.',
      play: () => ({ offer: 20, accept: 20 }) },
    { id: 'proud', name: 'Гордый', desc: 'Предлагает 40, но сам принимает только от 50.',
      play: () => ({ offer: 40, accept: 50 }) },
    { id: 'reciprocal', name: 'Взаимный', desc: 'Предлагает столько же, сколько соперник предложил ему в прошлый раз. Принимает от 30.',
      play: (c) => {
        const theirs = c.state.deals.filter((d) => !d.iProposed);
        return { offer: theirs.length ? theirs[theirs.length - 1].offer : 50, accept: 30 };
      } },
    { id: 'explorer', name: 'Исследователь', desc: 'Начинает с 10; после отказа повышает предложение на 10, после согласия понижает на 5. Принимает от 25.',
      play: (c) => {
        const mine = c.state.deals.filter((d) => d.iProposed);
        if (c.mem.offer === undefined) c.mem.offer = 10;
        const last = mine[mine.length - 1];
        if (last && c.mem.seen !== mine.length) {
          c.mem.offer += last.accepted ? -5 : 10;
          c.mem.seen = mine.length;
        }
        return { offer: c.mem.offer, accept: 25 };
      } },
    { id: 'tit_for_tat', name: 'Око за око', desc: 'Если соперник в прошлый раз предложил ≥ 40 — предлагает 50, иначе 10. Принимает от 35.',
      play: (c) => {
        const theirs = c.state.deals.filter((d) => !d.iProposed);
        const last = theirs[theirs.length - 1];
        return { offer: !last || last.offer >= 40 ? 50 : 10, accept: 35 };
      } },
    { id: 'random', name: 'Случайный', desc: 'Случайное предложение и случайный порог согласия.',
      play: (c) => ({ offer: Math.floor(c.rng() * 101), accept: Math.floor(c.rng() * 51) }) },
  ];

  const dollarAuction = [
    { id: 'abstain', name: 'Наблюдатель', desc: 'Никогда не делает ставок.',
      play: () => 0 },
    { id: 'one_shot', name: 'Одна ставка', desc: 'Ставит 1, если торги ещё не начались. Дальше пасует.',
      play: (c) => (c.state.myBid === 0 && c.state.oppBid === 0 ? 1 : 0) },
    { id: 'jump', name: 'Прыжок к 99', desc: 'Сразу ставит 99: перебивать уже невыгодно. Известное «решение» аукциона Шубика.',
      play: (c) => (c.state.myBid === 0 && c.state.oppBid < 99 ? 99 : 0) },
    { id: 'cautious', name: 'Осторожный', desc: 'Перебивает на 5, пока ставка не выше половины приза.',
      play: (c) => (c.state.oppBid + 5 <= c.state.prize / 2 ? c.state.oppBid + 5 : 0) },
    { id: 'value', name: 'Оценщик', desc: 'Перебивает на 5, пока ставка меньше ценности приза. Не учитывает уже потраченное.',
      play: (c) => (c.state.oppBid + 5 < c.state.prize ? c.state.oppBid + 5 : 0) },
    { id: 'sunk_cost', name: 'Невозвратные затраты', desc: 'Перебивает, пока приз покрывает разницу ставок: «уже столько вложил, нельзя бросать». Классическая ловушка.',
      play: (c) => (c.state.oppBid + 5 < c.state.prize + c.state.myBid ? c.state.oppBid + 5 : 0) },
    { id: 'escalator', name: 'Эскалатор', desc: 'Всегда перебивает на 10, до упора в бюджет.',
      play: (c) => c.state.oppBid + 10 },
    { id: 'learner', name: 'Обучающийся', desc: 'Если соперник раньше задирал ставки до приза — сразу уступает, иначе торгуется до 60.',
      play: (c) => {
        if (c.state.history.some((h) => h.oppBid >= c.state.prize)) return 0;
        return c.state.oppBid + 5 <= 60 ? c.state.oppBid + 5 : 0;
      } },
    { id: 'random_limit', name: 'Случайный лимит', desc: 'Перед каждым аукционом выбирает случайный лимит от 20 до 120 и торгуется до него.',
      play: (c) => {
        if (c.mem.auction !== c.state.auction) {
          c.mem.auction = c.state.auction;
          c.mem.limit = 20 + Math.floor(c.rng() * 101);
        }
        return c.state.oppBid + 5 <= c.mem.limit ? c.state.oppBid + 5 : 0;
      } },
  ];

  GT.strategies = {
    matrix,
    travelers,
    public_goods: publicGoods,
    tug_of_war: tugOfWar,
    ultimatum,
    dollar_auction: dollarAuction,
  };

  GT.strategiesFor = (gameId) => {
    const g = GT.getGame(gameId);
    return g ? GT.strategies[g.kind] || [] : [];
  };

  // Шаблоны для песочницы: с чего начать свою стратегию
  GT.templates = {
    matrix: `// Верните 'C' (сотрудничать) или 'D' (предать).
function play(ctx) {
  if (ctx.round === 0) return 'C';
  // Мстим за предательство, но иногда прощаем
  if (ctx.oppLast === 'D' && ctx.rng() < 0.8) return 'D';
  return 'C';
}`,
    travelers: `// Верните число от 2 до 100.
function play(ctx) {
  if (ctx.oppLast === undefined) return 100;
  // Подстраиваемся под соперника, но не опускаемся слишком низко
  return Math.max(80, ctx.oppLast - 1);
}`,
    public_goods: `// Верните вклад от 0 до 20.
function play(ctx) {
  if (ctx.oppLast === undefined) return 20;
  return ctx.oppLast >= 10 ? 20 : 4;
}`,
    tug_of_war: `// Верните, сколько энергии потратить в этом раунде.
// ctx.state: { myEnergy, oppEnergy, pos, maxEnergy, regen }
function play(ctx) {
  const left = ctx.rounds == null ? 10 : ctx.rounds - ctx.round;
  if (ctx.state.oppEnergy < 5) return 6;          // соперник выдохся — дёшево забираем раунд
  return Math.floor(ctx.state.myEnergy / left) + ctx.state.regen;
}`,
    ultimatum: `// Верните { offer, accept }:
//   offer  — сколько из 100 отдать сопернику, если предлагаете вы;
//   accept — минимальное предложение, которое вы примете.
// ctx.state: { iAmProposer, pie, deals: [{ iProposed, offer, threshold, accepted }] }
function play(ctx) {
  return { offer: 45, accept: 30 };
}`,
    dollar_auction: `// Верните новую ставку (строго больше ставки соперника) или 0 — пас.
// ctx.state: { myBid, oppBid, minBid, prize, cap, movesLeft, auction, iStarted, history }
function play(ctx) {
  const next = ctx.state.oppBid + 5;
  return next <= 45 ? next : 0;
}`,
  };
})(typeof self !== 'undefined' ? self : globalThis);
