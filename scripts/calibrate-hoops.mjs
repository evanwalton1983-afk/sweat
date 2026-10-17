// Checks the basketball model against sampled in-game moments.
//
//   node scripts/calibrate-hoops.mjs <states.csv> <nba|ncaab> [--grid]
//
// states.csv rows: game_id, period, clock, home_score, away_score, spread_home (home line),
// total_line (optional), final_home, final_away, pregame_home_prob and home_win_prob (ESPN,
// college only). Made from sportsdataverse play-by-play (see README, Calibration).
// --grid tries other margin spreads and pace weights and prints the Brier for each.
import fs from 'node:fs';
import * as E from '../src/engine.js';

const [path, league] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GRID = process.argv.includes('--grid');
const num = (x) => (x === '' || x === 'NA' || x == null ? NaN : Number(x));

const text = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/);
const head = text.shift().split(',');
const rows = text.map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
const base = E.SPORTS[league];

function gameFor(s, sp, spreadHome) {
  return {
    id: s.game_id, sport: league, state: 'in', statusName: 'STATUS_IN_PROGRESS', period: num(s.period), clock: num(s.clock),
    home: { score: num(s.home_score), abbr: 'H', linescores: [] }, away: { score: num(s.away_score), abbr: 'A', linescores: [] },
    odds: { spreadHome, total: Number.isFinite(num(s.total_line)) ? num(s.total_line) : undefined },
  };
}

function run(sp) {
  const acc = { win: [], cover: [], over: [], espn: [], late: [], lateEspn: [], overLate: {} };
  const saved = E.SPORTS[league];
  E.SPORTS[league] = sp;
  try {
    for (const s of rows) {
      let spreadHome = num(s.spread_home);
      const pre = num(s.pregame_home_prob);
      if (!Number.isFinite(spreadHome)) {
        if (!Number.isFinite(pre)) continue;
        // No line in the data: back one out of ESPN's pregame chance.
        spreadHome = -E.normInv(Math.min(0.995, Math.max(0.005, pre))) * sp.marginSD;
      }
      const g = gameFor(s, sp, spreadHome);
      const fm = num(s.final_home) - num(s.final_away);
      const ft = num(s.final_home) + num(s.final_away);
      const ml = E.evaluateLeg({ sport: league, market: 'moneyline', side: 'home', odds: -110, segment: 'game' }, g);
      acc.win.push([ml.win, fm > 0 ? 1 : 0]);
      const left = (sp.periods - num(s.period)) * sp.periodSec + num(s.clock);
      if (left <= 300) acc.late.push([ml.win, fm > 0 ? 1 : 0]);
      if (Number.isFinite(num(s.spread_home))) {
        const line = num(s.spread_home);
        const sc = E.evaluateLeg({ sport: league, market: 'spread', side: 'home', line, odds: -110, segment: 'game' }, g);
        const c = fm + line;
        acc.cover.push([sc.win + sc.push / 2, c > 0 ? 1 : c === 0 ? 0.5 : 0]);
      }
      if (Number.isFinite(num(s.total_line))) {
        const tl = num(s.total_line);
        const ov = E.evaluateLeg({ sport: league, market: 'total', side: 'over', line: tl, odds: -110, segment: 'game' }, g);
        const pair = [ov.win + ov.push / 2, ft > tl ? 1 : ft === tl ? 0.5 : 0];
        acc.over.push(pair);
        if (left <= 300) {
          const m = Math.abs(num(s.home_score) - num(s.away_score));
          const key = m <= 3 ? 'within 3' : m <= 8 ? '4 to 8' : '9 or more';
          (acc.overLate[key] = acc.overLate[key] || []).push(pair);
        }
      }
      const ew = num(s.home_win_prob);
      if (Number.isFinite(ew)) {
        acc.espn.push([ew, fm > 0 ? 1 : 0]);
        if (left <= 300) acc.lateEspn.push([ew, fm > 0 ? 1 : 0]);
      }
    }
  } finally {
    E.SPORTS[league] = saved;
  }
  return acc;
}

