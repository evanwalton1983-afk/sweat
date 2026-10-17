import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

function game(sport, over = {}) {
  return {
    id: 'g1', sport, state: 'in', statusName: 'STATUS_IN_PROGRESS', completed: false, period: 1, clock: 900,
    home: { id: 'h', abbr: 'HOM', score: 0, linescores: [] },
    away: { id: 'a', abbr: 'AWY', score: 0, linescores: [] },
    odds: { spreadHome: -3, total: 45 },
    ...over,
  };
}

function final(sport, h, a, ls = {}, extra = {}) {
  return game(sport, {
    state: 'post', statusName: 'STATUS_FINAL', completed: true, period: 4, clock: 0,
    home: { id: 'h', abbr: 'HOM', score: h, linescores: ls.h || [] },
    away: { id: 'a', abbr: 'AWY', score: a, linescores: ls.a || [] },
    ...extra,
  });
}

const leg = (o) => ({ sport: 'nfl', segment: 'game', odds: -110, ...o });

test('odds math', () => {
  close(E.americanToDecimal(-110), 1 + 100 / 110);
  close(E.americanToDecimal(150), 2.5);
  assert.ok(Number.isNaN(E.americanToDecimal(50)));
  assert.equal(E.decimalToAmerican(2.5), 150);
  assert.equal(E.decimalToAmerican(1.5), -200);
  close(E.impliedProb(-200), 2 / 3);
  const nv = E.noVig(-110, -110);
  close(nv[0], 0.5);
  assert.equal(E.profitOnWin(10, -110), 9.09);
  assert.equal(E.profitOnWin(10, 250), 25);
  assert.equal(E.formatAmerican(120), '+120');
  assert.equal(E.formatAmerican(-105), '-105');
});

test('hedge locks the same profit both ways', () => {
  const h = E.hedgePlan(100, 300, -250); // $100 at +300, other side now -250
  const d1 = E.americanToDecimal(300);
  const d2 = E.americanToDecimal(-250);
  const ifFirst = 100 * (d1 - 1) - h.hedgeStake;
  const ifHedge = h.hedgeStake * (d2 - 1) - 100;
  assert.ok(Math.abs(ifFirst - ifHedge) < 0.02);
  assert.ok(Math.abs(h.lockedProfit - ifFirst) < 0.02);
  assert.equal(E.hedgePlan(0, 100, 100), null);
});

test('final grading: spreads, totals, moneylines and pushes', () => {
  const g = final('nfl', 24, 21);
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -3 }), g).status, 'push');
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -2.5 }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'away', line: 3.5 }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'away', line: 2.5 }), g).status, 'lost');
  assert.equal(E.evaluateLeg(leg({ market: 'moneyline', side: 'home' }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'over', line: 45 }), g).status, 'push');
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'under', line: 45.5 }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'team_total', team: 'away', side: 'over', line: 20.5 }), g).status, 'won');
  const t = E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -2.5 }), g).text;
  assert.equal(t, 'Covered by 0.5');
});

test('first half and first quarter settle from line scores', () => {
  const ls = { h: [7, 3, 0, 14], a: [0, 10, 7, 0] };
  const g = final('nfl', 24, 17, ls);
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -0.5, segment: '1h' }), g).status, 'lost');
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'over', line: 19.5, segment: '1h' }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'moneyline', side: 'home', segment: '1q' }), g).status, 'won');
  // A first-half bet is settled at halftime, before the game ends.
  const half = game('nfl', { statusName: 'STATUS_HALFTIME', period: 2, clock: 0, home: { score: 10, linescores: [7, 3] }, away: { score: 10, linescores: [0, 10] } });
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'under', line: 20.5, segment: '1h' }), half).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'home', line: 0, segment: '1h' }), half).status, 'push');
});

