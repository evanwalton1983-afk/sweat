// GET /api/espn?sport=nfl&kind=scoreboard&date=YYYYMMDD[&groups=80,81]
// GET /api/espn?sport=nba&kind=summary&event=401873344
// GET /api/espn?sport=nba&kind=roster&team=18
// Fetches ESPN's public site API, cleans it to Sweat's game shape and lets Netlify's CDN cache
// it briefly, so a phone polling every 15 seconds gets a few KB instead of half a megabyte.
import { SPORTS } from '../../src/engine.js';
import * as X from '../../src/espn.js';

const UA = 'Mozilla/5.0 (compatible; SweatApp/1.0)';

function reply(body, status = 200, cacheSec = 0) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
  if (cacheSec > 0) {
    // Phones always ask again; Netlify's edge answers repeat questions for a few seconds.
    headers['cache-control'] = 'public, max-age=0, must-revalidate';
    headers['netlify-cdn-cache-control'] = `public, s-maxage=${cacheSec}, stale-while-revalidate=${cacheSec * 2}`;
    headers['netlify-vary'] = 'query';
  } else {
    headers['cache-control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') || '';
  const kind = url.searchParams.get('kind') || 'scoreboard';
  if (!SPORTS[sport]) return reply({ error: 'Unknown sport' }, 400);
  const fetchedAt = new Date().toISOString();
  try {
    if (kind === 'scoreboard') {
      const date = url.searchParams.get('date') || '';
      if (date && !/^\d{8}$/.test(date)) return reply({ error: 'Date must be YYYYMMDD' }, 400);
      const raw = url.searchParams.get('groups');
      const groups = raw ? raw.split(',').filter((g) => /^\d{1,3}$/.test(g)).slice(0, 3) : X.DEFAULT_GROUPS[sport] || [null];
      const lists = await Promise.all(groups.map((g) => fetchJson(X.scoreboardUrl(sport, date, g)).then((r) => X.normalizeScoreboard(r, sport))));
      const byId = new Map();
      for (const g of lists.flat()) byId.set(g.id, g);
      const games = [...byId.values()];
      const live = games.some((g) => g.state === 'in');
      return reply({ sport, date, games, fetchedAt }, 200, live ? 8 : 30);
    }
    if (kind === 'summary') {
      const event = url.searchParams.get('event') || '';
      if (!/^\d{1,14}$/.test(event)) return reply({ error: 'Bad event id' }, 400);
      const { game, players } = X.normalizeSummary(await fetchJson(X.summaryUrl(sport, event)), sport);
      return reply({ sport, game, players, fetchedAt }, 200, game.state === 'in' ? 8 : game.state === 'pre' ? 30 : 300);
    }
    if (kind === 'roster') {
      const team = url.searchParams.get('team') || '';
      if (!/^\d{1,8}$/.test(team)) return reply({ error: 'Bad team id' }, 400);
      const players = X.normalizeRoster(await fetchJson(X.rosterUrl(sport, team)));
      return reply({ sport, team, players, fetchedAt }, 200, 3600);
    }
    return reply({ error: 'Unknown kind' }, 400);
  } catch (e) {
    return reply({ error: 'ESPN did not answer', detail: String((e && e.message) || e) }, 502);
  }
};

export const config = { path: '/api/espn' };