const brier = (a) => (a.length ? a.reduce((s, [p, o]) => s + (p - o) ** 2, 0) / a.length : NaN);
const table = (a) => {
  const bins = Array.from({ length: 10 }, () => ({ p: 0, o: 0, n: 0 }));
  for (const [p, o] of a) { const b = Math.min(9, Math.floor(p * 10)); bins[b].p += p; bins[b].o += o; bins[b].n += 1; }
  return bins.filter((b) => b.n >= 40).map((b) => `${Math.round((b.p / b.n) * 100)}->${Math.round((b.o / b.n) * 100)}`).join(' ');
};

const acc = run(base);
console.log(`${league}: ${acc.win.length} moments`);
console.log(`  home win:   Brier ${brier(acc.win).toFixed(4)}${acc.espn.length ? `   (ESPN win chance on the same moments: ${brier(acc.espn).toFixed(4)})` : ''}`);
console.log(`              said -> happened, %: ${table(acc.win)}`);
console.log(`  last 5 min: Brier ${brier(acc.late).toFixed(4)}${acc.lateEspn.length ? ` vs ESPN ${brier(acc.lateEspn).toFixed(4)}` : ''} (${acc.late.length})`);
if (acc.cover.length) console.log(`  home cover: Brier ${brier(acc.cover).toFixed(4)}   said -> happened: ${table(acc.cover)} (${acc.cover.length})`);
if (acc.over.length) console.log(`  over:       Brier ${brier(acc.over).toFixed(4)}   said -> happened: ${table(acc.over)} (${acc.over.length})`);
const lateOver = (a) => Object.entries(a.overLate).map(([k, v]) => {
  const said = v.reduce((s, [p]) => s + p, 0) / v.length;
  const hap = v.reduce((s, [, o]) => s + o, 0) / v.length;
  return `${k}: said ${Math.round(said * 100)} happened ${Math.round(hap * 100)} Brier ${brier(v).toFixed(3)} (${v.length})`;
}).join(' | ');
if (acc.over.length) console.log(`  over, last 5 minutes by margin: ${lateOver(acc)}`);

const SET = process.argv.find((a) => a.startsWith('--try='));
if (SET) {
  // --try='[{"foulPts":4},{"foulPts":6,"foulSD":8}]' runs each variant on top of the current settings.
  for (const v of JSON.parse(SET.slice(6))) {
    const a = run({ ...base, ...v });
    console.log(`\n  ${JSON.stringify(v)}: win ${brier(a.win).toFixed(4)} late ${brier(a.late).toFixed(4)} cover ${brier(a.cover).toFixed(4)} over ${brier(a.over).toFixed(4)}`);
    console.log(`    over said -> happened: ${table(a.over)}`);
    console.log(`    ${lateOver(a)}`);
  }
}

if (GRID) {
  console.log('\n  margin sd / pace weight / total sd grid:');
  for (const marginSD of [base.marginSD - 1.5, base.marginSD - 0.75, base.marginSD, base.marginSD + 0.75, base.marginSD + 1.5]) {
    const a = run({ ...base, marginSD });
    console.log(`   marginSD ${marginSD.toFixed(2)}: win ${brier(a.win).toFixed(4)} late ${brier(a.late).toFixed(4)}${a.cover.length ? ` cover ${brier(a.cover).toFixed(4)}` : ''}`);
  }
  if (acc.over.length) {
    for (const totalSD of [base.totalSD - 2, base.totalSD - 1, base.totalSD, base.totalSD + 1, base.totalSD + 2]) {
      for (const paceWeight of [0.5, 0.7, 0.85]) {
        const a = run({ ...base, totalSD, paceWeight });
        console.log(`   totalSD ${totalSD.toFixed(1)} pace ${paceWeight}: over ${brier(a.over).toFixed(4)}`);
      }
    }
  }
}