test('live probabilities are proper and move the right way', () => {
  const pre = game('nfl', { state: 'pre', period: 0, statusName: 'STATUS_SCHEDULED' });
  const p = E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -3 }), pre);
  close(p.win + p.push + p.lose, 1, 1e-9);
  assert.ok(p.push > 0.05 && p.push < 0.11, `push on 3 ${p.push}`);
  assert.ok(Math.abs(p.win - p.lose) < 0.06);
  const up = game('nfl', { period: 4, clock: 30, home: { score: 20, linescores: [] }, away: { score: 17, linescores: [] }, situation: { side: 'away', yOwn: 25, down: 1, distance: 10 } });
  const ml = E.evaluateLeg(leg({ market: 'moneyline', side: 'home' }), up);
  assert.ok(ml.win > 0.85, `home up 3 with 30 seconds left ${ml.win}`);
  const down = game('nfl', { period: 4, clock: 30, home: { score: 13, linescores: [] }, away: { score: 17, linescores: [] }, situation: { side: 'home', yOwn: 70, down: 1, distance: 10 } });
  const need = E.evaluateLeg(leg({ market: 'moneyline', side: 'home' }), down);
  assert.ok(need.win > 0.1 && need.win < 0.5, `needs a TD from the 30 ${need.win}`);
});

test('overs and anytime touchdowns cash before the final', () => {
  const g = game('nfl', { period: 3, clock: 400, home: { score: 28, linescores: [] }, away: { score: 20, linescores: [] } });
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'over', line: 47.5 }), g).status, 'won');
  assert.equal(E.evaluateLeg(leg({ market: 'total', side: 'under', line: 47.5 }), g).status, 'lost');
  const players = { p1: { id: 'p1', name: 'Rhamondre Stevenson', stats: { rushTD: 1 } } };
  const td = E.evaluateLeg(leg({ market: 'prop', stat: 'anyTD', side: 'yes', playerName: 'Rhamondre Stevenson', odds: 120 }), g, players);
  assert.equal(td.status, 'won');
});

test('postponed games void every leg', () => {
  const g = game('nfl', { state: 'post', statusName: 'STATUS_POSTPONED', completed: false });
  assert.equal(E.evaluateLeg(leg({ market: 'spread', side: 'home', line: -3 }), g).status, 'void');
});

test('parlays: a loss ends it, pushes shorten it', () => {
  const g = final('nfl', 24, 21);
  const legs = [leg({ market: 'spread', side: 'home', line: -3, odds: -110 }), leg({ market: 'total', side: 'under', line: 47.5, odds: -110 })];
  const evals = legs.map((l) => E.evaluateLeg(l, g));
  const bet = { stake: 10, odds: 264, legs };
  const res = E.evaluateBet(bet, evals);
  assert.equal(res.status, 'won');
  // The push drops a leg, so the book pays the single -110 leg, not the +264 parlay.
  assert.equal(E.settleBet(bet, res.status, evals), 9.09);
  const lost = [leg({ market: 'moneyline', side: 'away', odds: 120 }), legs[1]];
  const ev2 = lost.map((l) => E.evaluateLeg(l, g));
  assert.equal(E.evaluateBet({ stake: 10, legs: lost }, ev2).status, 'lost');
  assert.equal(E.settleBet({ stake: 10, legs: lost }, 'lost', ev2), -10);
});

test('parlay price falls back to the book price when legs have none', () => {
  const legs = [{ odds: -110 }, { odds: null }, { odds: undefined }];
  const d = E.parlayDecimal(legs, null, 600);
  close(d, 7, 1e-9);
  const evals = [{ status: 'won' }, { status: 'push' }, { status: 'won' }];
  const d2 = E.parlayDecimal(legs, evals, 600);
  const each = Math.sqrt(7 / E.americanToDecimal(-110));
  close(d2, E.americanToDecimal(-110) * each, 1e-9);
});

test('live parlay chance multiplies the legs', () => {
  const evals = [{ status: 'live', win: 0.6, push: 0, lose: 0.4 }, { status: 'won', win: 1, push: 0, lose: 0 }, { status: 'pending', win: 0.5, push: 0, lose: 0.5 }];
  const r = E.evaluateBet({ legs: [{}, {}, {}] }, evals);
  close(r.win, 0.3, 1e-9);
  assert.equal(r.status, 'live');
});

test('basketball: overtime adds points and splits ties', () => {
  const g = game('nba', { period: 4, clock: 1, home: { score: 100, linescores: [] }, away: { score: 100, linescores: [] }, odds: { spreadHome: -2, total: 220 } });
  const ml = E.evaluateLeg({ sport: 'nba', market: 'moneyline', side: 'home', odds: -110, segment: 'game' }, g);
  assert.equal(ml.push, 0);
  assert.ok(ml.win > 0.45 && ml.win < 0.65);
  const ov = E.evaluateLeg({ sport: 'nba', market: 'total', side: 'over', line: 210.5, odds: -110, segment: 'game' }, g);
  assert.ok(ov.win > 0.8, `tied at the buzzer, over 210.5 ${ov.win}`);
});

