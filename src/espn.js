// ESPN site API responses to Sweat's game shape. Pure functions, shared by the browser and
// the Netlify function, so the phone gets small, already-cleaned games.
import { SPORTS } from './engine.js';

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// College scoreboards only list featured games unless a group is named.
// Football: 80 = FBS, 81 = FCS. Basketball: 50 = all of Division I.
export const DEFAULT_GROUPS = { cfb: ['80', '81'], ncaab: ['50'] };

export function scoreboardUrl(sport, date, group) {
  const sp = SPORTS[sport];
  if (!sp) throw new Error(`Unknown sport ${sport}`);
  const q = new URLSearchParams();
  if (date) q.set('dates', date);
  if (group) q.set('groups', group);
  if (sport === 'cfb' || sport === 'ncaab') q.set('limit', '500');
  const qs = q.toString();
  return `${ESPN_BASE}/${sp.espn}/scoreboard${qs ? `?${qs}` : ''}`;
}

export function summaryUrl(sport, eventId) {
  return `${ESPN_BASE}/${SPORTS[sport].espn}/summary?event=${encodeURIComponent(eventId)}`;
}

export function rosterUrl(sport, teamId) {
  return `${ESPN_BASE}/${SPORTS[sport].espn}/teams/${encodeURIComponent(teamId)}/roster`;
}

// YYYYMMDD in US Eastern time, which is how ESPN files games by day.
export function espnDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

export function shiftDate(yyyymmdd, days) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- small helpers

