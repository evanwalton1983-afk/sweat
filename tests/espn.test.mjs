import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as X from '../src/espn.js';
import * as E from '../src/engine.js';

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('urls and dates', () => {
  assert.equal(X.scoreboardUrl('nfl', '20261011'), 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261011');
  assert.equal(X.scoreboardUrl('ncaab', '20270110', '50'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20270110&groups=50&limit=500');
  assert.equal(X.summaryUrl('ufc', '600055555'), 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/summary?event=600055555');
  // 1:30 AM UTC on Oct 12 is still Oct 11 in New York.
  assert.equal(X.espnDate(new Date('2026-10-12T01:30:00Z')), '20261011');
  assert.equal(X.shiftDate('20261231', 1), '20270101');
  assert.equal(X.shiftDate('20260301', -1), '20260228');
});

test('real NBA final summary: score, book line, box score', () => {
  const { game, players } = X.normalizeSummary(fx('nba-summary-final.json'), 'nba');
  assert.equal(game.state, 'post');
  assert.equal(game.completed, true);
  assert.equal(game.home.abbr, 'CLE');
  assert.equal(game.away.abbr, 'NY');
  assert.equal(game.home.score, 93);
  assert.equal(game.away.score, 130);
  assert.deepEqual(game.home.linescores, [26, 23, 22, 22]);
  // "NY -2.5" with the Knicks on the road: home line +2.5.
  assert.equal(game.odds.spreadHome, 2.5);
  assert.equal(game.odds.total, 218.5);
  assert.equal(game.odds.homeML, 114);
  assert.equal(game.odds.awayML, -135);
  assert.equal(game.regulationPeriods, 4);
  assert.equal(game.periodSec, 720);
  const og = Object.values(players).find((p) => p.name === 'OG Anunoby');
  assert.ok(og);
  assert.equal(og.side, 'away');
  assert.equal(og.starter, true);
  assert.deepEqual([og.stats.pts, og.stats.reb, og.stats.ast, og.stats.threes, og.stats.min, og.stats.pf], [17, 7, 4, 1, 27, 4]);
  // Grade real bets against it.
  const grade = (l) => E.evaluateLeg({ sport: 'nba', segment: 'game', odds: -110, ...l }, game, players).status;
  assert.equal(grade({ market: 'spread', side: 'away', line: -2.5 }), 'won');
  assert.equal(grade({ market: 'total', side: 'over', line: 218.5 }), 'won');
  assert.equal(grade({ market: 'moneyline', side: 'home' }), 'lost');
  assert.equal(grade({ market: 'prop', stat: 'pts', side: 'over', line: 15.5, playerName: 'OG Anunoby' }), 'won');
  assert.equal(grade({ market: 'prop', stat: 'pra', side: 'under', line: 30.5, playerName: 'O. Anunoby' }), 'won');
  assert.equal(grade({ market: 'spread', side: 'away', line: -6.5, segment: '1q' }), 'won');
});

test('real college football final: home favorite line and passing stats', () => {
  const { game, players } = X.normalizeSummary(fx('cfb-summary-final.json'), 'cfb');
  assert.equal(game.home.score, 65);
  assert.equal(game.away.score, 3);
  assert.equal(game.odds.spreadHome, -31.5);
  assert.equal(game.odds.total, 55);
  const qb = Object.values(players).find((p) => p.name === 'Diego Pavia');
  assert.deepEqual([qb.stats.passYds, qb.stats.passTD, qb.stats.passCmp, qb.stats.passAtt, qb.stats.ints], [323, 4, 9, 13, 0]);
  const wr = Object.values(players).find((p) => p.name === 'Jonathan Brady');
  assert.equal(wr.stats.recTD, 2);
  const td = E.evaluateLeg({ sport: 'cfb', market: 'prop', stat: 'anyTD', side: 'yes', playerName: 'Jonathan Brady', odds: 140, segment: 'game' }, game, players);
  assert.equal(td.status, 'won');
  const cover = E.evaluateLeg({ sport: 'cfb', market: 'spread', side: 'home', line: -31.5, odds: -110, segment: 'game' }, game, players);
  assert.equal(cover.status, 'won');
});

test('live NFL scoreboard: status, odds, field position', () => {
  const games = X.normalizeScoreboard(fx('nfl-scoreboard-live.json'), 'nfl');
  assert.equal(games.length, 4);
  const [live, pre, fin, half] = games;
  assert.equal(live.state, 'in');
  assert.equal(live.period, 4);
  assert.equal(live.clock, 125);
  assert.equal(live.odds.spreadHome, -3.5);
  assert.equal(live.home.color, '#00338d');
  assert.deepEqual(live.situation, { side: 'away', yOwn: 25, down: 1, distance: 10, text: '1st & 10 at MIA 25', redZone: false });
  assert.equal(live.winProb.home, 0.83);
  // Road favorite from the flags.
  assert.equal(pre.odds.spreadHome, 7);
  assert.equal(pre.state, 'pre');
  assert.equal(fin.odds.spreadHome, -3);
  assert.equal(half.statusName, 'STATUS_HALFTIME');
  assert.equal(half.odds.spreadHome, 0);
  assert.equal(half.situation.yOwn, 35);
  // The engine can price the live game from this.
  const r = E.evaluateLeg({ sport: 'nfl', market: 'spread', side: 'home', line: -3.5, odds: -110, segment: 'game' }, live);
  assert.equal(r.status, 'live');
  assert.ok(r.lose > 0.6, `up 3 on a -3.5 with the other team driving: ${r.lose}`);
  const h1 = E.evaluateLeg({ sport: 'nfl', market: 'moneyline', side: 'away', odds: 110, segment: '1h' }, half);
  assert.equal(h1.status, 'won');
});

test('field position parsing handles college names and midfield', () => {
  const home = { id: '1', abbr: 'NMSU', name: 'New Mexico State Aggies', short: 'Aggies', location: 'New Mexico State' };
  const away = { id: '2', abbr: 'VAL', name: 'Valparaiso Beacons', short: 'Beacons', location: 'Valparaiso' };
  const raw = (s) => ({ events: [{ id: '9', competitions: [{ id: '9', status: { period: 2, clock: 300, type: { state: 'in', name: 'STATUS_IN_PROGRESS' } }, competitors: [{ homeAway: 'home', team: { id: '1', abbreviation: 'NMSU', displayName: home.name, shortDisplayName: home.short, location: home.location } }, { homeAway: 'away', team: { id: '2', abbreviation: 'VAL', displayName: away.name, shortDisplayName: away.short, location: away.location } }], situation: s }] }] });
  const sit = (s) => X.normalizeScoreboard(raw(s), 'cfb')[0].situation;
  assert.equal(sit({ possession: '1', possessionText: 'NEWMEXST 16', down: 1, distance: 10 }).yOwn, 16);
  assert.equal(sit({ possession: '2', possessionText: 'NEWMEXST 16', down: 2, distance: 7 }).yOwn, 84);
  assert.equal(sit({ possession: '2', downDistanceText: '3rd & 2 at 50' }).yOwn, 50);
  // No text: ESPN counts yardLine from the home goal line.
  assert.equal(sit({ possession: '2', yardLine: 75 }).yOwn, 25);
  assert.equal(sit({ possession: '1', yardLine: 75, isRedZone: false }).yOwn, 75);
});

test('UFC scoreboard: every fight is its own game', () => {
  const games = X.normalizeScoreboard(fx('ufc-scoreboard.json'), 'ufc');
  assert.equal(games.length, 2);
  const [live, done] = games;
  assert.equal(live.id, '401900101');
  assert.equal(live.state, 'in');
  assert.equal(live.home.name, 'Alan Alpha');
  assert.equal(live.away.abbr, 'BRAVO');
  assert.equal(live.fight.rounds, 5);
  assert.equal(done.winner, 'away');
  assert.equal(done.fight.method, 'KO/TKO');
  const r = E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'away', odds: 135 }, done);
  assert.equal(r.status, 'won');
});

test('finding games from free text', () => {
  const games = X.normalizeScoreboard(fx('nfl-scoreboard-live.json'), 'nfl');
  assert.equal(X.findGame(games, 'Bills').game.id, '401900001');
  assert.equal(X.findGame(games, 'KC', 'Raiders').game.id, '401900002');
  assert.equal(X.findGame(games, 'Kansas City Chiefs').aSide, 'away');
  assert.equal(X.findGame(games, 'Philadelphia').game.home.abbr, 'PHI');
  assert.equal(X.findGame(games, 'Green Bay'), null);
});

test('merging keeps the live situation and the format', () => {
  const games = X.normalizeScoreboard(fx('nfl-scoreboard-live.json'), 'nfl');
  const live = games[0];
  const fromSummary = { ...live, situation: null, regulationPeriods: 4, periodSec: 900, odds: null };
  const m = X.mergeGame(fromSummary, live);
  assert.equal(m.situation.side, 'away');
  assert.equal(m.regulationPeriods, 4);
  assert.equal(m.odds.spreadHome, -3.5);
});

test('team matching: college names that share a word', () => {
  const g = (id, h, a) => ({ id, home: h, away: a });
  const t = (abbr, location, short) => ({ abbr, location, short, name: `${location} ${short}` });
  const games = [
    g('1', t('TEX', 'Texas', 'Longhorns'), t('OU', 'Oklahoma', 'Sooners')),
    g('2', t('LSU', 'LSU', 'Tigers'), t('TA&M', 'Texas A&M', 'Aggies')),
    g('3', t('M-OH', 'Miami (OH)', 'RedHawks'), t('BALL', 'Ball State', 'Cardinals')),
    g('4', t('MIA', 'Miami', 'Hurricanes'), t('FSU', 'Florida State', 'Seminoles')),
    g('5', t('OSU', 'Ohio State', 'Buckeyes'), t('MICH', 'Michigan', 'Wolverines')),
  ];
  assert.equal(X.findGame(games, 'Texas A&M', 'LSU').game.id, '2');
  assert.equal(X.findGame(games, 'Texas A&M').game.id, '2');
  assert.equal(X.findGame(games, 'Miami Hurricanes', 'Florida State').game.id, '4');
  assert.equal(X.findGame(games, 'Miami (OH)').game.id, '3');
  assert.equal(X.findGame(games, 'Ohio St', 'Michigan').game.id, '5');
  assert.equal(X.findGame(games, 'Texas').game.id, '1');
  assert.equal(X.findGame(games, 'Texas', 'Alabama'), null);
  assert.equal(X.findGame(games, 'Florida State Seminoles').aSide, 'away');
});
