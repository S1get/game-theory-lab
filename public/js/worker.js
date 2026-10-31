/*
 * Все матчи считаются здесь, а не в основном потоке: интерфейс не подвисает,
 * а зависшую пользовательскую стратегию можно убить вместе с воркером.
 */
importScripts('/js/games.js', '/js/strategies.js', '/js/engine.js');

const compiled = new Map();

// ref: { id } — встроенный бот, { id, code } — пользовательский
function resolveBot(game, ref) {
  if (ref.code != null) {
    if (!compiled.has(ref.code)) {
      let bot;
      try {
        bot = { play: GT.compile(ref.code) };
      } catch (e) {
        const msg = 'Ошибка компиляции: ' + e.message;
        bot = { play() { throw new Error(msg); } };
      }
      compiled.set(ref.code, bot);
    }
    return compiled.get(ref.code);
  }
  const bot = GT.strategies[game.kind].find((b) => b.id === ref.id);
  if (!bot) throw new Error('Неизвестный бот: ' + ref.id);
  return bot;
}

function play(spec) {
  const game = GT.getGame(spec.gameId);
  return { game, m: GT.runMatch(game, resolveBot(game, spec.a), resolveBot(game, spec.b), spec.opts) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'batch') {
    const { jobId, specs, delay } = msg;
    for (let k = 0; k < specs.length; k++) {
      let out;
      try {
        out = { summary: GT.summary(play(specs[k]).m) };
      } catch (err) {
        out = { error: String(err.message || err) };
      }
      self.postMessage(Object.assign({ type: 'result', jobId, k }, out));
      if (delay) await wait(delay);
      else if (k % 25 === 24) await wait(0);
    }
    self.postMessage({ type: 'done', jobId });
  } else if (msg.type === 'full') {
    try {
      const { game, m } = play(msg.spec);
      self.postMessage({
        type: 'full', jobId: msg.jobId,
        match: { score: m.score, units: GT.matchUnits(game, m), errors: m.errors, lastError: m.lastError, hidden: m.hidden, params: m.params },
      });
    } catch (err) {
      self.postMessage({ type: 'full', jobId: msg.jobId, error: String(err.message || err) });
    }
  }
};
