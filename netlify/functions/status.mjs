// GET /api/status: which optional features this site has switched on. Booleans only; no secrets.
import { slipReader, livePrices } from '../lib/features.mjs';

export default async () => {
  const body = { slip: slipReader().on, odds: livePrices().on };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/status' };
