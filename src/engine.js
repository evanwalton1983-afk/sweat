// Sweat engine: live cash probabilities, grading and payouts.
// Pure functions only (no DOM, no network) so the same file runs in the browser and in tests.
//
// Football uses a possession model: each remaining drive ends in a touchdown, a field goal or
// nothing, so late-game math respects "needs a touchdown" and pushes land on 3 and 7 the way
// real games do. Basketball uses a time-scaled normal model of the final margin and total.
// Rates come from 2023 to 2025 NFL play-by-play and 2012 to 2025 closing lines (see README).

export const ENGINE_VERSION = 1;

// ---------------------------------------------------------------- sports

export const SPORTS = {
  nfl: {
    key: 'nfl', name: 'NFL', espn: 'football/nfl', oddsKey: 'americanfootball_nfl', kind: 'football',
    periods: 4, periodSec: 900, otSec: 600, drives: 9.8, tdBase: 0.221, fgBase: 0.157, tdScale: 1, fgScale: 1,
    tieInOt: 0.04,
    // Fitted on 2012 to 2025 NFL finals (scripts/calibrate-nfl.mjs); index = absolute margin.
    keyWeights: [2.429, 0.901, 1.15, 1.752, 0.779, 1.09, 1.128, 1.296, 0.999, 0.443, 0.93, 0.479, 0.654, 0.601, 1.141, 0.807, 0.984, 0.98, 0.927, 0.831, 0.954, 1.004, 0.889, 0.98, 1.069],
  },
  cfb: {
    key: 'cfb', name: 'College football', espn: 'football/college-football', oddsKey: 'americanfootball_ncaaf',
    kind: 'football', periods: 4, periodSec: 900, otSec: 0, drives: 12.4, tdBase: 0.262, fgBase: 0.128,
    tdScale: 1.12, fgScale: 0.85, tieInOt: 0, extraM: 6.6, extraT: 7.3,
    // Fitted on 1,600 ESPN closing lines and finals, 2017 to 2025 (scripts/calibrate-cfb.mjs), bounded.
    keyWeights: [1, 1.061, 0.971, 1.93, 0.879, 1.058, 0.991, 1.499, 0.992, 0.6, 1.045, 0.617, 0.6, 0.62, 1.132, 0.688, 0.6, 0.929, 1.079, 0.603, 0.6, 1.374, 0.654, 0.836, 1.105],
  },
  nba: {
    key: 'nba', name: 'NBA', espn: 'basketball/nba', oddsKey: 'basketball_nba', kind: 'basketball',
    periods: 4, periodSec: 720, otSec: 300, marginSD: 13.75, totalSD: 17.5, paceWeight: 1, foulOut: 6,
    revert: 0.48, lateM: 0.24, lateT: 0.15, foulSec: 150, foulPts: 3, foulSD: 6, starterMin: 33, benchMin: 20,
    profile: [0, 0.0155, 0.036, 0.0575, 0.0794, 0.1013, 0.1227, 0.1434, 0.1648, 0.186, 0.2066, 0.23, 0.2523, 0.2693, 0.2897, 0.31, 0.3308, 0.3514, 0.3715, 0.3923, 0.4136, 0.4347, 0.4564, 0.4789, 0.5021, 0.5195, 0.5407, 0.5626, 0.5848, 0.6065, 0.6278, 0.6494, 0.6703, 0.6915, 0.7128, 0.7341, 0.7567, 0.7738, 0.7937, 0.814, 0.8341, 0.854, 0.8736, 0.8938, 0.9133, 0.9333, 0.9525, 0.9748, 1],
  },
  ncaab: {
    key: 'ncaab', name: 'College basketball', espn: 'basketball/mens-college-basketball', oddsKey: 'basketball_ncaab',
    kind: 'basketball', periods: 2, periodSec: 1200, otSec: 300, marginSD: 11.1, totalSD: 16, paceWeight: 0.9,
    revert: 0.43, lateM: 0.24, lateT: 0.3, foulSec: 150, foulPts: 3, foulSD: 7, foulOut: 5, starterMin: 31, benchMin: 16,
    profile: [0, 0.0173, 0.0398, 0.064, 0.0886, 0.1123, 0.1357, 0.159, 0.1827, 0.2054, 0.2288, 0.2526, 0.2769, 0.3007, 0.3245, 0.3494, 0.3745, 0.3991, 0.4237, 0.4485, 0.4725, 0.4952, 0.5207, 0.547, 0.5732, 0.5985, 0.6236, 0.6489, 0.6747, 0.6991, 0.7244, 0.7503, 0.7764, 0.8017, 0.8272, 0.8534, 0.8801, 0.9057, 0.9314, 0.9595, 1],
  },
  ufc: { key: 'ufc', name: 'UFC', espn: 'mma/ufc', oddsKey: 'mma_mixed_martial_arts', kind: 'fight' },
};

export const SPORT_KEYS = Object.keys(SPORTS);

// Player prop stats the engine can track. `kind` picks the remaining-production model.
export const STATS = {
  // basketball
  pts: { label: 'Points', sports: ['nba', 'ncaab'], kind: 'bb', disp: 2.3 },
  reb: { label: 'Rebounds', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.35 },
  ast: { label: 'Assists', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.45 },
  threes: { label: 'Threes made', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.2 },
  stl: { label: 'Steals', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.1 },
  blk: { label: 'Blocks', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.2 },
  pra: { label: 'Points + rebounds + assists', sports: ['nba', 'ncaab'], kind: 'bb', disp: 2.6, sum: ['pts', 'reb', 'ast'] },
  pr: { label: 'Points + rebounds', sports: ['nba', 'ncaab'], kind: 'bb', disp: 2.4, sum: ['pts', 'reb'] },
  pa: { label: 'Points + assists', sports: ['nba', 'ncaab'], kind: 'bb', disp: 2.4, sum: ['pts', 'ast'] },
  ra: { label: 'Rebounds + assists', sports: ['nba', 'ncaab'], kind: 'bb', disp: 1.5, sum: ['reb', 'ast'] },
  // football
  passYds: { label: 'Passing yards', sports: ['nfl', 'cfb'], kind: 'yards', sdFrac: 0.3 },
  rushYds: { label: 'Rushing yards', sports: ['nfl', 'cfb'], kind: 'yards', sdFrac: 0.52 },
  recYds: { label: 'Receiving yards', sports: ['nfl', 'cfb'], kind: 'yards', sdFrac: 0.58 },
  rushRecYds: { label: 'Rushing + receiving yards', sports: ['nfl', 'cfb'], kind: 'yards', sdFrac: 0.45, sum: ['rushYds', 'recYds'] },
  rec: { label: 'Receptions', sports: ['nfl', 'cfb'], kind: 'count', disp: 0.85 },
  passAtt: { label: 'Pass attempts', sports: ['nfl', 'cfb'], kind: 'count', disp: 0.45 },
  passCmp: { label: 'Completions', sports: ['nfl', 'cfb'], kind: 'count', disp: 0.5 },
  rushAtt: { label: 'Rush attempts', sports: ['nfl', 'cfb'], kind: 'count', disp: 0.7 },
  passTD: { label: 'Passing touchdowns', sports: ['nfl', 'cfb'], kind: 'count', disp: 1 },
  ints: { label: 'Interceptions thrown', sports: ['nfl', 'cfb'], kind: 'count', disp: 1 },
  anyTD: { label: 'Anytime touchdown', sports: ['nfl', 'cfb'], kind: 'td' },
};

// ---------------------------------------------------------------- odds math

export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || (a > -100 && a < 100)) return NaN;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

