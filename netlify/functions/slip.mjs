// POST /api/slip  { text?, image? (data URL), today? (YYYY-MM-DD) }
// Header x-sweat-passcode must match APP_PASSCODE. Reads a sportsbook bet slip (screenshot or
// pasted text) with Claude and returns structured bets. Off unless SLIP_READER is on (see
// ../lib/features.mjs). The key stays on the server.
import { createHash, timingSafeEqual } from 'node:crypto';
import { STATS } from '../../src/engine.js';
import { slipReader } from '../lib/features.mjs';

const MODEL = process.env.SLIP_MODEL || 'claude-sonnet-5-5';
const MAX_IMAGE_CHARS = 7_000_000;

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


const LEG = {
  type: 'object',
  properties: {
    sport: { type: 'string', enum: ['nfl', 'cfb', 'nba', 'ncaab', 'ufc'], description: 'nfl, college football (cfb), nba, men\'s college basketball (ncaab) or ufc' },
    market: { type: 'string', enum: ['spread', 'moneyline', 'total', 'team_total', 'prop'] },
    segment: { type: 'string', enum: ['game', '1h', '1q'], description: 'game unless the slip says 1st half or 1st quarter' },
    team: { type: 'string', description: 'Team or fighter picked for spread, moneyline or team total, exactly as written' },
    opponent: { type: 'string', description: 'The other team or fighter, if shown' },
    matchup: { type: 'string', description: 'The matchup line as shown, for example "MIA Dolphins @ BUF Bills"' },
    side: { type: 'string', enum: ['over', 'under', 'yes', 'no'], description: 'For totals, team totals and props. Anytime touchdown is yes' },
    line: { type: 'number', description: 'Spread with its sign (-3.5), or the total or prop number' },
    odds: { type: 'integer', description: 'American odds for this leg if shown (convert decimal odds)' },
    player: { type: 'string', description: 'Player name for props' },
    stat: { type: 'string', enum: Object.keys(STATS), description: Object.entries(STATS).map(([k, v]) => `${k}: ${v.label}`).join('; ') },
    date: { type: 'string', description: 'Game date YYYY-MM-DD if shown' },
  },
  required: ['sport', 'market'],
};

const TOOL = {
  name: 'record_bets',
  description: 'Record every bet on the slip. A parlay or same game parlay is one bet with several legs.',
  input_schema: {
    type: 'object',
    properties: {
      bets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            book: { type: 'string', description: 'Sportsbook name if visible' },
            placed: { type: 'string', description: 'Date placed, YYYY-MM-DD, if visible' },
            stake: { type: 'number', description: 'Amount risked in dollars' },
            toWin: { type: 'number', description: 'Profit if it wins, not counting the stake. If only the total payout is shown, subtract the stake' },
            odds: { type: 'integer', description: 'American odds for the whole bet (the parlay price for parlays)' },
            bonus: { type: 'boolean', description: 'True for a bonus or free bet (stake not returned)' },
            result: { type: 'string', enum: ['open', 'won', 'lost', 'push', 'void', 'cashed_out'], description: 'open unless the slip shows it settled' },
            payout: { type: 'number', description: 'For cashed out or settled bets, the amount paid back' },
            legs: { type: 'array', items: LEG },
          },
          required: ['legs'],
        },
      },
      notes: { type: 'string', description: 'Anything unreadable or uncertain, in one short plain sentence' },
    },
    required: ['bets'],
  },
};

const clean = (v) => (typeof v === 'string' ? v.replace(/[\u2013\u2014]/g, '-') : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);

export default async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);
  const claude = slipReader();
  if (!claude.on) return reply({ error: 'The slip reader is off for this site.' }, 503);
  const pass = process.env.APP_PASSCODE;
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  if (blocked(ip)) return reply({ error: 'Too many wrong passcodes. Try again in 15 minutes.' }, 429);
  if (!sameSecret(req.headers.get('x-sweat-passcode') || '', pass)) {
    miss(ip);
    return reply({ error: 'Wrong passcode' }, 401);
  }
  if (busy(ip, 30)) return reply({ error: 'Too many slips in 10 minutes. Try again shortly.' }, 429);

  let body;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Send JSON' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : '';
  const image = typeof body.image === 'string' ? body.image : '';
  if (!text && !image) return reply({ error: 'Paste a slip or add a screenshot' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return reply({ error: 'That image is too large' }, 413);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);

  const content = [];
  if (image) {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m) return reply({ error: 'Images must be PNG, JPEG, WebP or GIF' }, 400);
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({
    type: 'text',
    text: `Today is ${today}. Read this sportsbook bet slip and record every bet with the record_bets tool. `
      + 'Only NFL, college football, NBA, men\'s college basketball and UFC. Keep team and player names as written. '
      + 'Spreads keep their sign from the picked team\'s side. Leave out anything you cannot read rather than guessing.'
      + (text ? `\n\nSlip text:\n${text}` : ''),
  });

  let res;
  try {
    res = await fetch(claude.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': claude.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'record_bets' },
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    return reply({ error: e && e.name === 'TimeoutError' ? 'Reading the slip took too long. Try again.' : 'Could not reach Claude. Try again.' }, 504);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return reply({ error: (out.error && out.error.message) || `Claude answered ${res.status}` }, 502);
  const use = (out.content || []).find((c) => c.type === 'tool_use');
  if (!use) return reply({ error: 'Could not read a bet from that' }, 422);
  return reply(clean({ bets: use.input.bets || [], notes: use.input.notes || '', model: MODEL }));
};

export const config = { path: '/api/slip' };
