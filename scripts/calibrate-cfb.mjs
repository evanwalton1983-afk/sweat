// Checks the college football model against real finals and ESPN closing lines.
//
//   node scripts/calibrate-cfb.mjs <cfb_lines.csv> [--fit] [--set='{"extraM":6}']
//
// cfb_lines.csv: game_id, season, season_type, home_score, away_score, spread_home (home line),
// total_line, ot. Sampled from sportsdataverse's raw ESPN game files (see README, Calibration).
import fs from 'node:fs';
import * as E from '../src/engine.js';

const [path] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FIT = process.argv.includes('--fit');
const SET = process.argv.find((a) => a.startsWith('--set='));
if (SET) Object.assign(E.SPORTS.cfb, JSON.parse(SET.slice(6)));
const sp = E.SPORTS.cfb;

const lines = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/);
const head = lines.shift().split(',');
const games = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])))
  .map((g) => ({ sh: Number(g.spread_home), tl: Number(g.total_line), m: Number(g.home_score) - Number(g.away_score), t: Number(g.home_score) + Number(g.away_score), type: Number(g.season_type) }))
  .filter((g) => [g.sh, g.tl, g.m, g.t].every(Number.isFinite) && g.tl > 20);

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
console.log(`College football: ${games.length} games`);
console.log(`  real spread of results: margin ${rms(games.map((g) => g.m + g.sh)).toFixed(2)}, total ${rms(games.map((g) => g.t - g.tl)).toFixed(2)}`);

function dv(d) {
  const m = E.distMean(d);
  let v = 0;
  d.p.forEach((p, i) => { v += p * (d.lo + i - m) ** 2; });
  return v;
}

const K = 25;
function stats(noKey) {
  let vm = 0;
  let vt = 0;
  let bc = 0;
  let bo = 0;
  let bw = 0;
  const abs = new Array(K).fill(0);
  const push = {};
  for (const g of games) {
    const game = { state: 'pre', period: 0, clock: 0, seasonType: g.type, home: { score: 0, linescores: [] }, away: { score: 0, linescores: [] }, odds: { spreadHome: g.sh, total: g.tl } };
    const m = E.footballModel(game, sp, 'game', null, { noKeyWeights: noKey });
    vm += dv(m.margin);
    vt += dv(m.total);
    let w = 0;
    let p = 0;
    let hw = 0;
    let ht = 0;
    m.margin.p.forEach((q, i) => {
      const k = m.margin.lo + i;
      if (Math.abs(k) < K) abs[Math.abs(k)] += q;
      if (k + g.sh > 0) w += q; else if (k + g.sh === 0) p += q;
      if (k > 0) hw += q; else if (k === 0) ht += q;
    });
    const oc = g.m + g.sh > 0 ? 1 : g.m + g.sh === 0 ? 0.5 : 0;
    bc += (w + p / 2 - oc) ** 2;
    bw += (hw + ht / 2 - (g.m > 0 ? 1 : 0)) ** 2;
    let o = 0;
    let op = 0;
    m.total.p.forEach((q, i) => { const k = m.total.lo + i; if (k > g.tl) o += q; else if (k === g.tl) op += q; });
    bo += (o + op / 2 - (g.t > g.tl ? 1 : g.t === g.tl ? 0.5 : 0)) ** 2;
    if (Number.isInteger(g.sh) && g.sh !== 0) {
      const key = Math.abs(g.sh);
      push[key] = push[key] || { model: 0, real: 0, n: 0 };
      push[key].model += p;
      push[key].real += g.m + g.sh === 0 ? 1 : 0;
      push[key].n += 1;
    }
  }
  const n = games.length;
  return { sdM: Math.sqrt(vm / n), sdT: Math.sqrt(vt / n), abs: abs.map((v) => v / n), brier: { win: bw / n, cover: bc / n, over: bo / n }, push };
}

const emp = new Array(K).fill(0);
for (const g of games) if (Math.abs(g.m) < K) emp[Math.abs(g.m)] += 1 / games.length;

const base = stats(true);
console.log(`  model without key weights: margin sd ${base.sdM.toFixed(2)}, total sd ${base.sdT.toFixed(2)}`);
if (FIT) {
  const n = games.length;
  const w = emp.map((e, k) => {
    const m = base.abs[k];
    if (!(m > 0)) return 1;
    // Shrink toward 1: small samples, so 60 pseudo-games of the model's own shape.
    const v = (e * n + 60 * m) / (m * n + 60 * m);
    return Math.round(Math.min(2.2, Math.max(0.5, v)) * 1000) / 1000;
  });
  console.log('\nFitted keyWeights (paste into SPORTS.cfb.keyWeights):');
  console.log(JSON.stringify(w));
}
const cur = stats(false);
console.log(`  model with current settings: margin sd ${cur.sdM.toFixed(2)}, total sd ${cur.sdT.toFixed(2)}`);
console.log(`  Brier: win ${cur.brier.win.toFixed(4)}, home cover ${cur.brier.cover.toFixed(4)}, over ${cur.brier.over.toFixed(4)}`);
console.log('  |margin| share, real vs model:');
console.log('   ' + [1, 2, 3, 4, 6, 7, 8, 10, 14, 17, 21].map((k) => `${k}: ${(emp[k] * 100).toFixed(1)} vs ${(cur.abs[k] * 100).toFixed(1)}`).join(' | '));
console.log('  push rate at whole-number spreads, real vs model:');
console.log('   ' + Object.entries(cur.push).filter(([, v]) => v.n >= 25).sort((a, b) => a[0] - b[0])
  .map(([k, v]) => `${k}: ${((v.real / v.n) * 100).toFixed(1)} vs ${((v.model / v.n) * 100).toFixed(1)} (n ${v.n})`).join(' | '));
