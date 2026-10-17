import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slipReader, livePrices } from '../netlify/lib/features.mjs';
import status from '../netlify/functions/status.mjs';
import slip from '../netlify/functions/slip.mjs';

// What Netlify puts on a site on a plan with AI Gateway when the owner added no Anthropic key.
const GATEWAY = { ANTHROPIC_API_KEY: 'nf-key', ANTHROPIC_BASE_URL: 'https://gateway.test/anthropic/', NETLIFY_AI_GATEWAY_KEY: 'nf-key', NETLIFY_AI_GATEWAY_URL: 'https://gateway.test' };
const NAMES = ['APP_PASSCODE', 'SLIP_READER', 'ODDS_API_KEY', ...Object.keys(GATEWAY)];

// Runs fn with exactly these variables set, and fetch swapped for a recorder.
async function withEnv(env, fn) {
  const saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers || {} });
    const input = { bets: [{ stake: 10, odds: -110, legs: [{ sport: 'nfl', market: 'spread', team: 'Buffalo Bills', line: -3.5 }] }], notes: '' };
    return Response.json({ content: [{ type: 'tool_use', id: 't1', name: 'record_bets', input }] });
  };
  for (const k of NAMES) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of NAMES) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ask = (ip, pass = 'pw') => slip(new Request('http://x/api/slip', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sweat-passcode': pass, 'x-nf-client-connection-ip': ip },
  body: JSON.stringify({ text: 'Bills -3.5 -110 $10' }),
}));
const caps = async () => (await status()).json();

test('slip reader stays off until SLIP_READER is on', () => {
  assert.equal(slipReader({}).on, false);
  // Netlify's own key on a gateway plan, with or without a passcode, is not a choice to pay for slips.
  assert.equal(slipReader({ ...GATEWAY }).on, false);
  assert.equal(slipReader({ ...GATEWAY, APP_PASSCODE: 'pw' }).on, false);
  // Nor is an Anthropic key on its own (it may be a team-wide key for another project).
  assert.equal(slipReader({ ANTHROPIC_API_KEY: 'sk', APP_PASSCODE: 'pw' }).on, false);
  assert.equal(slipReader({ ANTHROPIC_API_KEY: 'sk', SLIP_READER: 'off', APP_PASSCODE: 'pw' }).on, false);
  // Switched on: still needs a key and a passcode.
  assert.equal(slipReader({ SLIP_READER: 'on', APP_PASSCODE: 'pw' }).on, false);
  assert.equal(slipReader({ SLIP_READER: 'on', ANTHROPIC_API_KEY: 'sk' }).on, false);
  assert.equal(slipReader({ SLIP_READER: 'ON', ANTHROPIC_API_KEY: 'sk', APP_PASSCODE: 'pw' }).on, true);
  assert.equal(slipReader({ SLIP_READER: 'true', ...GATEWAY, APP_PASSCODE: 'pw' }).on, true);
});

test('slip reader calls Anthropic with your key, or the gateway with Netlify\'s', () => {
  assert.equal(slipReader({ ANTHROPIC_API_KEY: 'sk' }).url, 'https://api.anthropic.com/v1/messages');
  const gw = slipReader({ ...GATEWAY });
  assert.equal(gw.url, 'https://gateway.test/anthropic/v1/messages');
  assert.equal(gw.key, 'nf-key');
});

test('live prices need the owner\'s odds key and a passcode', () => {
  assert.equal(livePrices({ ODDS_API_KEY: 'k' }).on, false);
  assert.equal(livePrices({ APP_PASSCODE: 'pw' }).on, false);
  assert.equal(livePrices({ ODDS_API_KEY: 'k', APP_PASSCODE: 'pw' }).on, true);
});

test('/api/status: a gateway site with an odds key shows live prices, not the slip reader', async () => {
  await withEnv({ ...GATEWAY, ODDS_API_KEY: 'k', APP_PASSCODE: 'pw' }, async () => {
    assert.deepEqual(await caps(), { slip: false, odds: true });
  });
  await withEnv({}, async () => {
    assert.deepEqual(await caps(), { slip: false, odds: false });
  });
  await withEnv({ ...GATEWAY, SLIP_READER: 'on', ODDS_API_KEY: 'k', APP_PASSCODE: 'pw' }, async () => {
    assert.deepEqual(await caps(), { slip: true, odds: true });
  });
});

test('/api/slip refuses without calling Claude while the reader is off', async () => {
  await withEnv({ ...GATEWAY, APP_PASSCODE: 'pw' }, async (calls) => {
    const res = await ask('10.0.0.1');
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /off/);
    assert.equal(calls.length, 0);
  });
});

test('/api/slip, once switched on, goes through the gateway when Netlify provides it', async () => {
  await withEnv({ ...GATEWAY, SLIP_READER: 'on', APP_PASSCODE: 'pw' }, async (calls) => {
    assert.equal((await ask('10.0.0.2', 'wrong')).status, 401);
    const res = await ask('10.0.0.2');
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.bets[0].legs[0].team, 'Buffalo Bills');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gateway.test/anthropic/v1/messages');
    assert.equal(calls[0].headers['x-api-key'], 'nf-key');
  });
});
