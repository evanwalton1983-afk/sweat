// Local test server: serves public/ and runs the real Netlify functions, with ESPN, Claude and
// The Odds API answered from the scripted timeline. GET /__step?i=N moves the night forward.
//
//   node tests/e2e/server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { espnFor } from './timeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../public');
const port = Number(process.argv[2] || 4410);

// GET /__keys?on=1 is a site with every optional feature switched on, on=0 one that added no
// keys, and on=gateway one on a Netlify plan with AI Gateway: Netlify added an Anthropic key and
// base URL by itself, the owner added only an Odds API key, and the slip reader stays off.
const KEYS = { SLIP_READER: 'on', ANTHROPIC_API_KEY: 'test-key', ODDS_API_KEY: 'test-odds' };
const GATEWAY = { ANTHROPIC_API_KEY: 'gateway-key', ANTHROPIC_BASE_URL: 'https://gateway.test/anthropic', NETLIFY_AI_GATEWAY_KEY: 'gateway-key', NETLIFY_AI_GATEWAY_URL: 'https://gateway.test', ODDS_API_KEY: 'test-odds' };
function setKeys(on) {
  for (const k of new Set([...Object.keys(KEYS), ...Object.keys(GATEWAY)])) delete process.env[k];
  Object.assign(process.env, on === '1' ? KEYS : on === 'gateway' ? GATEWAY : {});
}
process.env.APP_PASSCODE = 'test-pass';
setKeys('1');

let step = 0;
const calls = [];

const SLIP = {
  bets: [
    { book: 'FanDuel', stake: 20, odds: -110, toWin: 18.18, result: 'open', legs: [{ sport: 'nfl', market: 'spread', team: 'Miami Dolphins', opponent: 'Buffalo Bills', line: 3.5, odds: -110, segment: 'game' }] },
    { book: 'FanDuel', stake: 5, odds: 264, legs: [{ sport: 'nba', market: 'moneyline', team: 'New York Knicks', odds: -135 }, { sport: 'nfl', market: 'total', matchup: 'KC Chiefs @ LV Raiders', side: 'under', line: 44.5, odds: -110 }] },
  ],
  notes: 'Read clearly.',
};

const ODDS = [{
  id: 'x1', sport_key: 'americanfootball_nfl', commence_time: new Date().toISOString(), home_team: 'Buffalo Bills', away_team: 'Miami Dolphins',
  bookmakers: [
    { key: 'draftkings', title: 'DraftKings', last_update: new Date().toISOString(), markets: [
      { key: 'h2h', outcomes: [{ name: 'Buffalo Bills', price: -400 }, { name: 'Miami Dolphins', price: 310 }] },
      { key: 'spreads', outcomes: [{ name: 'Buffalo Bills', price: -110, point: -6.5 }, { name: 'Miami Dolphins', price: -110, point: 6.5 }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: -115, point: 44.5 }, { name: 'Under', price: -105, point: 44.5 }] },
    ] },
    { key: 'fanduel', title: 'FanDuel', last_update: new Date().toISOString(), markets: [
      { key: 'h2h', outcomes: [{ name: 'Buffalo Bills', price: -380 }, { name: 'Miami Dolphins', price: 300 }] },
      { key: 'spreads', outcomes: [{ name: 'Buffalo Bills', price: -105, point: -6.5 }, { name: 'Miami Dolphins', price: 105, point: 6.5 }] },
    ] },
  ],
}];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push(u.replace(/apiKey=[^&]+/, 'apiKey=***'));
  if (u.includes('site.api.espn.com')) {
    const body = espnFor(u, step);
    return body ? Response.json(body) : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('api.anthropic.com') || u.startsWith('https://gateway.test/')) {
    const req = JSON.parse(opts.body || '{}');
    if (!req.tools || req.tool_choice.name !== 'record_bets') return Response.json({ error: { message: 'bad request' } }, { status: 400 });
    return Response.json({ content: [{ type: 'tool_use', id: 't1', name: 'record_bets', input: SLIP }] });
  }
  if (u.includes('api.the-odds-api.com')) {
    return new Response(JSON.stringify(ODDS), { headers: { 'content-type': 'application/json', 'x-requests-remaining': '480', 'x-requests-used': '20' } });
  }
  return realFetch(url, opts);
};

const fns = {
  '/api/espn': (await import('../../netlify/functions/espn.mjs')).default,
  '/api/slip': (await import('../../netlify/functions/slip.mjs')).default,
  '/api/odds': (await import('../../netlify/functions/odds.mjs')).default,
  '/api/status': (await import('../../netlify/functions/status.mjs')).default,
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/__step') {
    step = Number(url.searchParams.get('i')) || 0;
    res.end(String(step));
    return;
  }
  if (url.pathname === '/__keys') {
    setKeys(url.searchParams.get('on'));
    res.end('ok');
    return;
  }
  if (url.pathname === '/__calls') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(calls));
    return;
  }
  const fn = fns[url.pathname];
  if (fn) {
    const body = req.method === 'POST' ? await new Promise((r) => {
      let d = '';
      req.on('data', (c) => { d += c; });
      req.on('end', () => r(d));
    }) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const out = await fn(new Request(url.toString(), { method: req.method, headers, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.join(pub, path.normalize(rel));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => console.log(`ready on ${port}`));
