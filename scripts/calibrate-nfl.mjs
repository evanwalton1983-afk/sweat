// Calibrates and checks the football model against real NFL games.
//
//   node scripts/calibrate-nfl.mjs <games.csv> [nfl_states.csv] [--fit]
//
// games.csv: nflverse/nfldata data/games.csv (closing spread_line, total_line, finals).
// nfl_states.csv: sampled live moments from nflverse play-by-play (see README, Calibration).
// --fit prints drive and key-number settings to paste into SPORTS.nfl.
import fs from 'node:fs';
import * as E from '../src/engine.js';

const [gamesPath, statesPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FIT = process.argv.includes('--fit');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const num = (x) => (x === '' || x === 'NA' || x == null ? NaN : Number(x));
const sp = E.SPORTS.nfl;

function pregame(spreadLine, totalLine, post) {
  // nflverse spread_line is positive when the home team is favored.
  return {
    id: 'g', sport: 'nfl', state: 'pre', period: 0, clock: 0, seasonType: post ? 3 : 2,
    home: { score: 0, abbr: 'H', linescores: [] }, away: { score: 0, abbr: 'A', linescores: [] },
    odds: { spreadHome: -spreadLine, total: totalLine },
  };
}

function distVar(d) {
  const m = E.distMean(d);
  let v = 0;
  d.p.forEach((p, i) => { v += p * (d.lo + i - m) ** 2; });
  return v;
}

const games = parseCsv(fs.readFileSync(gamesPath, 'utf8'))
  .map((g) => ({ season: num(g.season), type: g.game_type, sl: num(g.spread_line), tl: num(g.total_line), result: num(g.result), total: num(g.total) }))
  .filter((g) => g.season >= 2012 && [g.sl, g.tl, g.result, g.total].every(Number.isFinite));

console.log(`Pregame check on ${games.length} NFL games (2012 on)`);
const empSD = (arr) => Math.sqrt(arr.reduce((a, b) => a + b * b, 0) / arr.length);
console.log(`  real spread of results: margin ${empSD(games.map((g) => g.result - g.sl)).toFixed(2)}, total ${empSD(games.map((g) => g.total - g.tl)).toFixed(2)}`);

const K = 25;
function pregameStats(noKey) {
  let vm = 0;
  let vt = 0;
  const absFreq = new Array(K).fill(0);
  let brier = 0;
  let logl = 0;
  const pushByLine = {};
  for (const g of games) {
    const m = E.footballModel(pregame(g.sl, g.tl, g.type !== 'REG'), sp, 'game', null, { noKeyWeights: noKey });
    vm += distVar(m.margin);
    vt += distVar(m.total);
    m.margin.p.forEach((p, i) => { const k = Math.abs(m.margin.lo + i); if (k < K) absFreq[k] += p; });
    // Home covers the closing spread: margin > spread_line.
    let win = 0;
    let push = 0;
    m.margin.p.forEach((p, i) => { const k = m.margin.lo + i; if (k > g.sl) win += p; else if (k === g.sl) push += p; });
    const out = g.result > g.sl ? 1 : g.result === g.sl ? 0.5 : 0;
    const pc = win + push / 2;
    brier += (pc - out) ** 2;
    if (Number.isInteger(g.sl) && g.sl !== 0) {
      const key = Math.abs(g.sl);
      pushByLine[key] = pushByLine[key] || { model: 0, real: 0, n: 0 };
      pushByLine[key].model += push;
      pushByLine[key].real += g.result === g.sl ? 1 : 0;
      pushByLine[key].n += 1;
    }
    logl += 0;
  }
  const n = games.length;
  return { sdM: Math.sqrt(vm / n), sdT: Math.sqrt(vt / n), absFreq: absFreq.map((v) => v / n), brier: brier / n, pushByLine };
}

const empAbs = new Array(K).fill(0);
for (const g of games) { const k = Math.abs(g.result); if (k < K) empAbs[k] += 1 / games.length; }

const base = pregameStats(true);
console.log(`  model without key weights: margin sd ${base.sdM.toFixed(2)}, total sd ${base.sdT.toFixed(2)}`);
const weights = empAbs.map((e, k) => {
  const m = base.absFreq[k];
  if (!(m > 0)) return 1;
  // Shrink small samples toward 1.
  const n = e * games.length;
  const w = (e * games.length + 30 * m) / (m * games.length + 30 * m);
  return Math.round(Math.min(2.5, Math.max(0.4, n > 0 ? w : 1)) * 1000) / 1000;
});
if (FIT) {
  console.log('\nFitted keyWeights (paste into SPORTS.nfl.keyWeights):');
  console.log(JSON.stringify(weights));
}
const cur = pregameStats(false);
console.log(`  model with current settings: margin sd ${cur.sdM.toFixed(2)}, total sd ${cur.sdT.toFixed(2)}, home-cover Brier ${cur.brier.toFixed(4)}`);
console.log('  |margin| share, real vs model:');
console.log('   ' + [1, 2, 3, 4, 6, 7, 10, 14].map((k) => `${k}: ${(empAbs[k] * 100).toFixed(1)} vs ${(cur.absFreq[k] * 100).toFixed(1)}`).join(' | '));
console.log('  push rate at whole-number spreads, real vs model:');
console.log('   ' + Object.entries(cur.pushByLine).filter(([, v]) => v.n >= 60).sort((a, b) => a[0] - b[0])
  .map(([k, v]) => `${k}: ${((v.real / v.n) * 100).toFixed(1)} vs ${((v.model / v.n) * 100).toFixed(1)} (n ${v.n})`).join(' | '));

if (statesPath) {
  const states = parseCsv(fs.readFileSync(statesPath, 'utf8'));
  console.log(`\nLive check on ${states.length} sampled NFL moments (2023 to 2025)`);
  const acc = { win: [], cover: [], over: [], vegas: [] };
  for (const s of states) {
    const g = pregame(num(s.spread_line), num(s.total_line), s.season_type !== 'REG');
    g.state = 'in';
    g.statusName = 'STATUS_IN_PROGRESS';
    g.period = num(s.qtr);
    g.clock = num(s.quarter_seconds_remaining);
    g.home.score = num(s.home_score);
    g.away.score = num(s.away_score);
    g.situation = { side: s.side, yOwn: 100 - num(s.yardline_100), down: num(s.down), distance: num(s.ydstogo) };
    const result = num(s.result);
    const total = num(s.total);
    const sl = num(s.spread_line);
    const tl = num(s.total_line);
    const ml = E.evaluateLeg({ sport: 'nfl', market: 'moneyline', side: 'home', odds: -110, segment: 'game' }, g);
    const sc = E.evaluateLeg({ sport: 'nfl', market: 'spread', side: 'home', line: -sl, odds: -110, segment: 'game' }, g);
    const ov = E.evaluateLeg({ sport: 'nfl', market: 'total', side: 'over', line: tl, odds: -110, segment: 'game' }, g);
    const winOut = result > 0 ? 1 : result === 0 ? 0.5 : 0;
    acc.win.push([ml.win + ml.push / 2, winOut]);
    acc.cover.push([sc.win + sc.push / 2, result > sl ? 1 : result === sl ? 0.5 : 0]);
    acc.over.push([ov.win + ov.push / 2, total > tl ? 1 : total === tl ? 0.5 : 0]);
    const v = num(s.vegas_home_wp);
    if (Number.isFinite(v)) acc.vegas.push([v, winOut, ml.win + ml.push / 2]);
  }
  const brier = (a) => a.reduce((s, [p, o]) => s + (p - o) ** 2, 0) / a.length;
  const table = (a) => {
    const bins = Array.from({ length: 10 }, () => ({ p: 0, o: 0, n: 0 }));
    for (const [p, o] of a) { const b = Math.min(9, Math.floor(p * 10)); bins[b].p += p; bins[b].o += o; bins[b].n += 1; }
    return bins.filter((b) => b.n >= 40).map((b) => `${Math.round((b.p / b.n) * 100)}->${Math.round((b.o / b.n) * 100)}`).join(' ');
  };
  console.log(`  home win:   Brier ${brier(acc.win).toFixed(4)}   (nflfastR market win model on the same moments: ${brier(acc.vegas.map(([v, o]) => [v, o])).toFixed(4)})`);
  console.log(`              said -> happened, %: ${table(acc.win)}`);
  console.log(`  home cover: Brier ${brier(acc.cover).toFixed(4)}   said -> happened: ${table(acc.cover)}`);
  console.log(`  over:       Brier ${brier(acc.over).toFixed(4)}   said -> happened: ${table(acc.over)}`);
  const late = acc.win.filter((_, i) => num(states[i].game_seconds_remaining) <= 300);
  const lateV = acc.vegas.filter((_, i) => num(states[i].game_seconds_remaining) <= 300);
  console.log(`  last 5 minutes only (${late.length}): win Brier ${brier(late).toFixed(4)} vs nflfastR ${brier(lateV.map(([v, o]) => [v, o])).toFixed(4)}`);
  // Last 5 minutes by score, from the side of the team with the ball.
  const B = {};
  states.forEach((s, i) => {
    if (num(s.game_seconds_remaining) > 300 || !Number.isFinite(num(s.vegas_home_wp))) return;
    const lead = (s.side === 'home' ? 1 : -1) * (num(s.home_score) - num(s.away_score));
    const key = lead > 8 ? 'leads 9+' : lead >= 4 ? 'leads 4-8' : lead >= 1 ? 'leads 1-3' : lead === 0 ? 'tied' : lead >= -3 ? 'trails 1-3' : lead >= -8 ? 'trails 4-8' : 'trails 9+';
    const [p, o] = acc.win[i];
    const v = num(s.vegas_home_wp);
    B[key] = B[key] || { n: 0, m: 0, v: 0 };
    B[key].n += 1;
    B[key].m += (p - o) ** 2;
    B[key].v += (v - o) ** 2;
  });
  console.log('  last 5 minutes, team with the ball: Brier model vs nflfastR');
  console.log('   ' + Object.entries(B).map(([k, b]) => `${k} ${(b.m / b.n).toFixed(3)} vs ${(b.v / b.n).toFixed(3)} (n ${b.n})`).join(' | '));
}
