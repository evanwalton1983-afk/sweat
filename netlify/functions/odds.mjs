// GET /api/odds?sport=nfl&home=Buffalo%20Bills&away=Miami%20Dolphins
// Header x-sweat-passcode must match APP_PASSCODE. Current prices from The Odds API (pre-game
// and live) for one game, for the hedge tool. ODDS_API_KEY stays on the server.
import { createHash, timingSafeEqual } from 'node:crypto';
import { SPORTS } from '../../src/engine.js';
import { teamScore } from '../../src/espn.js';
import { livePrices } from '../lib/features.mjs';

const cache = new Map();

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// Wrong passcodes are counted per address before checking, so guessing is slow.
const misses = new Map();
const calls = new Map();
function recent(map, ip, windowMs) {
  const now = Date.now();
  const list = (map.get(ip) || []).filter((t) => now - t < windowMs);
  map.set(ip, list);
  return list;
}
function blocked(ip) {
  return recent(misses, ip, 15 * 60 * 1000).length >= 8;
}
function miss(ip) {
  recent(misses, ip, 15 * 60 * 1000).push(Date.now());
}
function busy(ip, max) {
  const list = recent(calls, ip, 10 * 60 * 1000);
  list.push(Date.now());
  return list.length > max;
}

function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

async function board(sportKey, key) {
  const hit = cache.get(sportKey);
  if (hit && Date.now() - hit.at < 20000) return hit;
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.message) || `The Odds API answered ${res.status}`);
  const out = { at: Date.now(), events: body || [], remaining: res.headers.get('x-requests-remaining'), used: res.headers.get('x-requests-used') };
  cache.set(sportKey, out);
  return out;
}

const side = (name, home, away) => (teamScore(name, { name: home, abbr: '', short: '', location: '' }) >= teamScore(name, { name: away, abbr: '', short: '', location: '' }) ? 'home' : 'away');

export default async (req) => {
  const url = new URL(req.url);
  const prices = livePrices();
  if (!prices.on) return reply({ error: 'Live prices are not set up. Add ODDS_API_KEY and APP_PASSCODE in Netlify.' }, 503);
  const key = prices.key;
  const pass = process.env.APP_PASSCODE;
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  if (blocked(ip)) return reply({ error: 'Too many wrong passcodes. Try again in 15 minutes.' }, 429);
  if (!sameSecret(req.headers.get('x-sweat-passcode') || '', pass)) {
    miss(ip);
    return reply({ error: 'Wrong passcode' }, 401);
  }
  if (busy(ip, 40)) return reply({ error: 'Too many price checks in 10 minutes. Try again shortly.' }, 429);
  const sp = SPORTS[url.searchParams.get('sport') || ''];
  const home = (url.searchParams.get('home') || '').slice(0, 80);
  const away = (url.searchParams.get('away') || '').slice(0, 80);
  if (!sp || !home || !away) return reply({ error: 'Need sport, home and away' }, 400);
  let b;
  try {
    b = await board(sp.oddsKey, key);
  } catch (e) {
    return reply({ error: String(e.message || e) }, 502);
  }
  let best = null;
  for (const ev of b.events) {
    const s = Math.max(teamScore(home, { name: ev.home_team, abbr: '', short: '', location: '' }) + teamScore(away, { name: ev.away_team, abbr: '', short: '', location: '' }),
      teamScore(home, { name: ev.away_team, abbr: '', short: '', location: '' }) + teamScore(away, { name: ev.home_team, abbr: '', short: '', location: '' }));
    if (s >= 1.2 && (!best || s > best.s)) best = { ev, s };
  }
  if (!best) return reply({ error: 'That game is not on the board right now', remaining: b.remaining }, 404);
  const ev = best.ev;
  const books = (ev.bookmakers || []).map((bk) => {
    const m = {};
    for (const mk of bk.markets || []) {
      if (mk.key === 'h2h') {
        m.moneyline = {};
        for (const o of mk.outcomes || []) {
          if (/^draw$/i.test(o.name)) m.moneyline.draw = o.price;
          else m.moneyline[side(o.name, home, away)] = o.price;
        }
      } else if (mk.key === 'spreads') {
        m.spread = {};
        for (const o of mk.outcomes || []) m.spread[side(o.name, home, away)] = { line: o.point, price: o.price };
      } else if (mk.key === 'totals') {
        m.total = {};
        for (const o of mk.outcomes || []) m.total[/^over$/i.test(o.name) ? 'over' : 'under'] = { line: o.point, price: o.price };
      }
    }
    return { book: bk.title, updated: bk.last_update, markets: m };
  });
  return reply({ home: ev.home_team, away: ev.away_team, start: ev.commence_time, books, remaining: b.remaining, used: b.used, fetchedAt: new Date(b.at).toISOString() });
};

export const config = { path: '/api/odds' };