export function decimalToAmerican(dec) {
  if (!(dec > 1)) return NaN;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

export function impliedProb(american) {
  const d = americanToDecimal(american);
  return Number.isFinite(d) ? 1 / d : NaN;
}

// Two-way market with the vig removed.
export function noVig(aAmerican, bAmerican) {
  const pa = impliedProb(aAmerican);
  const pb = impliedProb(bAmerican);
  if (!(pa > 0 && pb > 0)) return null;
  return [pa / (pa + pb), pb / (pa + pb)];
}

export function profitOnWin(stake, american) {
  return round2(stake * (americanToDecimal(american) - 1));
}

export function formatAmerican(american) {
  const a = Math.round(Number(american));
  if (!Number.isFinite(a)) return '';
  return a > 0 ? `+${a}` : String(a);
}

// Hedge stake that locks the same profit on both outcomes.
// stake/odds: the original bet. hedgeOdds: the price on the other side now.
export function hedgePlan(stake, odds, hedgeOdds) {
  const d1 = americanToDecimal(odds);
  const d2 = americanToDecimal(hedgeOdds);
  if (!(d1 > 1 && d2 > 1 && stake > 0)) return null;
  const hedge = (stake * d1) / d2;
  const locked = stake * d1 - stake - hedge;
  return { hedgeStake: round2(hedge), lockedProfit: round2(locked) };
}

// Hedge versus the book's cash out offer. lockedProfit: what a full hedge locks (it can be a
// loss). The cash out profit is the offer minus your stake (a bonus bet's stake was never yours).
// The formulas for the hedge itself follow arbitrage_hedge in penaltyblog (MIT,
// github.com/martineastwood/penaltyblog); the code here is written fresh for Sweat.
export function cashOutVerdict(lockedProfit, cashOut, stake, bonus) {
  if (!Number.isFinite(lockedProfit) || !Number.isFinite(cashOut) || cashOut < 0) return null;
  const cashProfit = cashOut - (bonus ? 0 : Number(stake) || 0);
  const diff = round2(lockedProfit - cashProfit);
  return { cashProfit: round2(cashProfit), diff, better: diff > 0.005 ? 'hedge' : diff < -0.005 ? 'cash' : 'same' };
}

// ---------------------------------------------------------------- normal and friends

function erf(x) {
  // Abramowitz and Stegun 7.1.26, max error 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function normCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Acklam's inverse normal CDF.
export function normInv(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q;
  let r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- integer distributions
// A distribution over integers: { lo, p } where p[i] = P(X = lo + i).

function point(k) {
  return { lo: Math.round(k), p: [1] };
}

function trim(d, eps = 1e-12) {
  let a = 0;
  let b = d.p.length - 1;
  while (a < b && d.p[a] < eps) a++;
  while (b > a && d.p[b] < eps) b--;
  return { lo: d.lo + a, p: d.p.slice(a, b + 1) };
}

function shift(d, k) {
  return { lo: d.lo + k, p: d.p };
}

function negate(d) {
  return { lo: -(d.lo + d.p.length - 1), p: d.p.slice().reverse() };
}

function convolve(x, y) {
  const out = new Array(x.p.length + y.p.length - 1).fill(0);
  for (let i = 0; i < x.p.length; i++) {
    const xi = x.p[i];
    if (xi === 0) continue;
    for (let j = 0; j < y.p.length; j++) out[i + j] += xi * y.p[j];
  }
  return trim({ lo: x.lo + y.lo, p: out });
}

function mix(parts) {
  // parts: [[weight, dist], ...]
  let lo = Infinity;
  let hi = -Infinity;
  for (const [w, d] of parts) {
    if (w <= 0) continue;
    lo = Math.min(lo, d.lo);
    hi = Math.max(hi, d.lo + d.p.length - 1);
  }
  if (lo === Infinity) return point(0);
  const out = new Array(hi - lo + 1).fill(0);
  for (const [w, d] of parts) {
    if (w <= 0) continue;
    for (let i = 0; i < d.p.length; i++) out[d.lo - lo + i] += w * d.p[i];
  }
  return { lo, p: out };
}

function normalize(d) {
  const s = d.p.reduce((a, b) => a + b, 0);
  return s > 0 ? { lo: d.lo, p: d.p.map((v) => v / s) } : d;
}

// Normal distribution rounded to integers (continuity correction).
function discreteNormal(mu, sd) {
  if (!(sd > 0.05)) return point(mu);
  const lo = Math.floor(mu - 7 * sd);
  const hi = Math.ceil(mu + 7 * sd);
  const p = [];
  for (let k = lo; k <= hi; k++) p.push(normCdf((k + 0.5 - mu) / sd) - normCdf((k - 0.5 - mu) / sd));
  return trim(normalize({ lo, p }));
}

// Non-negative count with mean mu and variance phi*mu (negative binomial when phi > 1).
function countDist(mu, phi = 1) {
  if (!(mu > 1e-9)) return point(0);
  const hi = Math.ceil(mu + 10 * Math.sqrt(mu * Math.max(phi, 1)) + 10);
  const p = [];
  if (phi <= 1.02) {
    let v = Math.exp(-mu);
    for (let k = 0; k <= hi; k++) {
      p.push(v);
      v = (v * mu) / (k + 1);
    }
  } else {
    const r = mu / (phi - 1);
    const q = 1 / phi; // success probability
    let v = Math.exp(r * Math.log(q));
    for (let k = 0; k <= hi; k++) {
      p.push(v);
      v = (v * (k + r) * (1 - q)) / (k + 1);
    }
  }
  return trim(normalize({ lo: 0, p }));
}

// P(X > x), P(X == x), P(X < x) for a real threshold x.
function compare(d, x) {
  let gt = 0;
  let eq = 0;
  let lt = 0;
  for (let i = 0; i < d.p.length; i++) {
    const k = d.lo + i;
    if (k > x + 1e-9) gt += d.p[i];
    else if (Math.abs(k - x) <= 1e-9) eq += d.p[i];
    else lt += d.p[i];
  }
  return { gt, eq, lt };
}

export function distMean(d) {
  let m = 0;
  for (let i = 0; i < d.p.length; i++) m += (d.lo + i) * d.p[i];
  return m;
}

// ---------------------------------------------------------------- clock

// Seconds of regulation left in the game, in a segment, and in the current half.
// game: normalized game ({ state, period, clock, ... }), sp: SPORTS entry.
export function clockState(game, sp, segment = 'game') {
  const regPeriods = game.regulationPeriods || sp.periods;
  const periodSec = game.periodSec || sp.periodSec;
  const regSec = regPeriods * periodSec;
  const endPeriod = segment === '1h' ? regPeriods / 2 : segment === '1q' ? 1 : regPeriods;
  const segSec = endPeriod * periodSec;
  if (game.state === 'pre' || !game.period) {
    return { regSec, segSec, left: segSec, frac: 1, inOT: false, segDone: false, halfLeft: (regPeriods / 2) * periodSec };
  }
  const period = Number(game.period) || 1;
  const clock = Math.max(0, Number(game.clock) || 0);
  if (period > regPeriods) {
    return { regSec, segSec, left: 0, frac: 0, inOT: true, otLeft: clock, segDone: segment !== 'game', halfLeft: 0 };
  }
  if (period > endPeriod) {
    return { regSec, segSec, left: 0, frac: 0, inOT: false, segDone: true, halfLeft: 0 };
  }
  const left = (endPeriod - period) * periodSec + clock;
  const half = regPeriods / 2;
  const halfLeft = (period <= half ? half - period : regPeriods - period) * periodSec + clock;
  return {
    regSec,
    segSec,
    left,
    frac: clamp(left / segSec, 0, 1),
    inOT: false,
    // A half or quarter is over once ESPN calls it (halftime, end of period). A clock at 0:00
    // alone is not enough: an extra point or a review can still change the score.
    segDone: segment !== 'game' && left <= 0 && (/HALFTIME|END_PERIOD/.test(game.statusName || '') || game.state === 'post'),
    halfLeft,
  };
}

// Score for a side through the end of a segment, from period line scores.
function segmentScore(team, endPeriod) {
  const ls = team.linescores || [];
  let s = 0;
  for (let i = 0; i < Math.min(endPeriod, ls.length); i++) s += Number(ls[i]) || 0;
  return s;
}

function segmentEnd(sp, game, segment) {
  const reg = game.regulationPeriods || sp.periods;
  return segment === '1h' ? reg / 2 : segment === '1q' ? 1 : reg;
}

// Current score inside a segment (game scores for the full game).
function currentScores(game, sp, segment) {
  if (segment === 'game') return { h: Number(game.home.score) || 0, a: Number(game.away.score) || 0 };
  const end = segmentEnd(sp, game, segment);
  const hl = game.home.linescores || [];
  if (hl.length) return { h: segmentScore(game.home, end), a: segmentScore(game.away, end) };
  return { h: Number(game.home.score) || 0, a: Number(game.away.score) || 0 };
}

// ---------------------------------------------------------------- market priors

// Expected full-game home margin and total from the market, with fallbacks.
export function marketPrior(game, sp, leg) {
  let spreadHome = game.odds && Number.isFinite(game.odds.spreadHome) ? game.odds.spreadHome : null;
  let total = game.odds && Number.isFinite(game.odds.total) ? game.odds.total : null;
  if (spreadHome == null && leg) {
    if (leg.market === 'spread' && leg.segment === 'game' && Number.isFinite(leg.line)) {
      spreadHome = leg.side === 'home' ? leg.line : -leg.line;
    } else if (leg.market === 'moneyline' && Number.isFinite(leg.odds)) {
      const p = clamp(impliedProb(leg.odds) - 0.02, 0.02, 0.98);
      const sd = sp.kind === 'football' ? 12.8 : sp.marginSD || 12;
      const homeP = leg.side === 'home' ? p : 1 - p;
      spreadHome = -normInv(homeP) * sd;
    }
  }
  if (total == null && leg && leg.market === 'total' && leg.segment === 'game' && Number.isFinite(leg.line)) total = leg.line;
  if (spreadHome == null) spreadHome = 0;
  if (total == null) total = sp.key === 'nfl' ? 44 : sp.key === 'cfb' ? 54 : sp.key === 'nba' ? 228 : 142;
  return { spreadHome, total, expMargin: -spreadHome };
}

// ---------------------------------------------------------------- football model

// In-progress drive outcome by field position (yards from the offense's own goal line).
// Measured on 2023 to 2025 NFL scrimmage plays: share of drives ending in a TD or FG.
const DRIVE_Y = [5, 15, 25, 35, 45, 55, 65, 75, 85, 92.5, 97.5];
const DRIVE_TD = [0.117, 0.133, 0.163, 0.193, 0.231, 0.272, 0.309, 0.372, 0.436, 0.531, 0.712];
const DRIVE_FG = [0.063, 0.085, 0.115, 0.134, 0.174, 0.231, 0.364, 0.422, 0.419, 0.355, 0.174];
const FOURTH_TD = [0, 0.008, 0.012, 0.021, 0.037, 0.082, 0.087, 0.079, 0.102, 0.116, 0.38];
const FOURTH_FG = [0.004, 0.001, 0.005, 0.013, 0.027, 0.076, 0.476, 0.653, 0.745, 0.722, 0.38];
// Points on a touchdown: extra point good, missed or failed two, two-point good.
const TD_VALUES = [[7, 0.866], [6, 0.089], [8, 0.045]];

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

function driveStep(pTD, pFG) {
  const none = clamp(1 - pTD - pFG, 0, 1);
  const p = new Array(9).fill(0);
  p[0] = none;
  p[3] += pFG;
  for (const [v, w] of TD_VALUES) p[v] += pTD * w;
  return { lo: 0, p };
}

// Strength multiplier k so a team's expected points per drive match the market.
function strength(sp, ptsPerDrive) {
  const a = 6.956 * sp.tdBase * sp.tdScale;
  const b = 3 * sp.fgBase * sp.fgScale;
  const e = Math.max(0.05, ptsPerDrive);
  const u = (-b + Math.sqrt(b * b + 4 * a * e)) / (2 * a);
  return u * u;
}

function teamRates(sp, k) {
  let td = sp.tdBase * sp.tdScale * k;
  let fg = sp.fgBase * sp.fgScale * Math.sqrt(k);
  const cap = 0.9;
  if (td + fg > cap) {
    const s = cap / (td + fg);
    td *= s;
    fg *= s;
  }
  return { td, fg };
}

// ctx: { halfLeft, gameLeft, trailBy } for the team with the ball.
function currentDriveRates(sp, k, situation, ctx) {
  const y = clamp(Number(situation.yOwn) || 25, 1, 99);
  const fourth = Number(situation.down) === 4;
  let td = interp(DRIVE_Y, fourth ? FOURTH_TD : DRIVE_TD, y);
  let fg = interp(DRIVE_Y, fourth ? FOURTH_FG : DRIVE_FG, y);
  td *= Math.pow(k, 0.5) * (sp.key === 'cfb' ? 1.12 : 1);
  fg *= Math.pow(k, 0.3) * (sp.key === 'cfb' ? 0.85 : 1);
  // Not enough clock to cover the field: about 1.1 seconds a yard in a hurry-up.
  const needTD = (100 - y) * 1.1 + 30;
  const needFG = Math.max(0, 63 - y) * 1.1 + 25;
  if (ctx.halfLeft < needTD) td *= clamp(ctx.halfLeft / needTD, 0.05, 1);
  if (ctx.halfLeft < needFG) fg *= clamp(ctx.halfLeft / needFG, 0.05, 1);
  // Down 4 to 8 late, a field goal does not help much, so teams go for it.
  if (ctx.gameLeft < 240 && ctx.trailBy >= 4 && ctx.trailBy <= 8) {
    td += LATE.mustTd * fg;
    fg *= LATE.mustFg;
  }
  const s = td + fg;
  if (s > 0.95) {
    td *= 0.95 / s;
    fg *= 0.95 / s;
  }
  return { td, fg };
}

// Final-margin key numbers (3, 7, 10, 14 ...) are stronger in real games than in
// independent drives: late-game play calling bunches results there. Weights by absolute
// margin, fitted on NFL closing lines and finals (scripts/calibrate-nfl.mjs), fade as the
// game runs down because the remaining drives already carry the late-game shape.
function applyKeyWeights(dist, weights, strength) {
  if (!weights || !(strength > 0)) return dist;
  const p = dist.p.map((v, i) => {
    const k = Math.abs(dist.lo + i);
    const w = k < weights.length ? weights[k] : 1;
    return v * Math.pow(w, strength);
  });
  return normalize({ lo: dist.lo, p });
}

function teamPointsDist(nDrives, rates, first, extra = []) {
  let d = point(0);
  if (first) d = convolve(d, driveStep(first.td, first.fg));
  const step = driveStep(rates.td, rates.fg);
  const whole = Math.floor(nDrives + 1e-9);
  const frac = nDrives - whole;
  for (let i = 0; i < whole; i++) d = convolve(d, step);
  if (frac > 1e-6) d = mix([[1 - frac, d], [frac, convolve(d, step)]]);
  // Late drives, each with its own odds and a chance it happens at all.
  for (const x of extra) {
    if (!(x.w > 0)) continue;
    d = mix([[1 - x.w, d], [x.w, convolve(d, driveStep(x.td, x.fg))]]);
  }
  return d;
}

// End of a half, drive by drive: leaders burn clock, trailers hurry, and a drive with
// little time left scores less. Leads are taken from the current score.
// tune: { lead, trail, even, mustTd } seconds per drive and the must-score shift.
export const LATE = { lead: 150, trail: 70, even: 100, protect: 0.8, mustTd: 0.3, mustFg: 0.4 };

function lateDrives(left, possSide, possLead, rH, rA) {
  const out = { home: [], away: [] };
  const dur = (lead) => (lead > 0 ? LATE.lead : lead < 0 ? LATE.trail : LATE.even);
  let t = left - dur(possLead);
  let side = possSide === 'home' ? 'away' : 'home';
  for (let i = 0; i < 8 && t > 5; i++) {
    const lead = side === possSide ? possLead : -possLead;
    const base = side === 'home' ? rH : rA;
    let td = base.td * clamp(t / ((100 - 25) * 1.1 + 30), 0.05, 1);
    let fg = base.fg * clamp(t / ((63 - 25) * 1.1 + 25), 0.05, 1);
    if (lead <= -4 && lead >= -8 && t < 240) {
      td += LATE.mustTd * fg;
      fg *= LATE.mustFg;
    }
    if (lead > 0) {
      td *= LATE.protect;
      fg *= LATE.protect;
    }
    out[side].push({ td, fg, w: clamp(t / 30, 0, 1) });
    t -= dur(lead);
    side = side === 'home' ? 'away' : 'home';
  }
  return out;
}

// Overtime margin from the home side, given regulation ended tied.
function footballOT(sp, homeEdge, playoff) {
  const q = clamp(0.5 + homeEdge, 0.2, 0.8);
  const tie = playoff ? 0 : sp.tieInOt || 0;
  const shape = sp.key === 'cfb'
    ? [[3, 0.36], [7, 0.3], [6, 0.08], [8, 0.12], [1, 0.06], [2, 0.08]]
    : [[3, 0.52], [6, 0.3], [4, 0.05], [7, 0.08], [8, 0.05]];
  const p = {};
  for (const [m, w] of shape) {
    p[m] = (p[m] || 0) + (1 - tie) * q * w;
    p[-m] = (p[-m] || 0) + (1 - tie) * (1 - q) * w;
  }
  p[0] = (p[0] || 0) + tie;
  const ks = Object.keys(p).map(Number);
  const lo = Math.min(...ks);
  const hi = Math.max(...ks);
  const arr = new Array(hi - lo + 1).fill(0);
  for (const k of ks) arr[k - lo] = p[k];
  return { lo, p: arr, addTotal: sp.key === 'cfb' ? 9 : 4 };
}

// Remaining scoring for one set of expected points (the market's, or a what-if around it).
function footballDists(game, sp, segment, prior, cs, scores) {
  const segShare = segment === '1h' ? 0.5 : segment === '1q' ? 0.25 : 1;
  const expHome = ((prior.total + prior.expMargin) / 2) * segShare;
  const expAway = ((prior.total - prior.expMargin) / 2) * segShare;
  const drivesFull = sp.drives * segShare;
  const kH = strength(sp, expHome / drivesFull);
  const kA = strength(sp, expAway / drivesFull);
  const rH = teamRates(sp, kH);
  const rA = teamRates(sp, kA);

  let first = null;
  let firstSide = null;
  const sit = game.situation;
  const live = game.state === 'in' && cs.left > 0;
  const halftime = /HALFTIME/.test(game.statusName || '');
  if (live && !halftime && sit && (sit.side === 'home' || sit.side === 'away')) {
    firstSide = sit.side;
    const lead = firstSide === 'home' ? scores.h - scores.a : scores.a - scores.h;
    const gameLeft = segment === 'game' ? cs.left : clockState(game, sp, 'game').left;
    first = currentDriveRates(sp, firstSide === 'home' ? kH : kA, sit, { halfLeft: cs.halfLeft, gameLeft, trailBy: -lead });
  }
  let fresh = (2 * drivesFull * cs.left) / cs.segSec;
  if (first) fresh = Math.max(0, fresh - 0.5);
  if (!live && game.state === 'in') fresh = 0;
  let nH = fresh / 2;
  let nA = fresh / 2;
  let late = { home: [], away: [] };
  // The segment ends with the current half and under 8 minutes remain: drive by drive.
  const reg = game.regulationPeriods || sp.periods;
  const endsThisHalf = (segment === 'game' && Number(game.period) > reg / 2) || (segment === '1h' && Number(game.period) <= reg / 2);
  if (firstSide && endsThisHalf && cs.left < 480) {
    const possLead = firstSide === 'home' ? scores.h - scores.a : scores.a - scores.h;
    late = lateDrives(cs.left, firstSide, possLead, rH, rA);
    nH = 0;
    nA = 0;
  } else if (firstSide) {
    const lean = Math.min(0.25, fresh / 4);
    if (firstSide === 'home') {
      nA += lean;
      nH -= lean;
    } else {
      nH += lean;
      nA -= lean;
    }
  }
  const home = teamPointsDist(Math.max(0, nH), rH, firstSide === 'home' ? first : null, late.home);
  const away = teamPointsDist(Math.max(0, nA), rA, firstSide === 'away' ? first : null, late.away);
  return {
    margin: shift(convolve(home, negate(away)), scores.h - scores.a),
    total: shift(convolve(home, away), scores.h + scores.a),
    home: shift(home, scores.h),
    away: shift(away, scores.a),
    kH,
    kA,
    perDriveSec: cs.segSec / (2 * drivesFull),
  };
}

// Three-point Gauss-Hermite rule: mixing these what-ifs adds exactly sd^2 of variance.
const GH3 = [[-Math.sqrt(3), 1 / 6], [0, 2 / 3], [Math.sqrt(3), 1 / 6]];

// Remaining-scoring distributions for a football game or segment.
// model_opts: { noKeyWeights, noWiden } (used by the calibration scripts).
export function footballModel(game, sp, segment = 'game', leg = null, model_opts = null) {
  const prior = marketPrior(game, sp, leg);
  const cs = clockState(game, sp, segment);
  const scores = currentScores(game, sp, segment);
  // College lines miss by more than drive-to-drive luck explains (bigger talent gaps, less
  // market money). Mix a few what-ifs around the line instead of blurring the result, so the
  // 3s and 7s survive. Each what-if moves the remaining drives, so the effect fades with the clock.
  const widen = (sp.extraM || sp.extraT) && !(model_opts && model_opts.noWiden);
  const parts = [];
  for (const [zm, wm] of widen ? GH3 : [[0, 1]]) {
    for (const [zt, wt] of widen ? GH3 : [[0, 1]]) {
      const dm = zm * (sp.extraM || 0);
      const dt = zt * (sp.extraT || 0);
      const p = { spreadHome: prior.spreadHome - dm, total: Math.max(10, prior.total + dt), expMargin: prior.expMargin + dm };
      parts.push([wm * wt, footballDists(game, sp, segment, p, cs, scores)]);
    }
  }
  const pick = (k) => (parts.length === 1 ? parts[0][1][k] : mix(parts.map(([w, d]) => [w, d[k]])));
  let margin = pick('margin');
  let total = pick('total');
  const homeTeam = pick('home');
  const awayTeam = pick('away');
  const base = parts.length === 1 ? parts[0][1] : parts[4][1];

  // Overtime only in full-game markets.
  if (segment === 'game') {
    const playoff = game.seasonType === 3;
    const edge = clamp((base.kH - base.kA) * 0.12, -0.15, 0.15);
    const ot = footballOT(sp, edge, playoff);
    if (cs.inOT) {
      const nowM = scores.h - scores.a;
      if (nowM === 0) {
        margin = { lo: ot.lo, p: ot.p };
        total = point(scores.h + scores.a + ot.addTotal);
      } else {
        // Someone already scored in overtime: the lead usually holds.
        margin = discreteNormal(nowM, 3.5);
        total = discreteNormal(scores.h + scores.a + 2, 3);
      }
    } else {
      const tieMass = compare(margin, 0).eq;
      if (tieMass > 0) {
        const notTie = { lo: margin.lo, p: margin.p.map((v, i) => (margin.lo + i === 0 ? 0 : v)) };
        margin = mix([[1, notTie], [tieMass, { lo: ot.lo, p: ot.p }]]);
        total = mix([[1 - tieMass, total], [tieMass, shift(total, ot.addTotal)]]);
      }
    }
  }
  if (segment === 'game' && !(model_opts && model_opts.noKeyWeights)) {
    margin = applyKeyWeights(margin, sp.keyWeights, Math.sqrt(cs.frac));
  }
  return { margin: trim(margin), total: trim(total), home: trim(homeTeam), away: trim(awayTeam), clock: cs, perDriveSec: base.perDriveSec, prior };
}

// ---------------------------------------------------------------- basketball model

// Share of the remaining variance still to come with fraction f of the clock left. Real games
// pack extra swings into the last minutes (fouling, threes), so part of it scales with sqrt(f).
// Inside the last minute (f0) the extra part shrinks to zero in step with the clock.
function timeVar(f, late, f0 = 0.02) {
  if (!(f > 0)) return 0;
  const g = f >= f0 ? Math.sqrt(f) : f / Math.sqrt(f0);
  return (1 - late) * f + late * g;
}

// Extra points (and spread) from the foul game: full strength inside sp.foulSec seconds,
// fading out by 1.5 times that, for margins within about two possessions.
function foulGame(sp, secLeft, margin) {
  if (!sp.foulSec || !(secLeft > 0) || secLeft >= 1.5 * sp.foulSec) return { mean: 0, var: 0 };
  const w = secLeft <= sp.foulSec ? 1 : (1.5 * sp.foulSec - secLeft) / (0.5 * sp.foulSec);
  const close = clamp((10 - Math.abs(margin)) / 7, 0, 1);
  const s = w * close;
  return { mean: sp.foulPts * s, var: (sp.foulSD * s) ** 2 };
}

// Cumulative share of regulation points scored by elapsed fraction e of regulation. Measured
// minute by minute on 2024-25 play-by-play: college games score more after halftime (the bonus)
// and both leagues speed up in the last minutes.
function scoringShare(sp, e) {
  const P = sp.profile;
  const x = clamp(e, 0, 1);
  if (!P) return x;
  const k = x * (P.length - 1);
  const i = Math.min(P.length - 2, Math.floor(k));
  return P[i] + (P[i + 1] - P[i]) * (k - i);
}

export function basketballModel(game, sp, segment = 'game', leg = null) {
  const prior = marketPrior(game, sp, leg);
  const cs = clockState(game, sp, segment);
  const scores = currentScores(game, sp, segment);
  const segShare = segment === '1h' ? 0.5 : segment === '1q' ? 0.25 : 1;
  const expMargin = prior.expMargin * segShare;
  const f = cs.inOT ? 0 : cs.frac;
  const nowM = scores.h - scores.a;
  const nowT = scores.h + scores.a;
  // Points still to come, as a share of the segment's points.
  const gameLeft = segment === 'game' ? cs.left : clockState(game, sp, 'game').left;
  const eNow = game.state === 'pre' || !game.period ? 0 : cs.inOT ? 1 : clamp(1 - gameLeft / cs.regSec, 0, 1);
  const segQ = scoringShare(sp, segShare);
  const fT = cs.inOT ? 0 : clamp((segQ - scoringShare(sp, Math.min(eNow, segShare))) / segQ, 0, 1);
  const expTotal = prior.total * segQ;
  let paceTotal = expTotal;
  if (1 - fT >= 0.15 && game.state === 'in' && sp.paceWeight < 1) {
    const paceFull = nowT / (1 - fT);
    paceTotal = sp.paceWeight * expTotal + (1 - sp.paceWeight) * paceFull;
  }
  const mSD = sp.marginSD * Math.sqrt(segShare);
  const tSD = sp.totalSD * Math.sqrt(segQ);
  // Leads bigger than the line expected tend to shrink (benches, fouling, effort).
  const surprise = nowM - expMargin * (1 - f);
  const muM = nowM + expMargin * f - (sp.revert || 0) * surprise * f;
  // Close game in the last minutes: fouling adds free throws and possessions.
  const secLeft = cs.inOT ? Number(cs.otLeft) || 0 : segment === 'game' ? cs.left : Infinity;
  const foul = game.state === 'in' ? foulGame(sp, secLeft, nowM) : { mean: 0, var: 0 };
  const muT = nowT + paceTotal * fT + foul.mean;
  const f0 = 60 / cs.regSec;
  const vm = timeVar(f, sp.lateM || 0, f0);
  const vt = timeVar(fT, sp.lateT || 0, f0);
  let margin = discreteNormal(muM, mSD * Math.sqrt(vm));
  let total = discreteNormal(muT, Math.sqrt(tSD * tSD * vt + foul.var));
  const teamSD = Math.sqrt(mSD * mSD * vm + tSD * tSD * vt + foul.var) / 2;
  let home = discreteNormal(scores.h + (muT - nowT + muM - nowM) / 2, teamSD);
  let away = discreteNormal(scores.a + (muT - nowT - (muM - nowM)) / 2, teamSD);

  if (segment === 'game') {
    const otShare = sp.otSec / cs.regSec;
    const otM = sp.marginSD * Math.sqrt(otShare);
    const otT = paceTotal * otShare;
    // One overtime period; a tie after it is re-rolled, which just renormalizes.
    const otRaw = discreteNormal(expMargin * otShare, otM);
    const otMarginDist = normalize({ lo: otRaw.lo, p: otRaw.p.map((v, i) => (otRaw.lo + i === 0 ? 0 : v)) });
    if (cs.inOT) {
      const otLeftShare = (Number(cs.otLeft) || 0) / cs.regSec;
      const d = discreteNormal(nowM + expMargin * otLeftShare, sp.marginSD * Math.sqrt(Math.max(otLeftShare, 1e-6)));
      const tie = compare(d, 0).eq;
      const noTie = { lo: d.lo, p: d.p.map((v, i) => (d.lo + i === 0 ? 0 : v)) };
      margin = mix([[1, noTie], [tie, otMarginDist]]);
      total = discreteNormal(nowT + paceTotal * otLeftShare + foul.mean + tie * otT, Math.sqrt(tSD * tSD * Math.max(otLeftShare, 1e-6) + foul.var));
    } else {
      const tie = compare(margin, 0).eq;
      if (tie > 0) {
        const noTie = { lo: margin.lo, p: margin.p.map((v, i) => (margin.lo + i === 0 ? 0 : v)) };
        margin = mix([[1, noTie], [tie, otMarginDist]]);
        total = mix([[1 - tie, total], [tie, shift(total, Math.round(otT))]]);
        home = mix([[1 - tie, home], [tie, shift(home, Math.round(otT / 2))]]);
        away = mix([[1 - tie, away], [tie, shift(away, Math.round(otT / 2))]]);
      }
    }
  }
  return { margin: trim(margin), total: trim(total), home: trim(home), away: trim(away), clock: cs, prior };
}

// ---------------------------------------------------------------- player props

const BB_KEYS = { pts: 'pts', reb: 'reb', ast: 'ast', threes: 'threes', stl: 'stl', blk: 'blk' };

function statValue(stats, stat) {
  const def = STATS[stat];
  if (!stats) return 0;
  if (def && def.sum) return def.sum.reduce((s, k) => s + (Number(stats[k]) || 0), 0);
  return Number(stats[stat]) || 0;
}

// Touchdowns a player scored himself: rushing, receiving, kick or punt returns, defense.
// (Passing touchdowns do not count for anytime touchdown bets.)
function touchdowns(s) {
  if (!s) return 0;
  return ['rushTD', 'recTD', 'retTD', 'defTD'].reduce((n, k) => n + (Number(s[k]) || 0), 0);
}

// Distribution of a player's final stat. player: { stats, starter, didNotPlay, ejected, side }.
export function propModel(leg, game, sp, player) {
  const def = STATS[leg.stat];
  const line = Number(leg.line);
  const cs = clockState(game, sp, 'game');
  const now = statValue(player && player.stats, leg.stat);
  const f = game.state === 'pre' ? 1 : game.state === 'post' ? 0 : cs.frac;
  if (!def) return { dist: point(now), now };

  if (def.kind === 'td') {
    const p = clamp(impliedProb(leg.odds) || 0.35, 0.02, 0.95);
    const lam = -Math.log(1 - p) * f;
    const scored = touchdowns(player && player.stats);
    return { dist: shift(countDist(lam, 1), scored), now: scored };
  }

  if (sp.kind === 'basketball') {
    const regMin = (sp.periods * sp.periodSec) / 60;
    const starter = player ? player.starter !== false : true;
    const expMin = starter ? sp.starterMin : sp.benchMin;
    const minPlayed = Number(player && player.stats && player.stats.min) || 0;
    const elapsedMin = regMin * (1 - f);
    const leftMin = regMin * f;
    const priorShare = expMin / regMin;
    const share = elapsedMin > 0 ? (minPlayed + 6 * priorShare) / (elapsedMin + 6) : priorShare;
    let restMin = clamp(share, 0, 1) * leftMin;
    const fouls = Number(player && player.stats && player.stats.pf) || 0;
    if (fouls >= sp.foulOut || (player && player.ejected)) restMin = 0;
    const margin = Math.abs((Number(game.home.score) || 0) - (Number(game.away.score) || 0));
    const lastPeriod = Number(game.period) >= sp.periods;
    if (lastPeriod && margin >= 18 && game.state === 'in') restMin *= starter ? 0.45 : 1.25;
    const priorRate = line / expMin;
    const k = 10;
    const rate = (now + priorRate * k) / (minPlayed + k);
    const mu = Math.max(0, rate * restMin);
    return { dist: shift(countDist(mu, def.disp || 1.5), now), now, mu };
  }

  // Football props.
  const priorFull = line;
  const elapsed = 1 - f;
  const kWeight = 0.6;
  const fullEst = elapsed > 0 ? (now + priorFull * kWeight) / (elapsed + kWeight) : priorFull;
  const mu = Math.max(0, fullEst * f);
  if (def.kind === 'yards') {
    const sd = Math.max(4, priorFull * def.sdFrac) * Math.sqrt(f);
    const d = discreteNormal(now + mu, sd);
    // Yards can drop a little on losses but rarely below the current figure by much.
    return { dist: d, now, mu };
  }
  return { dist: shift(countDist(mu, def.disp || 1), now), now, mu };
}

// ---------------------------------------------------------------- legs

export const MARKETS = {
  spread: 'Spread',
  moneyline: 'Moneyline',
  total: 'Total',
  team_total: 'Team total',
  prop: 'Player prop',
};

export const SEGMENTS = { game: 'Game', '1h': '1st half', '1q': '1st quarter' };

const FINAL_BAD = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_SUSPENDED', 'STATUS_FORFEIT']);

function outcomeFromValue(value, leg) {
  // value: the settled integer quantity for this leg (team margin, total, stat).
  const line = Number(leg.line);
  if (leg.market === 'moneyline') return value > 0 ? 'won' : value < 0 ? 'lost' : 'push';
  if (leg.market === 'spread') {
    const c = value + line;
    return c > 1e-9 ? 'won' : c < -1e-9 ? 'lost' : 'push';
  }
  if (leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td') {
    const yes = leg.side !== 'no';
    return (value >= 1) === yes ? 'won' : 'lost';
  }
  const over = leg.side === 'over';
  if (Math.abs(value - line) <= 1e-9) return 'push';
  return (value > line) === over ? 'won' : 'lost';
}

function probsFromDist(dist, leg) {
  const line = Number(leg.line);
  if (leg.market === 'moneyline') {
    const c = compare(dist, 0);
    return { win: c.gt, push: c.eq, lose: c.lt };
  }
  if (leg.market === 'spread') {
    const c = compare(dist, -line);
    return { win: c.gt, push: c.eq, lose: c.lt };
  }
  if (leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td') {
    const c = compare(dist, 0.5);
    const yes = leg.side !== 'no';
    return yes ? { win: c.gt, push: 0, lose: c.lt } : { win: c.lt, push: 0, lose: c.gt };
  }
  const c = compare(dist, line);
  return leg.side === 'over' ? { win: c.gt, push: c.eq, lose: c.lt } : { win: c.lt, push: c.eq, lose: c.gt };
}

// Team-perspective margin distribution for spread and moneyline legs.
function sideMargin(model, leg) {
  return leg.side === 'away' ? negate(model.margin) : model.margin;
}

function legDist(leg, game, sp, model, player) {
  if (leg.market === 'spread' || leg.market === 'moneyline') return sideMargin(model, leg);
  if (leg.market === 'total') return model.total;
  if (leg.market === 'team_total') return leg.team === 'away' ? model.away : model.home;
  if (leg.market === 'prop') return propModel(leg, game, sp, player).dist;
  return point(0);
}

// The settled value of a leg once its segment or game is over.
function settledValue(leg, game, sp, player) {
  const seg = leg.segment || 'game';
  const sc = currentScores(game, sp, seg);
  if (leg.market === 'spread' || leg.market === 'moneyline') return leg.side === 'away' ? sc.a - sc.h : sc.h - sc.a;
  if (leg.market === 'total') return sc.h + sc.a;
  if (leg.market === 'team_total') return leg.team === 'away' ? sc.a : sc.h;
  if (leg.market === 'prop') {
    if (STATS[leg.stat] && STATS[leg.stat].kind === 'td') {
      const s = player && player.stats;
      return touchdowns(s);
    }
    return statValue(player && player.stats, leg.stat);
  }
  return 0;
}

// Evaluate one leg against the latest game state.
// Returns { status, win, push, lose, now, text } where status is one of
// pending, live, won, lost, push, void.
// opts.statsFinal: false while the box score has not caught up with a final scoreboard, so
// props wait instead of settling on old numbers.
export function evaluateLeg(leg, game, players = {}, opts = {}) {
  const sp = SPORTS[leg.sport];
  if (!sp || !game) return { status: 'pending', win: NaN, push: 0, lose: NaN, text: 'Waiting for the game' };
  const seg = leg.segment || 'game';

  if (game.statusName && FINAL_BAD.has(game.statusName)) {
    return { status: 'void', win: 0, push: 1, lose: 0, text: 'Game not played' };
  }

  // Fights: no live model, the pre-fight price until there is a result.
  if (sp.kind === 'fight') {
    const p = Number.isFinite(leg.myProb) ? leg.myProb : clamp((impliedProb(leg.odds) || 0.5) - 0.02, 0.01, 0.99);
    if (game.state === 'post' && game.completed) {
      const winner = game.winner; // 'home' | 'away' | 'draw' | null
      if (winner === 'draw') return { status: 'push', win: 0, push: 1, lose: 0, text: 'Draw or no contest' };
      if (!winner) return { status: 'review', win: NaN, push: 0, lose: NaN, text: 'Fight is over but no winner is posted yet' };
      const won = winner === leg.side;
      return { status: won ? 'won' : 'lost', win: won ? 1 : 0, push: 0, lose: won ? 0 : 1, text: won ? 'Won the fight' : 'Lost the fight' };
    }
    const status = game.state === 'in' ? 'live' : 'pending';
    return { status, win: p, push: 0, lose: 1 - p, text: game.state === 'in' ? `Round ${game.period || 1} live` : 'Fight not started' };
  }

  if (leg.market === 'prop' && (!STATS[leg.stat] || !STATS[leg.stat].sports.includes(leg.sport))) {
    return { status: 'review', win: NaN, push: 0, lose: NaN, text: 'This prop type does not fit the sport. Settle it by hand' };
  }
  const player = leg.market === 'prop' ? findPlayer(players, leg) : null;
  const cs = clockState(game, sp, seg);
  const finished = (game.state === 'post' && game.completed) || (seg !== 'game' && cs.segDone && game.state !== 'pre');

  const who = leg.playerName || 'Player';
  if (leg.market === 'prop' && finished && opts && opts.statsFinal === false) {
    const value = player ? settledValue(leg, game, sp, player) : null;
    const st = value == null ? null : outcomeFromValue(value, leg);
    return { status: 'live', win: st ? (st === 'won' ? 1 : 0) : NaN, push: st === 'push' ? 1 : 0, lose: st ? (st === 'lost' ? 1 : 0) : NaN, now: value, text: 'Game over, waiting for final stats' };
  }
  if (leg.market === 'prop' && player && finished && playedNothing(player, sp)) {
    // Books void player props when the player never gets in.
    return { status: 'void', win: 0, push: 1, lose: 0, text: `${who} did not play` };
  }
  if (leg.market === 'prop' && player && player.didNotPlay && game.state === 'in') {
    return { status: 'live', win: 0, push: 1, lose: 0, text: `${who} is listed out. Voids if he never plays` };
  }

  if (finished) {
    if (leg.market === 'prop' && !player) {
      const any = players && Object.keys(players).length > 0;
      if (any) return { status: 'review', win: NaN, push: 0, lose: NaN, text: `${who} is not in the box score. Settle it by hand` };
      return { status: 'live', win: NaN, push: 0, lose: NaN, text: 'Waiting for final stats' };
    }
    const value = settledValue(leg, game, sp, player);
    const status = outcomeFromValue(value, leg);
    return { status, win: status === 'won' ? 1 : 0, push: status === 'push' ? 1 : 0, lose: status === 'lost' ? 1 : 0, now: value, text: describe(leg, game, sp, value, true) };
  }

  const model = sp.kind === 'football' ? footballModel(game, sp, seg, leg) : basketballModel(game, sp, seg, leg);
  const dist = legDist(leg, game, sp, model, player);
  const pr = probsFromDist(dist, leg);
  const now = game.state === 'pre' ? null : settledValue(leg, game, sp, player);

  // Some legs are decided before the final whistle.
  if (game.state === 'in' && now != null) {
    const over = leg.side === 'over';
    const line = Number(leg.line);
    const isCount = leg.market === 'total' || leg.market === 'team_total' || (leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind !== 'yards');
    if (isCount && now > line + 1e-9) {
      if (over) return { status: 'won', win: 1, push: 0, lose: 0, now, text: describe(leg, game, sp, now, true) };
      return { status: 'lost', win: 0, push: 0, lose: 1, now, text: describe(leg, game, sp, now, true) };
    }
    if (leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td' && now >= 1) {
      const yes = leg.side !== 'no';
      return { status: yes ? 'won' : 'lost', win: yes ? 1 : 0, push: 0, lose: yes ? 0 : 1, now, text: describe(leg, game, sp, now, true) };
    }
  }

  const total = pr.win + pr.push + pr.lose || 1;
  return {
    status: game.state === 'in' ? 'live' : 'pending',
    win: pr.win / total,
    push: pr.push / total,
    lose: pr.lose / total,
    now,
    text: describe(leg, game, sp, now, false, model),
  };
}

function playedNothing(player, sp) {
  if (player.didNotPlay) return true;
  const s = player.stats || {};
  if (sp.kind === 'basketball') return !(Number(s.min) > 0) && !Object.keys(s).some((k) => k !== 'min' && Number(s[k]) > 0);
  return false;
}

function findPlayer(players, leg) {
  if (!players) return null;
  if (leg.playerId && players[leg.playerId]) return players[leg.playerId];
  if (!leg.playerName) return null;
  const want = normName(leg.playerName);
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (normName(p.name) === want) return p;
  }
  // "O. Anunoby" or "OG Anunoby": same last name and first initial, and only one such player.
  const parts = want.split(' ');
  const last = parts[parts.length - 1];
  const first = parts.length > 1 ? parts[0][0] : '';
  const hits = Object.values(players).filter((p) => {
    const n = normName(p.name).split(' ');
    return n[n.length - 1] === last && (!first || (n.length > 1 && n[0][0] === first));
  });
  return hits.length === 1 && first ? hits[0] : null;
}

export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtLine(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return '';
  if (v === 0) return 'PK';
  const s = Math.abs(v) % 1 === 0 ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return v > 0 ? `+${s}` : `-${s}`;
}

function fmtNum(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return '';
  return Math.abs(v) % 1 === 0 ? String(v) : v.toFixed(1);
}

function teamName(game, side) {
  const t = side === 'away' ? game.away : game.home;
  return (t && (t.abbr || t.shortName || t.name)) || (side === 'away' ? 'Away' : 'Home');
}

// One plain sentence about where a leg stands.
function describe(leg, game, sp, now, settled, model) {
  const line = Number(leg.line);
  if (now == null) {
    if (leg.market === 'prop') return `${leg.playerName || 'Player'} has not started`;
    return 'Not started';
  }
  if (leg.market === 'moneyline') {
    if (now > 0) return settled ? `Won by ${now}` : `Up ${now}`;
    if (now < 0) return settled ? `Lost by ${-now}` : `Down ${-now}`;
    return settled ? 'Tied' : 'Tied right now';
  }
  if (leg.market === 'spread') {
    const c = now + line;
    const lead = now > 0 ? `Up ${now}` : now < 0 ? `Down ${-now}` : 'Tied';
    if (settled) return c > 0 ? `Covered by ${fmtNum(c)}` : c < 0 ? `Missed by ${fmtNum(-c)}` : 'Landed on the number';
    if (c > 0) return `${lead}, covering by ${fmtNum(c)}`;
    if (c < 0) return `${lead}, short by ${fmtNum(-c)}`;
    return `${lead}, on the number`;
  }
  if (leg.market === 'total' || leg.market === 'team_total' || leg.market === 'prop') {
    const isTD = leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td';
    const who = leg.market === 'prop' ? `${leg.playerName || 'Player'}: ` : leg.market === 'team_total' ? `${teamName(game, leg.team)}: ` : '';
    const unit = leg.market === 'prop' ? (STATS[leg.stat] ? STATS[leg.stat].label.toLowerCase() : '') : 'points';
    if (isTD) return now >= 1 ? `${who}scored` : `${who}no touchdown yet`;
    if (settled) return `${who}${fmtNum(now)} ${unit}, line ${fmtNum(line)}`;
    if (leg.side === 'over') {
      const need = Math.floor(line - now) + 1;
      if (need <= 0) return `${who}${fmtNum(now)} ${unit}, already over`;
      return `${who}${fmtNum(now)} ${unit}, needs ${need} more`;
    }
    const room = Math.ceil(line - now) - 1;
    if (room < 0) return `${who}${fmtNum(now)} ${unit}, already over`;
    return `${who}${fmtNum(now)} ${unit}, can give up ${room} more`;
  }
  return '';
}

// ---------------------------------------------------------------- bets

// Combined result for a bet (straight or parlay) given each leg's evaluation.
export function evaluateBet(bet, evals) {
  const legs = bet.legs || [];
  if (!legs.length) return { status: 'pending', win: NaN, push: 0, lose: NaN };
  if (legs.length === 1) {
    const e = evals[0];
    return { status: e.status, win: e.win, push: e.push, lose: e.lose };
  }
  let anyLive = false;
  let anyPending = false;
  let pWin = 1;
  let allPush = 1;
  let lost = false;
  let unknown = false;
  for (const e of evals) {
    if (e.status === 'lost') lost = true;
    if (e.status === 'live') anyLive = true;
    if (e.status === 'pending') anyPending = true;
    if (!Number.isFinite(e.win)) unknown = true;
    const winOrPush = (e.win || 0) + (e.push || 0);
    pWin *= winOrPush;
    allPush *= e.push || 0;
  }
  if (lost) return { status: 'lost', win: 0, push: 0, lose: 1 };
  if (evals.some((e) => e.status === 'review')) return { status: 'review', win: NaN, push: 0, lose: NaN };
  const settled = evals.every((e) => ['won', 'push', 'void'].includes(e.status));
  if (settled) {
    const allVoid = evals.every((e) => e.status === 'push' || e.status === 'void');
    return allVoid ? { status: 'push', win: 0, push: 1, lose: 0 } : { status: 'won', win: 1, push: 0, lose: 0 };
  }
  if (unknown) return { status: anyLive ? 'live' : 'pending', win: NaN, push: 0, lose: NaN };
  const win = Math.max(0, pWin - allPush);
  return { status: anyLive || evals.some((e) => e.status === 'won') ? 'live' : anyPending ? 'pending' : 'live', win, push: allPush, lose: 1 - win - allPush };
}

// Decimal odds of a parlay after removing pushed or voided legs. Legs entered without their
// own price share the book's combined price evenly.
export function parlayDecimal(legs, evals, combinedAmerican) {
  const combined = americanToDecimal(combinedAmerican);
  const priced = legs.filter((l) => Number.isFinite(americanToDecimal(l.odds)));
  let fallback = americanToDecimal(-110);
  if (Number.isFinite(combined) && legs.length) {
    const known = priced.reduce((d, l) => d * americanToDecimal(l.odds), 1);
    const missing = legs.length - priced.length;
    fallback = missing > 0 ? Math.pow(combined / known, 1 / missing) : fallback;
  }
  let d = 1;
  legs.forEach((leg, i) => {
    const st = evals && evals[i] ? evals[i].status : null;
    if (st === 'push' || st === 'void') return;
    const ld = americanToDecimal(leg.odds);
    d *= Number.isFinite(ld) ? ld : fallback;
  });
  return d;
}

// Profit or loss in dollars once settled. Straight bets use bet.odds; parlays use leg odds
// unless the book's combined price was entered (bet.odds) and no leg pushed.
export function settleBet(bet, status, evals) {
  const stake = Number(bet.stake) || 0;
  if (status === 'lost') return -stake;
  if (status === 'push' || status === 'void') return 0;
  if (status !== 'won') return 0;
  if ((bet.legs || []).length > 1) {
    const anyPush = (evals || []).some((e) => e.status === 'push' || e.status === 'void');
    const dec = !anyPush && Number.isFinite(americanToDecimal(bet.odds)) ? americanToDecimal(bet.odds) : parlayDecimal(bet.legs, evals, bet.odds);
    return round2(stake * (dec - 1));
  }
  return profitOnWin(stake, bet.odds);
}

function betDecimal(bet) {
  if ((bet.legs || []).length > 1) {
    const d = americanToDecimal(bet.odds);
    return Number.isFinite(d) ? d : parlayDecimal(bet.legs, null, bet.odds);
  }
  return americanToDecimal(bet.odds);
}

// Expected profit right now from the live probabilities.
export function expectedProfit(bet, res) {
  const stake = Number(bet.stake) || 0;
  if (!Number.isFinite(res.win)) return NaN;
  return round2(res.win * stake * (betDecimal(bet) - 1) - res.lose * stake);
}

export function potentialPayout(bet) {
  return round2((Number(bet.stake) || 0) * (betDecimal(bet) - 1));
}

// Window where both sides win, for a middle (e.g. over 44.5 and under 51.5).
export function middleWindow(leg, otherLine) {
  const a = Number(leg.line);
  const b = Number(otherLine);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (leg.market === 'total' || leg.market === 'team_total' || leg.market === 'prop') {
    const lo = leg.side === 'over' ? a : b;
    const hi = leg.side === 'over' ? b : a;
    if (hi <= lo) return null;
    return { lo: Math.floor(lo) + 1, hi: Math.ceil(hi) - 1 };
  }
  if (leg.market === 'spread') {
    // leg: team side at line a (e.g. -3.5). Other side now at b (e.g. +6.5 for the opponent).
    // Team margin X wins the first if X > -a, wins the hedge if X < b.
    const lo = -a;
    const hi = b;
    if (hi <= lo) return null;
    return { lo: Math.floor(lo) + 1, hi: Math.ceil(hi) - 1 };
  }
  return null;
}

// Chance the final value lands in [lo, hi] for a leg's quantity, from the live model.
export function chanceInWindow(leg, game, players, lo, hi) {
  const sp = SPORTS[leg.sport];
  if (!sp || sp.kind === 'fight' || !game) return NaN;
  const seg = leg.segment || 'game';
  const model = sp.kind === 'football' ? footballModel(game, sp, seg, leg) : basketballModel(game, sp, seg, leg);
  const dist = legDist(leg, game, sp, model, leg.market === 'prop' ? findPlayer(players, leg) : null);
  let s = 0;
  for (let i = 0; i < dist.p.length; i++) {
    const k = dist.lo + i;
    if (k >= lo && k <= hi) s += dist.p[i];
  }
  return s;
}

// ---------------------------------------------------------------- labels

export function legLabel(leg, game) {
  const seg = leg.segment && leg.segment !== 'game' ? `${SEGMENTS[leg.segment]} ` : '';
  const fight = SPORTS[leg.sport] && SPORTS[leg.sport].kind === 'fight';
  const team = (side) => {
    const t = game ? (side === 'away' ? game.away : game.home) : leg.matchup && (side === 'away' ? leg.matchup.away : leg.matchup.home);
    if (!t) return side === 'away' ? 'Away' : 'Home';
    return (fight ? t.name || t.abbr : t.abbr || t.shortName || t.name) || (side === 'away' ? 'Away' : 'Home');
  };
  if (leg.market === 'spread') return `${seg}${team(leg.side)} ${fmtLine(leg.line)}`;
  if (leg.market === 'moneyline') return `${seg}${team(leg.side)} to win`;
  if (leg.market === 'total') return `${seg}${leg.side === 'over' ? 'Over' : 'Under'} ${fmtNum(leg.line)}`;
  if (leg.market === 'team_total') return `${seg}${team(leg.team)} ${leg.side === 'over' ? 'over' : 'under'} ${fmtNum(leg.line)}`;
  if (leg.market === 'prop') {
    const st = STATS[leg.stat];
    if (st && st.kind === 'td') return `${leg.playerName} ${leg.side === 'no' ? 'no touchdown' : 'anytime touchdown'}`;
    return `${leg.playerName} ${leg.side === 'over' ? 'over' : 'under'} ${fmtNum(leg.line)} ${st ? st.label.toLowerCase() : leg.stat}`;
  }
  return 'Bet';
}

export { fmtLine, fmtNum };
