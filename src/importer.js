// Bets handed over from The Number: a code "NUM1." + base64url JSON, from a link (#import=...)
// or pasted. Returns the bets in the slip shape the slip preview already resolves and saves.
// The code comes from outside, so every field is checked and anything odd is dropped.
import { SPORTS, americanToDecimal } from './engine.js';

const MARKETS = new Set(['spread', 'moneyline', 'total']);
const str = (v, n = 60) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function cleanLeg(l) {
  if (!l || !SPORTS[l.sport] || !MARKETS.has(l.market)) return null;
  const team = str(l.team);
  if (!team) return null;
  const leg = { sport: l.sport, market: l.market, segment: 'game', team, opponent: str(l.opponent) };
  const odds = fin(l.odds);
  if (odds != null && Number.isFinite(americanToDecimal(odds))) leg.odds = odds;
  if (/^\d{4}-\d{2}-\d{2}$/.test(l.date || '')) leg.date = l.date;
  if (l.market !== 'moneyline') {
    const line = fin(l.line);
    if (line == null || Math.abs(line) > 400) return null;
    leg.line = line;
  }
  if (l.market === 'total') leg.side = l.side === 'under' ? 'under' : 'over';
  return leg;
}

export function decodeImport(text) {
  const m = /NUM1\.([A-Za-z0-9_-]{8,12000})/.exec(String(text || ''));
  if (!m) throw new Error('That is not a bet code from The Number.');
  let data;
  try {
    data = JSON.parse(fromB64url(m[1]));
  } catch {
    throw new Error('That bet code is cut off or damaged. Copy it again.');
  }
  if (!data || data.from !== 'the-number' || !Array.isArray(data.bets)) throw new Error('That is not a bet code from The Number.');
  const bets = [];
  for (const b of data.bets.slice(0, 10)) {
    const legs = Array.isArray(b && b.legs) ? b.legs.slice(0, 1).map(cleanLeg) : [];
    const stake = fin(b && b.stake);
    const odds = fin(b && b.odds);
    if (!legs.length || legs.some((l) => !l) || !(stake > 0) || !Number.isFinite(americanToDecimal(odds))) continue;
    bets.push({ book: str(b.book, 40), stake, odds, bonus: b.bonus === true, result: 'open', legs });
  }
  if (!bets.length) throw new Error('That code has no bet Sweat can follow.');
  return bets;
}