function num(x) {
  if (x == null || x === '') return NaN;
  if (typeof x === 'object') return num(x.value != null ? x.value : x.displayValue);
  const v = Number(String(x).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

function hex(c) {
  return typeof c === 'string' && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : '';
}

function clockSeconds(status) {
  const c = Number(status && status.clock);
  if (Number.isFinite(c)) return c;
  const d = String((status && status.displayClock) || '');
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(d);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const s = Number(d);
  return Number.isFinite(s) ? s : 0;
}

const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Does every letter of `token` appear in order in `word`? ("NEWMEXST" in "NEWMEXICOSTATE")
function subsequence(token, word) {
  let i = 0;
  for (const ch of word) if (ch === token[i]) i++;
  return token.length > 0 && i === token.length;
}

function tokenMatches(token, team) {
  const t = squash(token);
  if (!t || !team) return false;
  if (t === squash(team.abbr)) return true;
  return [team.location, team.name, team.short].some((w) => w && squash(w).startsWith(t.slice(0, 3)) && subsequence(t, squash(w)));
}

// ---------------------------------------------------------------- teams, odds, situation

function sideFrom(c, i) {
  const t = c.team || {};
  const a = c.athlete || {};
  const name = t.displayName || a.displayName || a.fullName || t.name || '';
  const last = (a.shortName || a.displayName || '').split(' ').slice(-1)[0];
  const ls = Array.isArray(c.linescores) ? c.linescores.map((l) => num(l.value != null ? l.value : l.displayValue)).map((v) => (Number.isFinite(v) ? v : 0)) : [];
  const record = Array.isArray(c.records) ? c.records[0] : Array.isArray(c.record) ? c.record[0] : null;
  const rank = c.curatedRank && Number(c.curatedRank.current) > 0 && Number(c.curatedRank.current) < 99 ? Number(c.curatedRank.current) : null;
  return {
    id: String(t.id || a.id || c.id || i),
    abbr: t.abbreviation || (last ? last.slice(0, 12).toUpperCase() : '') || `T${i}`,
    name,
    short: t.shortDisplayName || t.name || a.shortName || name,
    location: t.location || '',
    color: hex(t.color),
    alt: hex(t.alternateColor),
    logo: t.logo || (Array.isArray(t.logos) && t.logos[0] ? t.logos[0].href : '') || '',
    flag: a.flag && a.flag.href ? a.flag.href : '',
    score: Number.isFinite(num(c.score)) ? num(c.score) : 0,
    linescores: ls,
    record: record ? record.summary || record.displayValue || '' : '',
    rank,
    winner: c.winner === true,
  };
}

// Home spread from an ESPN odds or pickcenter entry. The favorite flags and the "NY -2.5"
// text name the favorite; `spread` alone is the home line on pickcenter.
export function oddsFrom(o, home, away) {
  if (!o) return null;
  const details = String(o.details || '').trim();
  const m = /^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/.exec(details);
  let mag = Math.abs(num(o.spread));
  if (!Number.isFinite(mag) && m) mag = Math.abs(Number(m[2]));
  let spreadHome = null;
  const hf = o.homeTeamOdds && o.homeTeamOdds.favorite;
  const af = o.awayTeamOdds && o.awayTeamOdds.favorite;
  if (/^(EVEN|PK|PICK)/i.test(details) || mag === 0) spreadHome = 0;
  else if (Number.isFinite(mag)) {
    if (hf === true && af !== true) spreadHome = -mag;
    else if (af === true && hf !== true) spreadHome = mag;
    else if (m && home && tokenMatches(m[1], home)) spreadHome = -mag;
    else if (m && away && tokenMatches(m[1], away)) spreadHome = mag;
    else if (Number.isFinite(num(o.spread))) spreadHome = num(o.spread);
  }
  const total = num(o.overUnder);
  const ml = (side) => {
    const x = o[`${side}TeamOdds`];
    const v = x ? num(x.moneyLine) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const price = (x, k) => {
    const v = x ? num(x[k]) : NaN;
    return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
  };
  const out = {
    spreadHome: Number.isFinite(spreadHome) ? spreadHome : undefined,
    total: Number.isFinite(total) ? total : undefined,
    homeML: ml('home'),
    awayML: ml('away'),
    homeSpreadOdds: price(o.homeTeamOdds, 'spreadOdds'),
    awaySpreadOdds: price(o.awayTeamOdds, 'spreadOdds'),
    overOdds: price(o, 'overOdds'),
    underOdds: price(o, 'underOdds'),
    details,
    provider: (o.provider && o.provider.name) || '',
  };
  if (out.spreadHome === undefined && out.total === undefined && out.homeML == null && out.awayML == null) return null;
  return out;
}

// Field position for the team with the ball, as yards from its own goal line.
function situationFrom(s, home, away) {
  if (!s) return null;
  const posId = s.possession != null ? String(s.possession) : s.team && s.team.id != null ? String(s.team.id) : null;
  let side = posId === home.id ? 'home' : posId === away.id ? 'away' : null;
  if (!side) return null;
  const mine = side === 'home' ? home : away;
  const theirs = side === 'home' ? away : home;
  let yOwn = null;
  const ytg = num(s.yardsToEndzone);
  if (Number.isFinite(ytg)) yOwn = 100 - ytg;
  const text = String(s.possessionText || s.downDistanceText || '').replace(/^.*\bat\s+/i, '').trim();
  if (yOwn == null && /^50$/.test(text)) yOwn = 50;
  const pm = /([A-Za-z&.' ]+?)\s+(\d{1,2})\s*$/.exec(text);
  if (yOwn == null && pm) {
    const yard = Number(pm[2]);
    if (yard === 50) yOwn = 50;
    else if (tokenMatches(pm[1], mine) && !tokenMatches(pm[1], theirs)) yOwn = yard;
    else if (tokenMatches(pm[1], theirs) && !tokenMatches(pm[1], mine)) yOwn = 100 - yard;
  }
  if (yOwn == null) {
    // ESPN measures yardLine from the home team's goal line.
    const yl = num(s.yardLine);
    if (Number.isFinite(yl)) yOwn = side === 'home' ? yl : 100 - yl;
  }
  if (yOwn != null && s.isRedZone === true && yOwn < 50) yOwn = 100 - yOwn;
  const down = num(s.down);
  const distance = num(s.distance);
  return {
    side,
    yOwn: yOwn == null ? 25 : Math.min(99, Math.max(1, yOwn)),
    down: Number.isFinite(down) && down > 0 ? down : 1,
    distance: Number.isFinite(distance) ? distance : 10,
    text: s.downDistanceText || s.shortDownDistanceText || '',
    redZone: s.isRedZone === true,
  };
}

function lastPlayText(s) {
  return (s && s.lastPlay && s.lastPlay.text) || '';
}

// ---------------------------------------------------------------- games

function baseGame(sport, ev, comp, extra = {}) {
  const sp = SPORTS[sport];
  const status = comp.status || ev.status || {};
  const type = status.type || {};
  const cs = comp.competitors || [];
  const homeC = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const awayC = cs.find((c) => c.homeAway === 'away') || cs.find((c) => c !== homeC) || {};
  const home = sideFrom(homeC, 0);
  const away = sideFrom(awayC, 1);
  const fmt = extra.format && extra.format.regulation;
  const game = {
    id: String(sp.kind === 'fight' ? comp.id || ev.id : ev.id || comp.id),
    eventId: String(ev.id || comp.id),
    sport,
    name: ev.name || `${away.name} at ${home.name}`,
    shortName: ev.shortName || `${away.abbr} @ ${home.abbr}`,
    start: comp.date || ev.date || null,
    state: type.state || 'pre',
    statusName: type.name || '',
    completed: type.completed === true,
    detail: type.shortDetail || type.detail || '',
    period: Number(status.period) || 0,
    clock: clockSeconds(status),
    displayClock: status.displayClock || '',
    seasonType: Number((ev.season && ev.season.type) || (extra.season && extra.season.type)) || 2,
    neutral: comp.neutralSite === true,
    home,
    away,
    odds: null,
    situation: null,
    winProb: null,
    lastPlay: '',
  };
  if (fmt && Number(fmt.periods) > 0) game.regulationPeriods = Number(fmt.periods);
  if (fmt && Number(fmt.clock) > 0) game.periodSec = Number(fmt.clock);
  if (sp.kind === 'fight') {
    game.home.abbr = fighterTag(homeC);
    game.away.abbr = fighterTag(awayC);
    game.winner = home.winner ? 'home' : away.winner ? 'away' : game.state === 'post' && /DRAW|NO_CONTEST|NC/i.test(`${type.name} ${type.detail}`) ? 'draw' : null;
    game.fight = {
      card: ev.name || '',
      weightClass: (comp.type && (comp.type.abbreviation || comp.type.text)) || (comp.note || ''),
      rounds: Number(comp.format && comp.format.regulation && comp.format.regulation.periods) || null,
      method: (status.result && (status.result.displayName || status.result.name)) || type.detail || '',
      segment: (comp.cardSegment && (comp.cardSegment.description || comp.cardSegment.name)) || '',
    };
  }
  return game;
}

function fighterTag(c) {
  const a = (c && c.athlete) || {};
  const last = (a.shortName || a.displayName || a.fullName || '').split(' ').slice(-1)[0];
  return (last || 'Fighter').toUpperCase().slice(0, 12);
}

// Scoreboard to games. For UFC each fight on the card is its own game.
export function normalizeScoreboard(raw, sport) {
  const sp = SPORTS[sport];
  const out = [];
  for (const ev of (raw && raw.events) || []) {
    const comps = ev.competitions || [];
    const list = sp.kind === 'fight' ? comps : comps.slice(0, 1);
    for (const comp of list) {
      const g = baseGame(sport, ev, comp);
      const o = Array.isArray(comp.odds) ? comp.odds[0] : null;
      g.odds = oddsFrom(o, g.home, g.away);
      if (sp.kind === 'football' && g.state === 'in') g.situation = situationFrom(comp.situation, g.home, g.away);
      const prob = comp.situation && comp.situation.lastPlay && comp.situation.lastPlay.probability;
      if (prob && Number.isFinite(num(prob.homeWinPercentage))) g.winProb = { home: num(prob.homeWinPercentage) };
      g.lastPlay = lastPlayText(comp.situation);
      out.push(g);
    }
  }
  return out;
}

// Box score rows to { id: { id, name, side, starter, didNotPlay, ejected, stats } }.
const BB_STAT = {
  minutes: 'min', points: 'pts', rebounds: 'reb', assists: 'ast', steals: 'stl', blocks: 'blk', fouls: 'pf', turnovers: 'to',
};

function bbStats(keys, vals) {
  const s = {};
  keys.forEach((k, i) => {
    const v = vals[i];
    if (k === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted') {
      const [made, att] = String(v || '').split('-');
      s.threes = Number(made) || 0;
      s.threesAtt = Number(att) || 0;
    } else if (BB_STAT[k]) {
      const n = Number(String(v || '').replace(/[^0-9.-]/g, ''));
      s[BB_STAT[k]] = Number.isFinite(n) ? n : 0;
    }
  });
  return s;
}

function fbStats(group, keys, vals, s) {
  const g = (k) => {
    const i = keys.indexOf(k);
    if (i < 0) return 0;
    const n = Number(String(vals[i] || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  if (group === 'passing') {
    const ca = String(vals[keys.indexOf('completions/passingAttempts')] || '').split('/');
    s.passCmp = (s.passCmp || 0) + (Number(ca[0]) || 0);
    s.passAtt = (s.passAtt || 0) + (Number(ca[1]) || 0);
    s.passYds = (s.passYds || 0) + g('passingYards');
    s.passTD = (s.passTD || 0) + g('passingTouchdowns');
    s.ints = (s.ints || 0) + g('interceptions');
  } else if (group === 'rushing') {
    s.rushAtt = (s.rushAtt || 0) + g('rushingAttempts');
    s.rushYds = (s.rushYds || 0) + g('rushingYards');
    s.rushTD = (s.rushTD || 0) + g('rushingTouchdowns');
  } else if (group === 'receiving') {
    s.rec = (s.rec || 0) + g('receptions');
    s.recYds = (s.recYds || 0) + g('receivingYards');
    s.recTD = (s.recTD || 0) + g('receivingTouchdowns');
  } else if (group === 'kickReturns') {
    s.retTD = (s.retTD || 0) + g('kickReturnTouchdowns');
  } else if (group === 'puntReturns') {
    s.retTD = (s.retTD || 0) + g('puntReturnTouchdowns');
  } else if (group === 'interceptions' || group === 'defensive' || group === 'fumbles') {
    if (keys.includes('interceptionTouchdowns')) s.defTD = (s.defTD || 0) + g('interceptionTouchdowns');
    if (keys.includes('defensiveTouchdowns')) s.defTD = (s.defTD || 0) + g('defensiveTouchdowns');
  }
  return s;
}

export function normalizePlayers(boxscore, game) {
  const players = {};
  for (const grp of (boxscore && boxscore.players) || []) {
    const tid = String((grp.team && grp.team.id) || '');
    const side = game && tid === game.home.id ? 'home' : game && tid === game.away.id ? 'away' : null;
    for (const sg of grp.statistics || []) {
      const keys = sg.keys || [];
      for (const row of sg.athletes || []) {
        const a = row.athlete || {};
        if (!a.id) continue;
        const id = String(a.id);
        const p = players[id] || (players[id] = {
          id, name: a.displayName || a.fullName || a.shortName || '', short: a.shortName || '', side,
          jersey: a.jersey || '', pos: (a.position && a.position.abbreviation) || '',
          starter: row.starter === true, didNotPlay: false, ejected: false, stats: {},
        });
        if (row.starter === true) p.starter = true;
        if (row.didNotPlay === true) p.didNotPlay = true;
        if (row.ejected === true) p.ejected = true;
        const vals = row.stats || [];
        if (keys.includes('minutes') || keys.includes('points')) {
          if (vals.length) Object.assign(p.stats, bbStats(keys, vals));
        } else {
          fbStats(sg.name, keys, vals, p.stats);
        }
      }
    }
  }
  return players;
}

// Summary to { game, players }. The summary has the box score, the book line (pickcenter) and
// the full regulation format; the scoreboard has the live football situation.
export function normalizeSummary(raw, sport) {
  const header = (raw && raw.header) || {};
  const comp = (header.competitions || [])[0] || {};
  const ev = { id: header.id || comp.id, season: header.season, name: '', status: comp.status };
  const game = baseGame(sport, ev, comp, { format: raw && raw.format, season: header.season });
  const pc = Array.isArray(raw && raw.pickcenter) ? raw.pickcenter[0] : null;
  game.odds = oddsFrom(pc, game.home, game.away) || oddsFrom(Array.isArray(raw && raw.odds) ? raw.odds[0] : null, game.home, game.away);
  const wp = Array.isArray(raw && raw.winprobability) ? raw.winprobability : [];
  if (wp.length && Number.isFinite(num(wp[wp.length - 1].homeWinPercentage))) game.winProb = { home: num(wp[wp.length - 1].homeWinPercentage) };
  if (SPORTS[sport].kind === 'football' && game.state === 'in') {
    let sit = raw.situation ? situationFrom(raw.situation, game.home, game.away) : null;
    const cur = raw.drives && raw.drives.current;
    if (!sit && cur && Array.isArray(cur.plays) && cur.plays.length) {
      const last = cur.plays[cur.plays.length - 1];
      const end = last.end || {};
      sit = situationFrom({ possession: cur.team && cur.team.id, yardsToEndzone: end.yardsToEndzone, down: end.down, distance: end.distance, downDistanceText: end.downDistanceText, possessionText: end.possessionText, yardLine: end.yardLine }, game.home, game.away);
    }
    game.situation = sit;
  }
  const players = normalizePlayers(raw && raw.boxscore, game);
  return { game, players };
}

// Roster to a short player list for prop entry.
export function normalizeRoster(raw) {
  const out = [];
  const add = (a) => {
    if (!a || !a.id) return;
    out.push({ id: String(a.id), name: a.displayName || a.fullName || '', pos: (a.position && a.position.abbreviation) || '', jersey: a.jersey || '' });
  };
  const ath = (raw && raw.athletes) || [];
  for (const x of ath) {
    if (Array.isArray(x.items)) x.items.forEach(add);
    else add(x);
  }
  return out;
}

// Keep a merged game fresh: the scoreboard owns live status and the football situation; the
// summary adds the book line when the scoreboard has none, and the format.
export function mergeGame(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  const out = { ...prev, ...next };
  out.odds = next.odds || prev.odds || null;
  out.situation = next.situation || (next.state === 'in' && prev.state === 'in' && prev.period === next.period ? prev.situation : null);
  out.regulationPeriods = next.regulationPeriods || prev.regulationPeriods;
  out.periodSec = next.periodSec || prev.periodSec;
  out.winProb = next.winProb || prev.winProb || null;
  return out;
}

// ---------------------------------------------------------------- finding games by name

export function normTeam(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'at', 'vs', 'v', 'of']);
const tokens = (s) => normTeam(s).split(' ').filter((w) => w && !STOP.has(w));

// "st" matches "state" and "mich" matches "michigan", but "st" does not match "stanford".
function tokenMatch(q, t) {
  if (q === t) return true;
  if (q.length < 2 || !t.startsWith(q)) return false;
  return q.length >= 3 || t.length <= 6;
}

// How well a free-text team name ("Bills", "BUF", "Buffalo", "Texas A&M") matches a side, 0 to 1.
// Every word of the query has to belong to the team; naming the school or city scores highest.
export function teamScore(query, team) {
  const Q = tokens(query);
  if (!Q.length || !team) return 0;
  const abbr = normTeam(team.abbr).replace(/ /g, '');
  if (Q.join('') === abbr && abbr) return 1;
  const T = new Set([team.location, team.name, team.short].flatMap(tokens).concat(abbr ? [abbr] : []));
  const has = (q) => [...T].some((t) => tokenMatch(q, t));
  const cov = Q.filter(has).length / Q.length;
  if (cov < 1) return cov * 0.5;
  const L = tokens(team.location || team.name);
  const loc = L.length ? L.filter((l) => Q.some((q) => tokenMatch(q, l))).length / L.length : 0;
  return 0.7 + 0.3 * loc;
}

// Best game for one or two team names among a list of games. With two names both have to
// match (a slip's opponent that is not on this board means a different day). Returns null
// when nothing matches or two games match equally well.
export function findGame(games, a, b) {
  const pass = (useB) => {
    const hits = [];
    for (const g of games || []) {
      for (const side of ['home', 'away']) {
        const sa = teamScore(a, g[side]);
        if (sa < 0.6) continue;
        let score = sa;
        if (useB) {
          const sb = teamScore(b, g[side === 'home' ? 'away' : 'home']);
          if (sb < 0.6) continue;
          score = 0.5 + (sa + sb) / 2;
        }
        hits.push({ game: g, score, aSide: side });
      }
    }
    hits.sort((x, y) => y.score - x.score);
    if (!hits.length) return null;
    const rival = hits.find((h) => h.game !== hits[0].game);
    if (rival && rival.score >= hits[0].score - 0.02) return null;
    return hits[0];
  };
  return b ? pass(true) : pass(false);
}
