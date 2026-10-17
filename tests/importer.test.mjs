import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeImport } from '../src/importer.js';

const code = (payload) => `NUM1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
const leg = { sport: 'nfl', market: 'spread', segment: 'game', team: 'Buffalo Bills', opponent: 'Miami Dolphins', odds: -120, date: '2026-10-11', line: -2.5 };

test('bets from The Number decode to the slip shape', () => {
  const bets = decodeImport(`Here you go: ${code({ from: 'the-number', v: 1, bets: [{ book: 'FanDuel', stake: 15, odds: -120, legs: [leg] }] })}`);
  assert.equal(bets.length, 1);
  assert.deepEqual(bets[0], { book: 'FanDuel', stake: 15, odds: -120, bonus: false, result: 'open', legs: [leg] });
  const total = decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'DraftKings', stake: 10, odds: -110, legs: [{ ...leg, market: 'total', side: 'under', line: 45.5 }] }] }));
  assert.equal(total[0].legs[0].side, 'under');
  const ml = decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'Fanatics', stake: 7, odds: 150, legs: [{ ...leg, sport: 'ufc', market: 'moneyline', team: 'Bruno Bravo', opponent: 'Alan Alpha', line: undefined }] }] }));
  assert.equal(ml[0].legs[0].line, undefined);
});

test('anything else is turned away', () => {
  assert.throws(() => decodeImport('hello'), /not a bet code/);
  assert.throws(() => decodeImport('NUM1.@@@@@@@@@@'), /not a bet code/);
  assert.throws(() => decodeImport('NUM1.AAAAAAAAAAAA'), /damaged/);
  assert.throws(() => decodeImport(code({ from: 'someone', bets: [] })), /not a bet code/);
  assert.throws(() => decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'X', stake: 0, odds: -110, legs: [leg] }] })), /no bet/);
  assert.throws(() => decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'X', stake: 10, odds: 50, legs: [leg] }] })), /no bet/);
  assert.throws(() => decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'X', stake: 10, odds: -110, legs: [{ ...leg, sport: 'golf' }] }] })), /no bet/);
  assert.throws(() => decodeImport(code({ from: 'the-number', v: 1, bets: [{ book: 'X', stake: 10, odds: -110, legs: [{ ...leg, line: null }] }] })), /no bet/);
});
