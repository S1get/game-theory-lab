// Быстрая проверка движка: node test/engine.test.js
'use strict';
const assert = require('assert');
require('../public/js/games.js');
require('../public/js/strategies.js');
require('../public/js/engine.js');
const GT = globalThis.GT;

const pd = GT.getGame('dilemma');
const bot = (g, id) => GT.strategiesFor(g).find((s) => s.id === id);

// TFT против ALLD: 0 в первом раунде, дальше взаимное предательство
const m = GT.runMatch(pd, bot('dilemma', 'tit_for_tat'), bot('dilemma', 'always_d'), { rounds: 200 });
assert.deepStrictEqual(m.score, [199, 209]);

// Каждая игра: полный круговой турнир всех встроенных ботов без ошибок
for (const g of GT.gameList()) {
  const bots = GT.strategiesFor(g.id);
  const results = GT.schedule(bots.length, 2, true).map((p, k) => {
    const mm = GT.runMatch(g, bots[p.a], bots[p.b], { seed: k + 1, noise: 0.02 });
    assert.deepStrictEqual(mm.errors, [0, 0], `${g.id}: ${bots[p.a].id} vs ${bots[p.b].id}: ${mm.lastError}`);
    assert.ok(GT.matchUnits(g, mm).length === mm.units, `${g.id}: units`);
    return Object.assign({ a: p.a, b: p.b, gameId: g.id }, GT.summary(mm));
  });
  const st = GT.standings(bots.length, results);
  const top = st.rows.slice().sort((a, b) => a.place - b.place).slice(0, 3).map((r) => bots[r.i].name);
  const evo = GT.evolution(st.matrix, 100);
  assert.ok(Math.abs(evo[100].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  console.log(`${g.id.padEnd(18)} матчей ${String(results.length).padStart(3)} · топ-3: ${top.join(', ')}`);
}

// Скрытая длина и детерминизм
const h1 = GT.runMatch(pd, bot('dilemma', 'random'), bot('dilemma', 'pavlov'), { seed: 42, hidden: true });
const h2 = GT.runMatch(pd, bot('dilemma', 'random'), bot('dilemma', 'pavlov'), { seed: 42, hidden: true });
assert.deepStrictEqual(h1.score, h2.score);

// Пользовательский код
const custom = { play: GT.compile("function play(ctx){ return ctx.round % 3 ? 'C' : 'D'; }") };
assert.ok(GT.runMatch(pd, custom, bot('dilemma', 'grim'), {}).score[1] > 0);
assert.deepStrictEqual(GT.places([5, 7, 7, 1]), [3, 1, 1, 4]);
console.log('OK');
