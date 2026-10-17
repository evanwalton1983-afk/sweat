// A scripted night of games as raw ESPN responses, step by step, so the real Netlify function
// and the app can be tested from pregame to final without the network.
//
// Step 0 pregame, 1 early, 2 late first half, 3 halftime, 4 two minutes left, 5 last minute,
// 6 final. The story: Bills -3.5 looks dead at step 4 and cashes; the over 44.5 sits at 44 with
// Miami at the goal line in the last minute and dies on downs; Anunoby clears 15.5 points; the
// Chiefs game is later tonight; Alpha wins the fight by knockout.
import fs from 'node:fs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'));
const base = { nfl: fx('nfl-scoreboard-live.json'), ufc: fx('ufc-scoreboard.json'), nba: fx('nba-summary-final.json') };

export const START = new Date(Date.now() + 15 * 60000).toISOString();
export const LATER = new Date(Date.now() + 4 * 3600000).toISOString();

const clone = (x) => JSON.parse(JSON.stringify(x));

function status(name, state, period, clock, short) {
  const m = Math.floor(clock / 60);
  const s = Math.round(clock % 60);
  return { clock, displayClock: `${m}:${String(s).padStart(2, '0')}`, period, type: { id: '1', name, state, completed: name === 'STATUS_FINAL', description: short, detail: short, shortDetail: short } };
}

// [status, home BUF score, away MIA score, home linescores, away linescores, situation]
const BILLS = [
  [status('STATUS_SCHEDULED', 'pre', 0, 900, 'Tonight'), 0, 0, [], [], null],
  [status('STATUS_IN_PROGRESS', 'in', 1, 600, '10:00 - 1st'), 0, 0, [0], [0], { possession: '2', possessionText: 'BUF 25', downDistanceText: '1st & 10 at BUF 25', down: 1, distance: 10, yardLine: 25 }],
  [status('STATUS_IN_PROGRESS', 'in', 2, 120, '2:00 - 2nd'), 10, 7, [7, 3], [7, 0], { possession: '15', possessionText: 'MIA 30', downDistanceText: '2nd & 6 at MIA 30', down: 2, distance: 6, yardLine: 70 }],
  [status('STATUS_HALFTIME', 'in', 2, 0, 'Halftime'), 10, 10, [7, 3], [7, 3], null],
  [status('STATUS_IN_PROGRESS', 'in', 4, 120, '2:00 - 4th'), 20, 17, [7, 3, 7, 3], [7, 3, 7, 0], { possession: '15', possessionText: 'BUF 12', downDistanceText: '1st & 10 at BUF 12', down: 1, distance: 10, yardLine: 12, isRedZone: true }],
  [status('STATUS_IN_PROGRESS', 'in', 4, 40, '0:40 - 4th'), 27, 17, [7, 3, 7, 10], [7, 3, 7, 0], { possession: '15', possessionText: 'BUF 4', downDistanceText: '1st & Goal at BUF 4', down: 1, distance: 4, yardLine: 4, isRedZone: true }],
  [status('STATUS_FINAL', 'post', 4, 0, 'Final'), 27, 17, [7, 3, 7, 10], [7, 3, 7, 0], null],
  // A scoring change after the final: a safety credited to Miami late.
  [status('STATUS_FINAL', 'post', 4, 0, 'Final'), 27, 19, [7, 3, 7, 10], [7, 3, 7, 2], null],
];

function nflBoard(step) {
  const raw = clone(base.nfl);
  const [st, h, a, hl, al, sit] = BILLS[step];
  const bills = raw.events[0];
  bills.date = START;
  const c = bills.competitions[0];
  c.date = START;
  c.status = st;
  c.competitors[0].score = String(h);
  c.competitors[1].score = String(a);
  c.competitors[0].linescores = hl.map((v, i) => ({ value: v, displayValue: String(v), period: i + 1 }));
  c.competitors[1].linescores = al.map((v, i) => ({ value: v, displayValue: String(v), period: i + 1 }));
  if (sit) c.situation = { ...sit, lastPlay: { text: 'Play', probability: { homeWinPercentage: 0.5 } } };
  else delete c.situation;
  // The Chiefs play later tonight.
  const kc = raw.events[1];
  kc.date = LATER;
  kc.competitions[0].date = LATER;
  // Keep only these two games on the board.
  raw.events = [bills, kc];
  return raw;
}

const NBA = [
  ['STATUS_SCHEDULED', 'pre', 0, 720, 0, 0, 0, 0],
  ['STATUS_IN_PROGRESS', 'in', 1, 300, 14, 10, 4, 6],
  ['STATUS_IN_PROGRESS', 'in', 2, 200, 60, 44, 9, 14],
  ['STATUS_HALFTIME', 'in', 2, 0, 68, 49, 9, 15],
  ['STATUS_IN_PROGRESS', 'in', 4, 240, 118, 85, 15, 25],
  ['STATUS_IN_PROGRESS', 'in', 4, 30, 128, 91, 17, 27],
  ['STATUS_FINAL', 'post', 4, 0, 130, 93, 17, 27],
];

