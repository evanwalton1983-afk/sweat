// Small rendering helpers: escaping, money and time formats, icons, and the SVG lines.
import { SPORTS, legLabel, formatAmerican } from './engine.js';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function money(x, opts = {}) {
  const v = Number(x);
  if (!Number.isFinite(v)) return '';
  const f = opts.whole && Math.abs(v) >= 100 ? usd0 : usd;
  const s = f.format(Math.abs(v));
  if (opts.sign) return v > 0.004 ? `+${s}` : v < -0.004 ? `-${s}` : s;
  return v < 0 ? `-${s}` : s;
}

// Live chances never show 0 or 100: it is not over until the feed says so.
export function pct(p) {
  if (!Number.isFinite(p)) return '';
  const v = p * 100;
  if (v < 0.5) return '<1';
  if (v >= 99.5) return '>99';
  return String(Math.round(v));
}

export function bucket(p) {
  if (!Number.isFinite(p)) return 'none';
  return p >= 0.6 ? 'cover' : p >= 0.4 ? 'flip' : 'trouble';
}

export function odds(a) {
  return Number.isFinite(Number(a)) && a !== null && a !== '' ? formatAmerican(a) : '';
}

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const wkFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

export function dayLabel(d) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return dayFmt.format(t);
}

export function kickoff(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const d = dayLabel(t);
  const near = ['Today', 'Tomorrow', 'Yesterday'].includes(d);
  return `${near ? d : wkFmt.format(t)} ${timeFmt.format(t)}`;
}

export function clockTime(t = new Date()) {
  return timeFmt.format(t);
}

export function ago(ms) {
  if (!ms) return 'Not updated yet';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'Updated just now';
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m} min ago`;
  return `Updated ${Math.round(m / 60)} h ago`;
}

// "Q3 4:12", "Half", "Final", "R2 3:11"
export function gameClock(g) {
  if (!g) return { main: '', sub: '' };
  const sp = SPORTS[g.sport];
  if (g.state === 'pre') return { main: kickoff(g.start), sub: g.odds && g.odds.details ? g.odds.details : '' };
  if (g.state === 'post') {
    const ot = sp && sp.kind !== 'fight' && g.period > (g.regulationPeriods || sp.periods);
    if (/POSTPONED|CANCELED|SUSPENDED|FORFEIT/.test(g.statusName || '')) return { main: g.detail || 'Not played', sub: '' };
    return { main: ot ? 'Final, OT' : 'Final', sub: sp && sp.kind === 'fight' && g.fight ? g.fight.method : '' };
  }
  if (/HALFTIME/.test(g.statusName || '')) return { main: 'Halftime', sub: '' };
  if (sp && sp.kind === 'fight') return { main: `Round ${g.period || 1}`, sub: g.displayClock || '' };
  const reg = g.regulationPeriods || (sp ? sp.periods : 4);
  let per;
  if (g.period > reg) per = g.period - reg > 1 ? `OT${g.period - reg}` : 'OT';
  else if (reg === 2) per = g.period === 1 ? '1st half' : '2nd half';
  else per = ['1st', '2nd', '3rd', '4th'][g.period - 1] || `Q${g.period}`;
  if (/END_PERIOD/.test(g.statusName || '')) return { main: `End of ${per}`, sub: '' };
  return { main: `${per} ${g.displayClock || ''}`.trim(), sub: g.situation && g.situation.text ? g.situation.text : '' };
}

export function teamLine(g, side) {
  const t = side === 'home' ? g.home : g.away;
  return t || {};
}

// Bet label for lists: one leg, or "3-leg parlay".
export function betTitle(bet, games) {
  const legs = bet.legs || [];
  if (legs.length === 1) return legLabel(legs[0], games ? games(legs[0]) : null);
  return `${legs.length}-leg parlay`;
}

// ------------------------------------------------------------ icons

const ICONS = {
  live: '<path d="M3 12h4l3-8 4 16 3-8h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  add: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  history: '<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  prev: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

// ------------------------------------------------------------ lines

// Small sweat line under a ticket: cash chance over time.
export function sparkline(track, w = 300, h = 44) {
  const pts = (track || []).filter((p) => Number.isFinite(p[1]));
  if (pts.length < 2) return `<svg class="sweatline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line class="mid" x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/></svg>`;
  const t0 = pts[0][0];
  const t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const x = (t) => ((t - t0) / (t1 - t0)) * (w - 2) + 1;
  const y = (p) => (1 - p) * (h - 4) + 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  return `<svg class="sweatline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line class="mid" x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" vector-effect="non-scaling-stroke"/><path class="ln" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Bigger version for the detail sheet, with the high and low marked.
export function bigline(track, w = 360, h = 170) {
  const pts = (track || []).filter((p) => Number.isFinite(p[1]));
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const axis = [0, 0.5, 1].map((p) => `<text class="lbl" x="${pad.l - 6}" y="${pad.t + (1 - p) * ih + 4}" text-anchor="end">${Math.round(p * 100)}%</text>`).join('');
  const mid = `<line class="mid" x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih / 2}" y2="${pad.t + ih / 2}"/>`;
  if (pts.length < 2) return `<svg class="bigline" viewBox="0 0 ${w} ${h}" role="img" aria-label="No live history yet">${axis}${mid}<text class="lbl" x="${pad.l + iw / 2}" y="${pad.t + ih / 2 - 8}" text-anchor="middle">The line starts when the game does</text></svg>`;
  const t0 = pts[0][0];
  const t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (p) => pad.t + (1 - p) * ih;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p[1] > hi[1]) hi = p;
    if (p[1] < lo[1]) lo = p;
  }
  const tl = (t) => clockTime(new Date(t));
  const times = `<text class="lbl" x="${pad.l}" y="${h - 6}">${tl(t0)}</text><text class="lbl" x="${w - pad.r}" y="${h - 6}" text-anchor="end">${tl(t1)}</text>`;
  const marks = `<circle class="pk" cx="${x(hi[0]).toFixed(1)}" cy="${y(hi[1]).toFixed(1)}" r="4"/><circle class="tr" cx="${x(lo[0]).toFixed(1)}" cy="${y(lo[1]).toFixed(1)}" r="4"/>`;
  const label = `Cash chance over time, high ${Math.round(hi[1] * 100)}%, low ${Math.round(lo[1] * 100)}%`;
  return `<svg class="bigline" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${axis}${mid}<path class="ln" d="${d}"/>${marks}${times}</svg>`;
}

// Cumulative profit for the history page.
export function profitChart(points, w = 360, h = 150) {
  if (points.length < 2) return '';
  const pad = { l: 44, r: 8, t: 10, b: 20 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const vals = points.map((p) => p[1]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v) => pad.t + (1 - (v - lo) / span) * ih;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const fmt = (v) => money(v, { whole: true });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Profit over time, now ${esc(money(vals[vals.length - 1], { sign: true }))}">`
    + `<line class="zero" x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`
    + `<text class="lbl" x="${pad.l - 6}" y="${y(hi) + 4}" text-anchor="end">${esc(fmt(hi))}</text>`
    + `<text class="lbl" x="${pad.l - 6}" y="${y(lo) + 4}" text-anchor="end">${esc(fmt(lo))}</text>`
    + `<path class="ln" d="${d}"/></svg>`;
}