test('basketball props: rate, foul trouble and no-shows', () => {
  const g = game('nba', { period: 3, clock: 360, odds: { spreadHome: -2, total: 220 } });
  const base = { sport: 'nba', market: 'prop', stat: 'pts', side: 'over', line: 24.5, playerName: 'Jalen Brunson', odds: -115, segment: 'game' };
  const hot = E.evaluateLeg(base, g, { p: { id: 'p', name: 'Jalen Brunson', starter: true, stats: { pts: 22, min: 26, pf: 2 } } });
  const fouled = E.evaluateLeg(base, g, { p: { id: 'p', name: 'Jalen Brunson', starter: true, stats: { pts: 22, min: 26, pf: 6 } } });
  assert.ok(hot.win > 0.6, `22 points through 3 quarters ${hot.win}`);
  assert.equal(fouled.win, 0);
  assert.match(hot.text, /needs 3 more/);
  const done = final('nba', 110, 100);
  const dnp = E.evaluateLeg(base, done, { p: { id: 'p', name: 'Jalen Brunson', didNotPlay: true, stats: {} } });
  assert.equal(dnp.status, 'void');
  const missing = E.evaluateLeg(base, done, { q: { id: 'q', name: 'Someone Else', stats: { pts: 3, min: 10 } } });
  assert.equal(missing.status, 'review');
  const r = E.evaluateBet({ legs: [base, base] }, [missing, { status: 'won', win: 1, push: 0, lose: 0 }]);
  assert.equal(r.status, 'review');
});

test('player names match without suffixes or accents', () => {
  assert.equal(E.normName('Luka Dončić'), 'luka doncic');
  assert.equal(E.normName('Michael Penix Jr.'), 'michael penix');
  const g = final('nba', 100, 90);
  const res = E.evaluateLeg({ sport: 'nba', market: 'prop', stat: 'reb', side: 'over', line: 9.5, playerName: 'Luka Doncic', segment: 'game' }, g, { x: { id: 'x', name: 'Luka Dončić', stats: { reb: 11, min: 36 } } });
  assert.equal(res.status, 'won');
});

test('fights settle on the winner, draws push', () => {
  const g = { id: 'f', sport: 'ufc', state: 'post', completed: true, winner: 'away', home: { abbr: 'A' }, away: { abbr: 'B' } };
  assert.equal(E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'away', odds: 150 }, g).status, 'won');
  assert.equal(E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'home', odds: -170 }, g).status, 'lost');
  assert.equal(E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'home', odds: -170 }, { ...g, winner: 'draw' }).status, 'push');
  const live = E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'home', odds: -200 }, { ...g, state: 'in', completed: false, winner: null, period: 2 });
  assert.equal(live.status, 'live');
  assert.ok(live.win > 0.6 && live.win < 0.67);
});

test('middles: window and live chance', () => {
  const l = { sport: 'nfl', market: 'total', side: 'over', line: 44.5, segment: 'game' };
  assert.deepEqual(E.middleWindow(l, 48.5), { lo: 45, hi: 48 });
  assert.equal(E.middleWindow(l, 43.5), null);
  const s = { sport: 'nfl', market: 'spread', side: 'home', line: -3.5, segment: 'game' };
  assert.deepEqual(E.middleWindow(s, 6.5), { lo: 4, hi: 6 });
  const g = game('nfl', { period: 3, clock: 600, home: { score: 21, linescores: [] }, away: { score: 17, linescores: [] } });
  const c = E.chanceInWindow(s, g, {}, 4, 6);
  assert.ok(c > 0.05 && c < 0.5, `margin lands 4 to 6: ${c}`);
});

test('clock: halftime ends the first half, overtime is detected', () => {
  const sp = E.SPORTS.nba;
  const half = E.clockState({ state: 'in', period: 2, clock: 0, statusName: 'STATUS_HALFTIME' }, sp, '1h');
  assert.equal(half.segDone, true);
  assert.equal(E.clockState({ state: 'in', period: 2, clock: 0, statusName: 'STATUS_IN_PROGRESS' }, sp, '1h').segDone, false);
  const ot = E.clockState({ state: 'in', period: 5, clock: 120 }, sp, 'game');
  assert.equal(ot.inOT, true);
  const q3 = E.clockState({ state: 'in', period: 3, clock: 360 }, sp, 'game');
  assert.equal(q3.left, 360 + 720);
});