function scaleStat(v, k) {
  if (typeof v !== 'string') return v;
  if (/^\d+-\d+$/.test(v)) return v.split('-').map((x) => Math.round(Number(x) * k)).join('-');
  if (/^[+-]?\d+$/.test(v)) return String(Math.round(Number(v) * k));
  return v;
}

function nbaSummary(step) {
  const raw = clone(base.nba);
  const [name, state, period, clock, ny, cle, ogPts, ogMin] = NBA[Math.min(step, NBA.length - 1)];
  const c = raw.header.competitions[0];
  c.date = START;
  c.status = status(name, state, period, clock, name === 'STATUS_FINAL' ? 'Final' : name === 'STATUS_HALFTIME' ? 'Halftime' : `Q${period}`);
  const home = c.competitors.find((x) => x.homeAway === 'home');
  const away = c.competitors.find((x) => x.homeAway === 'away');
  if (step < 6) {
    home.score = String(cle);
    away.score = String(ny);
    home.linescores = home.linescores.slice(0, period).map((l, i) => ({ displayValue: String(i === period - 1 ? Math.max(0, cle - home.linescores.slice(0, i).reduce((s, x) => s + Number(x.displayValue), 0)) : l.displayValue) }));
    away.linescores = away.linescores.slice(0, period).map((l, i) => ({ displayValue: String(i === period - 1 ? Math.max(0, ny - away.linescores.slice(0, i).reduce((s, x) => s + Number(x.displayValue), 0)) : l.displayValue) }));
    const k = step === 0 ? 0 : ny / 130;
    for (const grp of raw.boxscore.players) {
      for (const sg of grp.statistics) {
        for (const row of sg.athletes) {
          if (step === 0) {
            row.stats = [];
            continue;
          }
          if (row.athlete.displayName === 'OG Anunoby') {
            const keys = sg.keys;
            row.stats = keys.map((key) => (key === 'points' ? String(ogPts) : key === 'minutes' ? String(ogMin) : scaleStat(row.stats[keys.indexOf(key)], k)));
          } else row.stats = row.stats.map((v) => scaleStat(v, k));
        }
      }
    }
    if (step === 0) delete raw.boxscore;
  }
  return raw;
}

function nbaBoard(step) {
  const s = nbaSummary(step);
  const c = s.header.competitions[0];
  return { events: [{ id: s.header.id, date: START, name: 'New York Knicks at Cleveland Cavaliers', shortName: 'NY @ CLE', season: { type: 2 }, competitions: [{ ...c, odds: [{ provider: { name: 'DraftKings' }, details: 'NY -2.5', overUnder: 218.5, spread: 2.5, overOdds: -112, underOdds: -108, homeTeamOdds: { favorite: false, moneyLine: 114, spreadOdds: -105 }, awayTeamOdds: { favorite: true, moneyLine: -135, spreadOdds: -115 } }] }] }] };
}

function ufcBoard(step) {
  const raw = clone(base.ufc);
  const ev = raw.events[0];
  ev.date = START;
  const fight = ev.competitions[0];
  fight.date = START;
  step = Math.min(step, 6);
  if (step === 0) fight.status = status('STATUS_SCHEDULED', 'pre', 0, 300, 'Tonight');
  else if (step < 6) fight.status = status('STATUS_IN_PROGRESS', 'in', step < 3 ? 1 : 2, 300 - step * 30, `R${step < 3 ? 1 : 2}`);
  else {
    fight.status = { ...status('STATUS_FINAL', 'post', 2, 101, 'Final'), result: { name: 'kotko', displayName: 'KO/TKO' } };
    fight.competitors[0].winner = true;
  }
  ev.competitions = [fight];
  return raw;
}

// Raw ESPN JSON for a URL at a step, or null for anything this night does not cover.
export function espnFor(url, step) {
  const u = new URL(url);
  const p = u.pathname;
  if (p.endsWith('/football/nfl/scoreboard')) return nflBoard(step);
  if (p.endsWith('/basketball/nba/scoreboard')) return nbaBoard(step);
  if (p.endsWith('/basketball/nba/summary')) return nbaSummary(step);
  if (p.endsWith('/mma/ufc/scoreboard')) return ufcBoard(step);
  if (p.includes('/scoreboard')) return { events: [] };
  if (p.includes('/teams/') && p.endsWith('/roster')) {
    if (p.includes('/basketball/nba/')) return { athletes: [{ id: '3934719', displayName: 'OG Anunoby', position: { abbreviation: 'F' } }, { id: '3934672', displayName: 'Jalen Brunson', position: { abbreviation: 'G' } }] };
    return { athletes: [{ position: 'offense', items: [{ id: '1', displayName: 'Josh Allen', position: { abbreviation: 'QB' } }] }] };
  }
  return null;
}
