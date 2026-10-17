// Live data. Asks the site's own function first (small, cached, already cleaned) and falls back
// to ESPN directly from the browser, cleaned by the same code, when the function is missing
// (for example when the site was uploaded without functions).
import { SPORTS } from './engine.js';
import * as X from './espn.js';

let base = '/api';
let directOnly = false;

export function configureFeed(opts = {}) {
  if (opts.base) base = opts.base;
  if (opts.directOnly != null) directOnly = !!opts.directOnly;
}

async function getJson(url, ms = 9000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const res = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('Not JSON');
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function viaFunction(params) {
  if (directOnly) throw new Error('direct only');
  const q = new URLSearchParams(params).toString();
  return getJson(`${base}/espn?${q}`);
}

// Games on a date for a sport: [{...game}]
export async function scoreboard(sport, date, groups) {
  try {
    const r = await viaFunction({ sport, kind: 'scoreboard', ...(date ? { date } : {}), ...(groups ? { groups } : {}) });
    return r.games || [];
  } catch (e) {
    if (e && e.status === 400) throw e;
    const gs = groups ? groups.split(',') : X.DEFAULT_GROUPS[sport] || [null];
    const lists = await Promise.all(gs.map((g) => getJson(X.scoreboardUrl(sport, date, g)).then((raw) => X.normalizeScoreboard(raw, sport))));
    const seen = new Map();
    for (const g of lists.flat()) seen.set(g.id, g);
    return [...seen.values()];
  }
}

// One game with its box score: { game, players }
export async function summary(sport, eventId) {
  try {
    const r = await viaFunction({ sport, kind: 'summary', event: eventId });
    return { game: r.game, players: r.players || {} };
  } catch (e) {
    if (e && e.status === 400) throw e;
    const raw = await getJson(X.summaryUrl(sport, eventId));
    return X.normalizeSummary(raw, sport);
  }
}

export async function roster(sport, teamId) {
  try {
    const r = await viaFunction({ sport, kind: 'roster', team: teamId });
    return r.players || [];
  } catch (e) {
    if (e && e.status === 400) throw e;
    const raw = await getJson(X.rosterUrl(sport, teamId));
    return X.normalizeRoster(raw);
  }
}

// Book prices from The Odds API through the site's function (needs the passcode).
export async function liveOdds(sport, game, passcode) {
  const q = new URLSearchParams({ sport, home: game.home.name, away: game.away.name });
  const res = await fetch(`${base}/odds?${q}`, { headers: { 'x-sweat-passcode': passcode || '' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Which optional features the site has keys for: { slip, odds }. Off when the site has no
// functions (a drag-and-drop upload) or the check fails.
export async function status() {
  try {
    const r = await getJson(`${base}/status`, 5000);
    return { slip: r.slip === true, odds: r.odds === true };
  } catch {
    return { slip: false, odds: false };
  }
}

// Bet slip reader (Claude) through the site's function.
export async function readSlip({ text, image, passcode, today }) {
  const res = await fetch(`${base}/slip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sweat-passcode': passcode || '' },
    body: JSON.stringify({ text, image, today }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Which requests keep a set of open bets current. NFL, NBA and UFC share one scoreboard per
// day; college games are fetched one at a time (their scoreboards list hundreds of games).
// Box scores are fetched only for games with player props.
export function plan(bets) {
  const boards = new Map();
  const summaries = new Map();
  for (const b of bets) {
    for (const l of b.legs || []) {
      if (!l.eventId || !SPORTS[l.sport]) continue;
      const t = l.start ? new Date(l.start) : null;
      const day = /^\d{8}$/.test(l.date || '') ? l.date : t && Number.isFinite(t.getTime()) ? X.espnDate(t) : null;
      const college = l.sport === 'cfb' || l.sport === 'ncaab';
      if (college || l.market === 'prop') summaries.set(`${l.sport}|${l.eventId}`, { sport: l.sport, eventId: l.eventId });
      if (!college) boards.set(`${l.sport}|${day || ''}`, { sport: l.sport, date: day });
    }
  }
  return { boards: [...boards.values()], summaries: [...summaries.values()] };
}