test('no long dashes in any text the engine writes', () => {
  const g = game('nba', { period: 2, clock: 200, home: { score: 50, linescores: [25] }, away: { score: 48, linescores: [20] }, odds: { spreadHome: -4, total: 225 } });
  const legs = [
    { sport: 'nba', market: 'spread', side: 'home', line: -4.5, segment: 'game' },
    { sport: 'nba', market: 'total', side: 'under', line: 224.5, segment: 'game' },
    { sport: 'nba', market: 'team_total', team: 'away', side: 'over', line: 110.5, segment: 'game' },
    { sport: 'nba', market: 'prop', stat: 'pra', side: 'over', line: 30.5, playerName: 'A B', segment: 'game' },
  ];
  for (const l of legs) {
    const r = E.evaluateLeg(l, g, { a: { id: 'a', name: 'A B', stats: { pts: 10, reb: 4, ast: 3, min: 18 } } });
    const label = E.legLabel(l, g);
    assert.doesNotMatch(`${r.text} ${label}`, /[\u2013\u2014]/);
  }
});

test('review fixes: halves settle only when ESPN calls halftime', () => {
  const g = game('nfl', { period: 2, clock: 0, statusName: 'STATUS_IN_PROGRESS', home: { score: 13, linescores: [7, 6] }, away: { score: 10, linescores: [3, 7] } });
  const l = leg({ market: 'total', side: 'over', line: 23.5, segment: '1h' });
  assert.equal(E.evaluateLeg(l, g).status, 'live');
  const half = { ...g, statusName: 'STATUS_HALFTIME', home: { score: 14, linescores: [7, 7] } };
  assert.equal(E.evaluateLeg(l, half).status, 'won');
  const q2 = { ...g, period: 2, clock: 900, statusName: 'STATUS_IN_PROGRESS', home: { score: 7, linescores: [7, 0] }, away: { score: 3, linescores: [3, 0] } };
  assert.equal(E.evaluateLeg(leg({ market: 'moneyline', side: 'home', segment: '1q' }), q2).status, 'won');
});

test('review fixes: props wait for a final box score', () => {
  const g = final('nba', 110, 100);
  const l = { sport: 'nba', market: 'prop', stat: 'pts', side: 'over', line: 16.5, playerName: 'OG Anunoby', segment: 'game' };
  const players = { a: { id: 'a', name: 'OG Anunoby', stats: { pts: 15, min: 30 } } };
  const r = E.evaluateLeg(l, g, players, { statsFinal: false });
  assert.equal(r.status, 'live');
  assert.equal(E.evaluateLeg(l, g, players, { statsFinal: true }).status, 'lost');
});

test('review fixes: a different player with the same last name is not a match', () => {
  const g = final('nfl', 24, 21);
  const l = leg({ market: 'prop', stat: 'rec', side: 'over', line: 4.5, playerName: 'Keenan Allen' });
  const r = E.evaluateLeg(l, g, { j: { id: 'j', name: 'Josh Allen', stats: { passYds: 250 } } });
  assert.equal(r.status, 'review');
  const ok = E.evaluateLeg({ ...l, playerName: 'K. Allen' }, g, { k: { id: 'k', name: 'Keenan Allen', stats: { rec: 6 } }, j: { id: 'j', name: 'Josh Allen', stats: {} } });
  assert.equal(ok.status, 'won');
});

test('review fixes: return and defensive touchdowns count for anytime touchdown', () => {
  const g = final('nfl', 24, 21);
  const l = leg({ market: 'prop', stat: 'anyTD', side: 'yes', playerName: 'Return Man', odds: 300 });
  assert.equal(E.evaluateLeg(l, g, { r: { id: 'r', name: 'Return Man', stats: { retTD: 1 } } }).status, 'won');
});

test('review fixes: a finished fight with no winner waits instead of pushing', () => {
  const g = { id: 'f', sport: 'ufc', state: 'post', completed: true, winner: null, home: { abbr: 'A' }, away: { abbr: 'B' } };
  assert.equal(E.evaluateLeg({ sport: 'ufc', market: 'moneyline', side: 'home', odds: -150 }, g).status, 'review');
});
