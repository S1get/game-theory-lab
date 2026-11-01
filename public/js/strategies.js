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

  /* ───────────── Расширенный набор: адаптивные и «человечные» боты ───────────── */

  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const PAIR_P = { CC: 8 / 9, CD: 1 / 2, DC: 1 / 3, DD: 0 };

  matrix.push(
    { id: 'adaptive', name: 'Адаптивный', tag: 'ADAPT',
      desc: 'TFT с головой: прощает одну ошибку, чтобы не застрять в цикле мести; если соперник часто предаёт без повода — перестаёт его кормить; в последнем раунде предаёт.',
      play: (c) => {
        const k = c.round, my = c.my, op = c.opp;
        if (isLast(c)) return 'D';
        if (k === 0) return 'C';
        let ch = 0, un = 0;
        for (let i = 1; i < k; i++) if (my[i - 1] === 'C') { ch++; if (op[i] === 'D') un++; }
        if (ch >= 6 && un > 0.25 * ch) return 'D';
        if (k >= 2 && my[k - 1] === 'C' && op[k - 1] === 'D' && my[k - 2] === 'D' && op[k - 2] === 'C') return 'C';
        return op[k - 1];
      } },
    { id: 'adaptive_probe', name: 'Адаптивный с зондом', tag: 'A-PRB',
      desc: 'Как «Адаптивный», но на третьем ходу один раз предаёт для проверки. Если соперник не отомстил — доит его до первой мести.',
      play: (c) => {
        const k = c.round, my = c.my, op = c.opp, m = c.mem;
        if (isLast(c)) return 'D';
        if (k < 2) return 'C';
        if (k === 2) return op[0] === 'C' && op[1] === 'C' ? 'D' : op[1];
        if ((k === 3 || k === 4) && my[2] === 'D') return 'C';
        if (k === 5 && my[2] === 'D' && op[2] === 'C' && op[3] === 'C' && op[4] === 'C') m.push = true;
        if (m.push) { if (op[k - 1] === 'D') m.push = false; else return 'D'; }
        return op[k - 1];
      } },
    { id: 'contrite_tft', name: 'Раскаивающийся TFT', tag: 'CTFT',
      desc: 'TFT, который признаёт свою вину: если сам предал без повода (например, по ошибке), не мстит за ответную месть.',
      play: (c) => {
        const k = c.round, my = c.my, op = c.opp;
        if (k === 0) return 'C';
        if (k >= 3 && my[k - 2] === 'D' && op[k - 3] === 'C' && op[k - 1] === 'D') return 'C';
        return op[k - 1];
      } },
    { id: 'firm_fair', name: 'Твёрдый, но честный', tag: 'FBF',
      desc: 'Сотрудничает всегда, кроме одного случая: если его только что «обули» (он C, соперник D) — отвечает D.',
      play: (c) => (c.myLast === 'C' && c.oppLast === 'D' ? 'D' : 'C') },
    { id: 'two_tits', name: 'Два ока за око', tag: '2TFT',
      desc: 'За одно предательство мстит двумя. Жёстче TFT: быстрее отучает хищников, но дольше выходит из ссор.',
      play: (c) => (c.opp.slice(-2).includes('D') ? 'D' : 'C') },
    { id: 'reverse_tft', name: 'Наоборот', tag: 'RTFT',
      desc: 'Делает противоположное прошлому ходу соперника, начинает с D. Учебный пример плохой стратегии.',
      play: (c) => (c.oppLast === undefined ? 'D' : c.oppLast === 'C' ? 'D' : 'C') },
    { id: 'handshake', name: 'Рукопожатие', tag: 'HAND',
      desc: 'Открывает секретным кодом D, C. Своих (кто ответил тем же) узнаёт и играет с ними TFT, чужих всегда предаёт. Модель сговора команд.',
      play: (c) => {
        if (c.round === 0) return 'D';
        if (c.round === 1) return 'C';
        const friend = c.opp[0] === 'D' && c.opp[1] === 'C';
        return friend ? c.oppLast : 'D';
      } },
    { id: 'coop80', name: 'Оптимист 80/20', tag: 'C80',
      desc: 'Сотрудничает в 80% случаев, не глядя на соперника. Похож на доброго, но непредсказуемого человека.',
      play: (c) => (c.rng() < 0.8 ? 'C' : 'D') },
    { id: 'maj5', name: 'Последние пять', tag: 'MAJ5',
      desc: 'Сотрудничает, если соперник сотрудничал хотя бы в 3 из 5 последних раундов. Помнит недавнее, забывает старое.',
      play: (c) => (c.round === 0 || count(c.opp.slice(-5), 'C') * 2 > Math.min(5, c.opp.length) ? 'C' : 'D') },
    { id: 'forgiving_grim', name: 'Отходчивый', tag: 'FGRM',
      desc: 'После предательства соперника наказывает 4 раунда подряд, потом снова сотрудничает.',
      play: (c) => {
        const m = c.mem;
        if (c.oppLast === 'D' && !(m.until > c.round)) m.until = c.round + 4;
        return m.until > c.round ? 'D' : 'C';
      } },
    { id: 'endgame_grim', name: 'Злопамятный с финалом', tag: 'GRM-E',
      desc: 'Злопамятный, который ещё и предаёт в последнем раунде, если знает длину матча.',
      play: (c) => (isLast(c) || c.opp.includes('D') ? 'D' : 'C') },
    { id: 'extortion', name: 'Вымогатель', tag: 'ZD',
      desc: 'Стратегия Пресса и Дайсона: с выверенными вероятностями сотрудничает так, что всегда получает больше соперника. Побеждает в матчах, но проигрывает по сумме.',
      play: (c) => {
        if (c.round === 0) return 'C';
        return c.rng() < PAIR_P[c.myLast + c.oppLast] ? 'C' : 'D';
      } },
    { id: 'reinforce', name: 'Обучение с подкреплением', tag: 'RL',
      desc: 'Сравнивает, сколько в среднем получал после C и после D (за этот и следующий раунд), и выбирает лучшее; в 10% случаев пробует другое.',
      play: (c) => {
        const k = c.round;
        if (k < 4) return ['C', 'D', 'C', 'C'][k];
        if (c.rng() < 0.1) return c.rng() < 0.5 ? 'C' : 'D';
        const v = { C: [0, 0], D: [0, 0] };
        for (let i = 1; i < k; i++) { const a = c.my[i - 1]; v[a][0] += c.myPay[i - 1] + c.myPay[i]; v[a][1]++; }
        const mc = v.C[1] ? v.C[0] / v.C[1] : Infinity, md = v.D[1] ? v.D[0] / v.D[1] : Infinity;
        return mc >= md ? 'C' : 'D';
      } },
  );

  const tdBest = (c, ys) => {
    const L = c.params.min, U = c.params.max, R = c.params.bonus;
    let best = U, bv = -Infinity;
    for (let x = L; x <= U; x++) {
      let s = 0;
      for (const y of ys) s += x === y ? x : x < y ? x + R : y - R;
      if (s > bv) { bv = s; best = x; }
    }
    return best;
  };
  travelers.push(
    { id: 'adaptive', name: 'Адаптивный', desc: 'Проверяет, реагирует ли соперник на его числа. С реагирующими держит максимум (не запускает спираль), фиксированных подрезает на 1, в последнем раунде подрезает прогноз.',
      play: (c) => {
        const L = c.params.min, U = c.params.max, R = c.params.bonus, k = c.round, my = c.my, op = c.opp;
        if (R <= 1 || k < 2) return U;
        const from = Math.max(1, k - 10), diffs = [];
        for (let i = from; i < k; i++) diffs.push(op[i] - my[i - 1]);
        const d = median(diffs);
        let eC = 0, eS = 0;
        for (let i = from; i < k; i++) { eC += Math.abs(op[i] - op[i - 1]); eS += Math.abs(op[i] - (my[i - 1] + d)); }
        eC /= diffs.length; eS /= diffs.length;
        const reactive = eS < eC || (eS === eC && d >= 0);
        const noisy = Math.min(eS, eC) > (U - L) / 10;
        if (isLast(c)) return tdBest(c, [reactive ? clamp(my[k - 1] + d, L, U) : op[k - 1]]);
        if (noisy) return tdBest(c, op.slice(-20));
        if (reactive) return U;
        return tdBest(c, op.slice(-5));
      } },
    { id: 'reset_undercut', name: 'Подрезка со сбросом', desc: 'Называет «число соперника − 1», но если соперник три раза подряд назвал меньше — возвращается к максимуму. Бот команды 6SOT с хакатона.',
      play: (c) => {
        const m = c.mem, L = c.params.min, U = c.params.max;
        if (c.round === 0) { m.drops = 0; return U; }
        if (c.oppLast < c.myLast) m.drops++; else m.drops = 0;
        if (m.drops >= 3) { m.drops = 0; return U; }
        return clamp(c.oppLast - 1, L, U);
      } },
    { id: 'reset_undercut_pro', name: 'Подрезка со сбросом и финишем', desc: 'Как «Подрезка со сбросом», плюс: если соперник трижды назвал минимум — сам переходит на минимум; в последних 5 раундах не прощает.',
      play: (c) => {
        const m = c.mem, L = c.params.min, U = c.params.max, i = c.round - 1;
        if (c.round === 0) { m.drops = 0; m.stuck = 0; return U; }
        if (c.oppLast < c.myLast) m.drops++; else m.drops = 0;
        if (c.oppLast === L) m.stuck++; else m.stuck = 0;
        if (m.stuck >= 3) return L;
        if (m.drops >= 3 && (c.rounds == null || i < c.rounds - 5)) { m.drops = 0; return U; }
        return clamp(c.oppLast - 1, L, U);
      } },
    { id: 'fixed90', name: 'Шаблон 90', desc: 'Всегда называет 90 — так выглядел шаблон организаторов. Легко эксплуатируется: ответ 89 даёт сопернику 91.',
      play: (c) => clamp(90, c.params.min, c.params.max) },
    { id: 'floor80', name: 'С полом 80', desc: 'Подрезает соперника на 1, но никогда не опускается ниже 80. Ограничивает спираль вниз.',
      play: (c) => (c.oppLast === undefined ? c.params.max : Math.max(80, c.oppLast - 1)) },
    { id: 'best_reply', name: 'Лучший ответ', desc: 'Считает, какое число принесло бы больше всего против всех прошлых чисел соперника, и называет его (фиктивная игра).',
      play: (c) => (c.round === 0 ? c.params.max : tdBest(c, c.opp)) },
    { id: 'punisher', name: 'Каратель', desc: 'Держит максимум; если соперник подрезал — три раунда называет минимум в наказание, потом прощает.',
      play: (c) => {
        const m = c.mem;
        if (c.oppLast !== undefined && c.oppLast < c.myLast) m.until = c.round + 3;
        return m.until > c.round ? c.params.min : c.params.max;
      } },
    { id: 'grim', name: 'Злопамятный', desc: 'Держит максимум, пока соперник ни разу не назвал меньше максимума. После этого — минимум навсегда.',
      play: (c) => (c.opp.some((x) => x < c.params.max) ? c.params.min : c.params.max) },
    { id: 'peacemaker', name: 'Миротворец', desc: 'Подрезает на 1, но если оба опустились ниже 90 — возвращается к максимуму и держит его 3 раунда, чтобы разорвать спираль.',
      play: (c) => {
        const m = c.mem, U = c.params.max;
        if (m.hold > c.round) return U;
        if (c.oppLast === undefined) return U;
        if (c.oppLast < 90 && c.myLast < 90) { m.hold = c.round + 3; return U; }
        return clamp(c.oppLast - 1, c.params.min, U);
      } },
    { id: 'random_high', name: 'Случайный высокий', desc: 'Случайное число от 80 до 100. Добрый, но непредсказуемый.',
      play: (c) => clamp(80 + Math.floor(c.rng() * 21), c.params.min, c.params.max) },
    { id: 'level2', name: 'Думает на 2 шага', desc: 'Рассуждает: «соперник назовёт 99, чтобы подрезать 100, значит я назову 98». Всегда максимум − 2.',
      play: (c) => clamp(c.params.max - 2, c.params.min, c.params.max) },
    { id: 'holder', name: 'Держатель', desc: 'Называет максимум, пока соперник держится от 95; иначе называет ровно его число, но не подрезает.',
      play: (c) => (c.oppLast === undefined || c.oppLast >= 95 ? c.params.max : c.oppLast) },
  );

  const pgResponds = (my, op, full) => {
    const t = op.length, a = [], b = [];
    for (let i = Math.max(1, t - 12); i < t; i++) { a.push(my[i - 1]); b.push(op[i]); }
    if (!a.length) return true;
    const ma = avg(a), mb = avg(b);
    if (mb >= full - 1) return true;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    if (saa < 1e-9 || sbb < 1e-9) return false;
    return sab / Math.sqrt(saa * sbb) > 0.3;
  };
  const pgAdaptive = (probe) => (c) => {
    const E = c.params.endowment, mlt = c.params.multiplier, k = c.round, my = c.my, op = c.opp, m = c.mem;
    if (mlt >= 2) return E;
    if (mlt <= 1) return 0;
    if (isLast(c)) return 0;
    if (k === 0) return E;
    if (probe) {
      if (k === 2 && op[0] === E && op[1] === E) return 0;
      if ((k === 3 || k === 4) && my[2] === 0) return E;
      if (k === 5 && my[2] === 0 && op[2] === E && op[3] === E && op[4] === E) m.push = true;
      if (m.push) { if (op[k - 1] < E) m.push = false; else return 0; }
      if (k <= 5 && my[2] === 0) return Math.min(E, op[k - 1]);
    }
    if (op[k - 1] >= E) return E;
    if (k >= 10 && !pgResponds(my, op, E)) return 0;
    if (k % 4 === 0) return E;
    return Math.min(E, op[k - 1]);
  };
  publicGoods.push(
    { id: 'adaptive', name: 'Адаптивный', desc: 'Зеркалит вклад соперника и периодически предлагает полный вклад; тем, кто не реагирует на его вклады, перестаёт давать; в последнем раунде вкладывает 0. При m ≥ 2 всегда вкладывает всё.',
      play: pgAdaptive(false) },
    { id: 'adaptive_probe', name: 'Адаптивный с зондом', desc: 'Как «Адаптивный», но на третьем ходу один раз ничего не вкладывает. Если соперник продолжил вкладывать всё — доит его, пока тот не ответит.',
      play: pgAdaptive(true) },
    { id: 'mirror_end', name: 'Зеркало с финалом', desc: 'Условный кооператор, который в последнем раунде вкладывает 0. На хакатоне так играли лидеры раунда.',
      play: (c) => (isLast(c) ? 0 : c.oppLast === undefined ? c.params.endowment : c.oppLast) },
    { id: 'hard_reciprocal', name: 'Жёсткий взаимный', desc: 'Вкладывает всё, если соперник в прошлый раз вложил почти всё (не меньше максимума − 2), иначе 0.',
      play: (c) => (c.oppLast === undefined || c.oppLast >= c.params.endowment - 2 ? c.params.endowment : 0) },
    { id: 'forgiving', name: 'Отходчивый', desc: 'Вкладывает всё; если соперник вложил меньше половины — 3 раунда не вкладывает ничего, потом прощает.',
      play: (c) => {
        const m = c.mem;
        if (c.oppLast !== undefined && c.oppLast < c.params.endowment / 2) m.until = c.round + 3;
        return m.until > c.round ? 0 : c.params.endowment;
      } },
    { id: 'halfway_up', name: 'Тянущий вверх', desc: 'Вкладывает середину между прошлым вкладом соперника и максимумом: прощает и мягко зовёт к полному вкладу.',
      play: (c) => (c.oppLast === undefined ? c.params.endowment : Math.round((c.oppLast + c.params.endowment) / 2)) },
    { id: 'cautious', name: 'Осторожный', desc: 'Начинает с половины. Если соперник вложил не меньше — повышает на 2, иначе опускается до его вклада.',
      play: (c) => {
        if (c.myLast === undefined) return Math.floor(c.params.endowment / 2);
        return c.oppLast >= c.myLast ? Math.min(c.params.endowment, c.myLast + 2) : c.oppLast;
      } },
    { id: 'trend', name: 'Трендовый', desc: 'Продлевает тренд соперника: прошлый вклад плюс последнее изменение. Быстро падает вместе с падающими.',
      play: (c) => {
        const o = c.opp, n = o.length;
        if (n === 0) return c.params.endowment;
        if (n === 1) return o[0];
        return clamp(o[n - 1] + (o[n - 1] - o[n - 2]), 0, c.params.endowment);
      } },
    { id: 'three_quarters', name: 'Три четверти', desc: 'Всегда вкладывает 75% капитала: щедрый, но не до конца.',
      play: (c) => Math.round(c.params.endowment * 0.75) },
    { id: 'late_rider', name: 'Поздний безбилетник', desc: 'Первую половину матча вкладывает всё, вторую — ничего. Если длина скрыта, перестаёт после 25 раундов.',
      play: (c) => (c.round < (c.rounds == null ? 25 : c.rounds / 2) ? c.params.endowment : 0) },
    { id: 'majority', name: 'Большинство', desc: 'Вкладывает всё, если соперник хотя бы в половине раундов вкладывал от половины капитала, иначе 0.',
      play: (c) => (c.opp.length === 0 || c.opp.filter((x) => x >= c.params.endowment / 2).length * 2 >= c.opp.length ? c.params.endowment : 0) },
    { id: 'one_less', name: 'Минус один', desc: 'Вкладывает на 1 меньше, чем соперник в прошлый раз. Выигрывает матч «на волосок», но тянет обоих вниз.',
      play: (c) => (c.oppLast === undefined ? c.params.endowment : Math.max(0, c.oppLast - 1)) },
  );

  const towShare = (c) => c.state.myEnergy / Math.max(1, remaining(c, 10));
  tugOfWar.push(
    { id: 'adaptive', name: 'Адаптивный', desc: 'Выбирает модель соперника (поровну, как в прошлый раз, половина, копит, большинство), прогнозирует его траты и покупает самые дешёвые раунды за «прогноз + 1». Видит, когда у соперника пусто.',
      play: (c) => {
        const m = c.mem;
        m.oe = m.oe || [];
        m.oe[c.round] = c.state.oppEnergy;
        const me = Math.floor(c.state.myEnergy), oe = Math.floor(c.state.oppEnergy), rg = c.state.regen || 0;
        const l = Math.max(1, remaining(c, 10)), n = c.round + l, k = c.round, op = c.opp;
        if (me <= 0) return 0;
        if (c.rounds != null && l === 1) return me;
        if (oe <= 0) return 1;
        if (rg === 0 && me >= (oe + 1) * l) return oe + 1;
        const md = (id, e, ll, h) => {
          if (id === 0) return Math.floor(e / ll);
          if (id === 1) return h.length ? Math.min(e, h[h.length - 1]) : Math.floor(e / ll);
          if (id === 2) return ll === 1 ? e : Math.floor(e / 2);
          if (id === 3) return ll === 1 ? e : 0;
          const need = Math.floor(n / 2) + 1, done = n - ll;
          return done < need ? Math.floor(e / (need - done)) : 0;
        };
        let bm = 0, be = Infinity;
        for (let id = 0; id < 5; id++) {
          let err = 0;
          for (let i = 0; i < k; i++) err += Math.abs(md(id, Math.floor(m.oe[i]), n - i, op.slice(0, i)) - op[i]);
          if (err < be - 1e-9) { be = err; bm = id; }
        }
        const cost = [];
        let e = oe;
        const h = op.slice();
        for (let j = 0; j < l; j++) {
          const x = Math.max(0, Math.min(e, md(bm, e, l - j, h)));
          cost.push(x + 1); h.push(x);
          e = Math.min(c.state.maxEnergy, e - x + rg);
        }
        const ids = cost.map((_, j) => j).sort((a, b) => cost[a] - cost[b] || a - b);
        let budget = me + rg * (l - 1), chosen = 0;
        const win = new Array(l).fill(false);
        for (const j of ids) if (cost[j] <= budget) { budget -= cost[j]; win[j] = true; chosen++; }
        if (!win[0]) return 0;
        return Math.min(me, cost[0] + (chosen ? Math.floor(budget / chosen) : 0));
      } },
    { id: 'majority_buyer', name: 'Покупатель большинства', desc: 'Делит всю энергию поровну на первые n/2 + 1 раундов, остальные отдаёт: ему нужна победа в матче, а не счёт.',
      play: (c) => {
        const n = c.rounds == null ? 10 : c.rounds, need = Math.floor(n / 2) + 1;
        return c.round < need ? Math.floor(c.state.myEnergy / (need - c.round)) : 0;
      } },
    { id: 'save_last', name: 'Копит на конец', desc: 'Ничего не тратит до последнего раунда, в последнем — всё. Если длина скрыта, так и не потратит.',
      play: (c) => (isLast(c) ? c.state.myEnergy : 0) },
    { id: 'half_left', name: 'Половина остатка', desc: 'Каждый раунд тратит половину оставшейся энергии: сильный старт, быстро слабеет.',
      play: (c) => (isLast(c) ? c.state.myEnergy : Math.floor(c.state.myEnergy / 2)) },
    { id: 'equal_plus', name: 'Равномерный + 1', desc: 'Тратит поровну на оставшиеся раунды плюс 1 — создан, чтобы бить «Равномерного».',
      play: (c) => Math.min(c.state.myEnergy, Math.floor(towShare(c)) + 1) },
    { id: 'front_load', name: 'Сильный старт', desc: 'Первую треть матча тратит вдвое больше средней доли, потом поровну то, что осталось.',
      play: (c) => {
        const n = c.rounds == null ? 10 : c.rounds;
        return Math.floor(towShare(c) * (c.round < n / 3 ? 2 : 1));
      } },
    { id: 'back_load', name: 'Сильный финиш', desc: 'Первую половину матча тратит половину средней доли, во второй — поровну всё накопленное.',
      play: (c) => {
        if (isLast(c)) return c.state.myEnergy;
        const n = c.rounds == null ? 10 : c.rounds;
        return Math.floor(towShare(c) * (c.round < n / 2 ? 0.5 : 1));
      } },
    { id: 'mirror', name: 'Зеркало', desc: 'Тратит столько же, сколько соперник в прошлом раунде. С равномерными сводит в ничью.',
      play: (c) => (c.oppLast === undefined ? Math.floor(towShare(c)) : Math.min(c.state.myEnergy, c.oppLast)) },
    { id: 'sniper', name: 'Снайпер', desc: 'Тратит чуть меньше средней доли, но как только у соперника остаётся мало энергии — ставит «его энергия + 1» и гарантированно забирает раунд.',
      play: (c) => {
        const oe = Math.floor(c.state.oppEnergy), sh = towShare(c);
        if (oe + 1 <= c.state.myEnergy && oe + 1 <= 2 * sh) return oe + 1;
        return Math.floor(sh * 0.8);
      } },
    { id: 'noisy_even', name: 'Равномерный с шумом', desc: 'Средняя доля ± 30% случайно. Его трудно предсказать и перебить ровно на 1.',
      play: (c) => (isLast(c) ? c.state.myEnergy : Math.floor(towShare(c) * (0.7 + 0.6 * c.rng()))) },
    { id: 'counter_even', name: 'Контра равномерного', desc: 'Считает, что соперник тратит поровну, и ставит его долю + 1, если это не дороже полутора своих долей; иначе отдаёт раунд за 0.',
      play: (c) => {
        const l = Math.max(1, remaining(c, 10));
        if (isLast(c)) return c.state.myEnergy;
        const want = Math.floor(c.state.oppEnergy / l) + 1;
        return want <= 1.5 * towShare(c) ? want : 0;
      } },
  );

  const theirOffers = (c) => c.state.deals.filter((d) => !d.iProposed).map((d) => d.offer);
  const theirThreshold = (c) => { const d = c.state.deals.filter((x) => x.iProposed); return d.length ? d[d.length - 1].threshold : null; };
  ultimatum.push(
    { id: 'adaptive', name: 'Адаптивный', desc: 'Видит в истории, сколько соперник требует, и предлагает ровно это + 5 (не меньше 15). Принимает от 20, но если соперник сам предлагает меньше 20 — требует 30.',
      play: (c) => {
        const t = theirThreshold(c), offers = theirOffers(c);
        const stingy = offers.length >= 3 && avg(offers.slice(-3)) < 20;
        return { offer: t == null ? 45 : Math.max(15, t + 5), accept: stingy ? 30 : 20 };
      } },
    { id: 'mind_reader', name: 'Знающий порог', desc: 'Предлагает ровно тот минимум, который соперник требовал в прошлый раз, — ни монетой больше. Принимает от 30.',
      play: (c) => { const t = theirThreshold(c); return { offer: t == null ? 40 : t, accept: 30 }; } },
    { id: 'generous', name: 'Щедрый', desc: 'Предлагает 60, принимает что угодно от 10.',
      play: () => ({ offer: 60, accept: 10 }) },
    { id: 'stubborn', name: 'Упрямый', desc: 'Предлагает 30, а сам принимает только от 45. Часто остаётся ни с чем.',
      play: () => ({ offer: 30, accept: 45 }) },
    { id: 'tough_then_fair', name: 'Сначала жёсткий', desc: 'Первые 10 раундов предлагает 20 и требует 50, потом смягчается до 50 / 40.',
      play: (c) => (c.round < 10 ? { offer: 20, accept: 50 } : { offer: 50, accept: 40 }) },
    { id: 'punisher', name: 'Каратель', desc: 'Предлагает 50, принимает от 40. Если соперник предложил меньше 30 — три раунда требует 60.',
      play: (c) => {
        const m = c.mem, o = theirOffers(c);
        if (o.length && o[o.length - 1] < 30 && m.seen !== o.length) { m.until = c.round + 3; m.seen = o.length; }
        return { offer: 50, accept: m.until > c.round ? 60 : 40 };
      } },
    { id: 'fair_end', name: 'Честный с финалом', desc: 'Играет 50 / 40, но в последних двух раундах предлагает 1 — если знает длину матча.',
      play: (c) => (c.rounds != null && c.rounds - c.round <= 2 ? { offer: 1, accept: 40 } : { offer: 50, accept: 40 }) },
    { id: 'random_fair', name: 'Случайно-справедливый', desc: 'Предлагает случайно от 35 до 55, принимает случайно от 25 до 40. Похож на живого человека.',
      play: (c) => ({ offer: 35 + Math.floor(c.rng() * 21), accept: 25 + Math.floor(c.rng() * 16) }) },
  );

  dollarAuction.push(
    { id: 'adaptive', name: 'Адаптивный', desc: 'Помнит, до какой ставки соперник доходил в прошлых аукционах, и сразу ставит на 5 больше (но не выше приза − 10). Если соперник уже задирал ставки выше приза — не связывается.',
      play: (c) => {
        const s = c.state, h = s.history;
        if (h.some((x) => x.oppBid >= s.prize)) return s.myBid === 0 && s.oppBid === 0 ? 1 : 0;
        const lim = h.length ? clamp(Math.max(...h.map((x) => x.oppBid)) + 5, 10, s.prize - 10) : Math.floor(s.prize / 2);
        return s.myBid === 0 && s.oppBid < lim ? lim : 0;
      } },
    { id: 'last_word', name: 'Последнее слово', desc: 'Считает ходы до лимита: если последняя ставка будет за ним — воюет шагом +1, пока это выгоднее паса; иначе ставит 1 и уходит.',
      play: (c) => {
        const s = c.state;
        if (s.movesLeft % 2 === 1 && s.prize - (s.oppBid + 1) > -s.myBid && s.oppBid + 1 <= s.cap) return s.oppBid + 1;
        return s.myBid === 0 && s.oppBid === 0 ? 1 : 0;
      } },
    { id: 'min_raise', name: 'Шаг в единицу', desc: 'Перебивает на 1, пока ставка не выше половины приза. Шаблон организаторов хакатона.',
      play: (c) => (c.state.oppBid + 1 <= c.state.prize / 2 ? c.state.oppBid + 1 : 0) },
    { id: 'deterrent', name: 'Сдерживатель', desc: 'Первой ставкой сразу прыгает на 60, чтобы отпугнуть. Если его перебили — пасует.',
      play: (c) => (c.state.myBid === 0 && c.state.oppBid < 60 ? 60 : 0) },
    { id: 'turn_taker', name: 'Очередник', desc: 'Ставит 1 в аукционах, которые начинает сам, и пасует в чужих: предлагает делить призы по очереди почти бесплатно.',
      play: (c) => (c.state.iStarted && c.state.myBid === 0 && c.state.oppBid === 0 ? 1 : 0) },
    { id: 'grudge_turn', name: 'Злопамятный очередник', desc: 'Делит призы по очереди, пока соперник не перебил его хоть раз. После этого в каждом аукционе прыгает на 99.',
      play: (c) => {
        const s = c.state;
        const angry = s.history.some((x) => x.myBid > 0 && x.oppBid > x.myBid);
        if (angry) return s.myBid === 0 && s.oppBid < 99 ? 99 : 0;
        return s.iStarted && s.myBid === 0 && s.oppBid === 0 ? 1 : 0;
      } },
    { id: 'limit75', name: 'Порог 75', desc: 'Перебивает на 5, пока ставка не выше 75. Готов переплатить за приз, но не уходит в убыток.',
      play: (c) => (c.state.oppBid + 5 <= 75 ? c.state.oppBid + 5 : 0) },
    { id: 'random_jump', name: 'Случайный прыжок', desc: 'В каждом аукционе выбирает случайную ставку от 30 до 90, ставит её один раз и больше не перебивает.',
      play: (c) => {
        const s = c.state, m = c.mem;
        if (m.auction !== s.auction) { m.auction = s.auction; m.j = 30 + Math.floor(c.rng() * 61); }
        return s.myBid === 0 && s.oppBid < m.j ? m.j : 0;
      } },
  );

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
