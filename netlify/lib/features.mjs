// Which optional features this site has switched on. /api/status and the functions that do the
// work both read this, so the app only shows buttons that will answer.
//
// The slip reader calls Claude, which costs money, so it stays off until the site owner sets
// SLIP_READER to on. An Anthropic key alone does not switch it on: on Netlify plans with AI
// Gateway, Netlify adds ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL to every site by itself (billed
// to Netlify credits), and a team-wide key may belong to another project.
const YES = /^(on|true|yes|1)$/i;

export function slipReader(env = process.env) {
  const key = env.ANTHROPIC_API_KEY || '';
  // With your own key there is no base URL and calls go straight to Anthropic. With Netlify's
  // gateway, Netlify sets both, and the call goes through the gateway.
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  return {
    on: !!env.APP_PASSCODE && YES.test(env.SLIP_READER || '') && !!key,
    key,
    url: `${base}/v1/messages`,
  };
}

export function livePrices(env = process.env) {
  const key = env.ODDS_API_KEY || '';
  return { on: !!env.APP_PASSCODE && !!key, key };
}
