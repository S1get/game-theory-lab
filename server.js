'use strict';
/*
 * Сервер без зависимостей:
 *   - раздаёт статику из public/
 *   - /api/health         — проверка живости (её же дёргает антислип)
 *   - /api/live           — Server-Sent Events: непрерывный турнир ботов «Эфир»
 *   - /api/live/state     — снимок текущего турнира
 * Сайт закрыт от поисковиков: X-Robots-Tag на каждом ответе + meta robots в HTML.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

require('./public/js/games.js');
require('./public/js/strategies.js');
require('./public/js/engine.js');
const GT = globalThis.GT;

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STARTED_AT = Date.now();
const LIVE_MATCH_DELAY_MS = Number(process.env.LIVE_MATCH_DELAY_MS) || 700;
const LIVE_PAUSE_MS = Number(process.env.LIVE_PAUSE_MS) || 45000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const BASE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, BASE_HEADERS, headers));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Роутинг на клиенте (#/...), поэтому неизвестные пути — 404
      return send(res, 404, 'Not found', { 'Content-Type': MIME['.txt'] });
    }
    const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers);
    res.writeHead(200, Object.assign({}, BASE_HEADERS, headers));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ───────────────────────── Эфир: непрерывный турнир ───────────────────────── */

const live = {
  clients: new Set(),
  tournament: null,
  number: 0,
};

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of live.clients) res.write(data);
}

function broadcastViewers() {
  broadcast({ type: 'viewers', n: live.clients.size });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Каждый эфир — новый набор параметров, чтобы турниры отличались
function liveConfig(k) {
  const rnd = GT.rng(Date.now() ^ (k * 2654435761));
  const all = GT.gameList().map((g) => g.id);
  // 3–4 игры за турнир, как на соревновании
  const games = all.slice().sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 2));
  const teams = GT.teams.slice().sort(() => rnd() - 0.5).slice(0, 8 + Math.floor(rnd() * 3));
  const noise = [0, 0, 0.02, 0.05][Math.floor(rnd() * 4)];
  return { games, teams, noise, hidden: rnd() < 0.3, repeats: 2, seed: Math.floor(rnd() * 1e9) };
}

async function liveLoop() {
  for (;;) {
    const cfg = liveConfig(++live.number);
    const schedule = GT.schedule(cfg.teams.length, cfg.repeats, false);
    const t = {
      id: live.number,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      nextAt: null,
      games: cfg.games,
      teams: cfg.teams.map((x) => ({ id: x.id, name: x.name, bots: x.bots })),
      noise: cfg.noise,
      hidden: cfg.hidden,
      seed: cfg.seed,
      perGameTotal: schedule.length,
      total: schedule.length * cfg.games.length,
      results: [],
    };
    live.tournament = t;
    broadcast({ type: 'start', tournament: t });

    let k = 0;
    for (const gameId of cfg.games) {
      const game = GT.getGame(gameId);
      const bots = GT.strategies[game.kind];
      for (const pair of schedule) {
        const sa = bots.find((b) => b.id === cfg.teams[pair.a].bots[game.kind]);
        const sb = bots.find((b) => b.id === cfg.teams[pair.b].bots[game.kind]);
        const m = GT.runMatch(game, sa, sb, { seed: cfg.seed + k, noise: cfg.noise, hidden: cfg.hidden });
        const s = GT.summary(m);
        const r = { k, gameId, a: pair.a, b: pair.b, score: s.score, avg: s.avg, winner: s.winner, units: s.units };
        t.results.push(r);
        broadcast({ type: 'match', result: r });
        k++;
        await sleep(LIVE_MATCH_DELAY_MS);
      }
    }
    t.status = 'done';
    t.finishedAt = Date.now();
    t.nextAt = t.finishedAt + LIVE_PAUSE_MS;
    broadcast({ type: 'done', finishedAt: t.finishedAt, nextAt: t.nextAt });
    await sleep(LIVE_PAUSE_MS);
  }
}

function handleLive(req, res) {
  res.writeHead(200, Object.assign({}, BASE_HEADERS, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }));
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'snapshot', tournament: live.tournament, viewers: live.clients.size + 1 })}\n\n`);
  live.clients.add(res);
  broadcastViewers();
  req.on('close', () => {
    live.clients.delete(res);
    broadcastViewers();
  });
}

// Комментарий раз в 20 с не даёт прокси оборвать «тихое» SSE-соединение
setInterval(() => {
  for (const res of live.clients) res.write(': ping\n\n');
}, 20000);

/* ───────────────────────── Антислип ─────────────────────────
 * Бесплатный инстанс Render засыпает после 15 минут без входящих запросов.
 * Сервер сам стучится в свой публичный адрес (RENDER_EXTERNAL_URL Render задаёт
 * автоматически) — запрос проходит через внешний балансировщик и считается входящим.
 */
const keepalive = {
  enabled: false,
  url: null,
  intervalMin: Math.max(1, Number(process.env.KEEPALIVE_INTERVAL_MIN) || 10),
  lastPingAt: null,
  lastStatus: null,
  failures: 0,
};

function startKeepAlive() {
  const base = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base || process.env.KEEPALIVE_DISABLED === '1') {
    console.log('[keepalive] выключен: нет RENDER_EXTERNAL_URL / KEEPALIVE_URL');
    return;
  }
  keepalive.enabled = true;
  keepalive.url = base.replace(/\/+$/, '') + '/api/health?from=keepalive';
  const ping = async () => {
    try {
      const r = await fetch(keepalive.url, { headers: { 'User-Agent': 'game-theory-lab-keepalive' } });
      keepalive.lastStatus = r.status;
      keepalive.failures = r.ok ? 0 : keepalive.failures + 1;
    } catch (e) {
      keepalive.lastStatus = String(e.message || e);
      keepalive.failures++;
    }
    keepalive.lastPingAt = Date.now();
    if (keepalive.failures) console.log(`[keepalive] ошибка #${keepalive.failures}: ${keepalive.lastStatus}`);
  };
  setTimeout(ping, 60 * 1000);
  setInterval(ping, keepalive.intervalMin * 60 * 1000);
  console.log(`[keepalive] пинг ${keepalive.url} каждые ${keepalive.intervalMin} мин`);
}

/* ───────────────────────── Роутинг ───────────────────────── */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      viewers: live.clients.size,
      liveTournament: live.tournament ? { id: live.tournament.id, status: live.tournament.status, played: live.tournament.results.length, total: live.tournament.total } : null,
      keepalive: { enabled: keepalive.enabled, intervalMin: keepalive.intervalMin, lastPingAt: keepalive.lastPingAt, lastStatus: keepalive.lastStatus },
    });
  }
  if (p === '/api/live') return handleLive(req, res);
  if (p === '/api/live/state') return sendJson(res, 200, { tournament: live.tournament, viewers: live.clients.size });
  if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, p);
});

server.listen(PORT, () => {
  console.log(`Game Theory Lab: http://localhost:${PORT}`);
  startKeepAlive();
  liveLoop().catch((e) => console.error('[live] упал:', e));
});
