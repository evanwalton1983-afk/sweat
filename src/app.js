// Sweat: the app. Vanilla JS, one state object, delegated events, and a polling loop that keeps
// every open bet's cash chance current.
import {
  SPORTS, SPORT_KEYS, STATS, SEGMENTS, ENGINE_VERSION, evaluateLeg, evaluateBet, settleBet,
  americanToDecimal, decimalToAmerican, impliedProb, hedgePlan, cashOutVerdict, middleWindow, chanceInWindow, legLabel, fmtLine, fmtNum, parlayDecimal,
} from './engine.js';
import { espnDate, shiftDate, findGame, teamScore } from './espn.js';
import * as feed from './feed.js';
import { decodeImport } from './importer.js';
import * as db from './store.js';
import {
  esc, money, pct, bucket, odds as fmtOdds, dayLabel, kickoff, clockTime, ago, gameClock, icon, sparkline, bigline, profitChart, betTitle,
} from './ui.js';

const APP_VERSION = '1.1.0';
const MARKET_NAMES = { spread: 'Spread', moneyline: 'Moneyline', total: 'Total', team_total: 'Team total', prop: 'Player' };
const SETTLED = new Set(['won', 'lost', 'push', 'void', 'cashed']);
const DEFAULTS = {
  stake: 10,
  parlayStake: 5,
  theme: 'night',
  alerts: true,
  swing: 15,
  settleAlerts: true,
  sound: true,
  keepAwake: true,
  lightsUrl: '',
  settleUrl: '',
  passcode: '',
  books: ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN BET', 'Fanatics', 'bet365', 'Hard Rock Bet'],
};

const state = {
  tab: 'live',
  bets: [],
  games: new Map(),
  players: new Map(),
  statsFinal: new Map(),
  caps: { slip: false, odds: false },
  feed: { at: 0, ok: true, error: '', busy: false },
  settings: { ...DEFAULTS },
  add: { mode: 'build', sport: 'nfl', date: espnDate(), games: [], loading: false, error: '', q: '', loadedKey: '' },
  slip: { legs: [], stake: '', odds: '', book: '', bonus: false },
  paste: { text: '', image: '', busy: false, error: '', result: null, notes: '' },
  imp: { text: '', busy: false, error: '', result: null },
  history: { range: '30', sport: 'all' },
  sheet: null,
  shownPct: new Map(),
  fresh: new Set(),
  lightState: '',
};

const $ = (sel, root = document) => root.querySelector(sel);
const isSettled = (b) => SETTLED.has(b.status);
const gameKey = (l) => `${l.sport}:${l.eventId}`;
const gameFor = (l) => state.games.get(gameKey(l)) || null;
const num = (v) => (v === '' || v == null ? NaN : Number(v));

// ------------------------------------------------------------ boot

async function boot() {
  const saved = await db.getKV('settings', {});
  state.settings = { ...DEFAULTS, ...(saved || {}) };
  applyTheme();
  state.bets = (await db.allBets()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const cached = await db.getKV('games', []);
  for (const g of cached || []) state.games.set(`${g.sport}:${g.id}`, g);
  const q = new URLSearchParams(location.search);
  if (q.get('feed') === 'direct') feed.configureFeed({ directOnly: true });
  window.addEventListener('hashchange', route);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick(true);
  });
  window.addEventListener('online', () => tick(true));
  takeImport();
  route();
  evaluateAll(false);
  render();
  tick(true);
  setInterval(renderTop, 5000);
  // Slip reading and live prices only show when the site has keys for them.
  feed.status().then((caps) => {
    state.caps = caps;
    if (!caps.slip && (state.add.mode === 'paste' || state.add.mode === 'photo')) state.add.mode = 'build';
    render();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || 'night';
  const day = state.settings.theme === 'day' || (state.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', day ? '#eef1f5' : '#0b1424');
}

// A link from The Number (#import=NUM1...) opens the Add tab with that bet ready to save.
function takeImport() {
  if (!location.hash.startsWith('#import=')) return false;
  state.imp = { text: decodeURIComponent(location.hash.slice(8)), busy: false, error: '', result: null };
  state.add.mode = 'import';
  history.replaceState(null, '', '#add');
  readImport();
  return true;
}

async function readImport() {
  const m = state.imp;
  m.busy = true;
  m.error = '';
  m.result = null;
  if (state.tab === 'add') renderMain();
  try {
    m.result = await Promise.all(decodeImport(m.text).map(resolveBet));
  } catch (e) {
    m.error = e.message;
  }
  m.busy = false;
  if (state.tab === 'add') renderMain();
}

function viewImport() {
  const m = state.imp;
  return `<p class="note">Bets sent from The Number open here on their own. If Sweat is on your Home Screen, copy the bet code in The Number and paste it here.</p>
    <label class="field">Bet code<textarea class="input" data-bind="imp.text" placeholder="NUM1." rows="3">${esc(m.text)}</textarea></label>
    ${m.error ? `<p class="neg">${esc(m.error)}</p>` : ''}
    <button class="btn primary" data-action="read-import" ${!m.text.trim() || m.busy ? 'disabled' : ''}>${m.busy ? 'Finding the game...' : 'Open the bet'}</button>
    ${m.result ? previewHTML(m.result, 'save-import', 'import') : ''}`;
}

function route() {
  if (takeImport()) return;
  const h = (location.hash || '#live').slice(1);
  const tab = ['live', 'add', 'history', 'settings', 'tv'].includes(h) ? h : 'live';
  const was = state.tab;
  state.tab = tab;
  document.body.classList.toggle('tv', tab === 'tv');
  if (tab === 'tv') wake(true);
  else if (was === 'tv') wake(false);
  if (tab === 'add' && state.add.mode === 'build') loadGames();
  render();
  if (was !== tab) window.scrollTo(0, 0);
}

function go(tab) {
  if (location.hash !== `#${tab}`) location.hash = tab;
  else route();
}

// ------------------------------------------------------------ rendering

function render() {
  renderTop();
  renderTabs();
  renderMain();
  renderLayer();
}

function renderTop() {
  const top = $('#top');
  if (!top) return;
  if (state.tab === 'tv') {
    top.hidden = true;
    const c = $('#tvclock');
    if (c) c.textContent = clockTime();
    return;
  }
  top.hidden = false;
  const open = state.bets.filter((b) => !isSettled(b));
  const s = !open.length ? 'idle' : !state.feed.ok ? 'down' : Date.now() - state.feed.at > 90000 ? 'stale' : 'fresh';
  const text = !open.length ? 'No open bets' : !state.feed.ok ? 'Feed is down, retrying' : ago(state.feed.at);
  top.innerHTML = `<h1 class="wordmark">Sweat</h1>
    <div class="feed" role="status"><span class="dot" data-s="${s}"></span><span>${esc(text)}</span></div>
    <button class="icon-btn" data-action="refresh" aria-label="Refresh now">${icon('refresh')}</button>
    <button class="icon-btn" data-action="tv" aria-label="Big screen mode">${icon('tv')}</button>`;
}

function renderTabs() {
  const tabs = $('#tabs');
  const items = [['live', 'Live'], ['add', 'Add'], ['history', 'History'], ['settings', 'Settings']];
  tabs.innerHTML = items.map(([k, label]) => `<button data-action="tab" data-tab="${k}" ${state.tab === k ? 'aria-current="page"' : ''}>${icon(k)}<span>${label}</span></button>`).join('');
}

function renderMain() {
  const main = $('#main');
  const html = state.tab === 'live' ? viewLive() : state.tab === 'add' ? viewAdd() : state.tab === 'history' ? viewHistory() : state.tab === 'settings' ? viewSettings() : viewTV();
  main.innerHTML = html;
  rollNumbers();
  renderSlipBar();
}

function renderSlipBar() {
  let bar = $('#slipbar');
  const n = state.slip.legs.length;
  if (!n || state.tab === 'tv' || (state.sheet && state.sheet.type === 'slip')) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'slipbar';
    bar.className = 'slipbar';
    document.body.appendChild(bar);
  }
  const label = n === 1 ? legLabel(state.slip.legs[0]) : `${n}-leg parlay`;
  bar.innerHTML = `<b>${n}</b><span>${esc(label)}</span><button class="btn small" data-action="open-slip">Review slip</button>`;
}

// Count the big numbers up or down to their new value.
function rollNumbers() {
  const els = document.querySelectorAll('[data-roll]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of els) {
    const id = el.dataset.roll;
    const to = Number(el.dataset.to);
    const from = state.shownPct.has(id) ? state.shownPct.get(id) : to;
    state.shownPct.set(id, to);
    const out = el.querySelector('.n');
    if (!out || !Number.isFinite(to)) continue;
    if (reduce || from === to || !Number.isFinite(from)) {
      out.textContent = el.dataset.text || String(to);
      continue;
    }
    const t0 = performance.now();
    const dur = 650;
    const stepFn = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      out.textContent = k >= 1 ? el.dataset.text || String(to) : String(Math.round(from + (to - from) * e));
      if (k < 1 && out.isConnected) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  }
}

// ------------------------------------------------------------ tickets

function settledBucket(b) {
  if (b.status === 'won' || (b.status === 'cashed' && b.profit > 0)) return 'won';
  if (b.status === 'lost' || (b.status === 'cashed' && b.profit < 0)) return 'lost';
  return 'push';
}

function stampText(b) {
  if (b.status === 'won') return `Cashed ${money(b.profit, { sign: true })}`;
  if (b.status === 'lost') return b.bonus ? 'Lost, bonus bet' : 'Lost';
  if (b.status === 'push') return 'Push';
  if (b.status === 'void') return 'Void';
  if (b.status === 'cashed') return `Cashed out ${money(b.profit, { sign: true })}`;
  return '';
}

function bugHTML(g, leg) {
  if (!g) {
    const m = leg && leg.matchup;
    if (!m) return '';
    return `<header class="bug"><div class="teams">${['away', 'home'].map((s) => `<div class="t"><span class="sw" style="--tc:${esc((m[s] && m[s].color) || '')}"></span><span class="nm">${esc((m[s] && (m[s].abbr || m[s].name)) || '')}</span><span></span><span class="sc"></span></div>`).join('')}</div><div class="clock"><b>${esc(kickoff(leg.start))}</b></div></header>`;
  }
  const c = gameClock(g);
  const lead = (s) => (g.state === 'pre' ? '' : `data-lead="${s === 'home' ? g.home.score >= g.away.score : g.away.score >= g.home.score}"`);
  const ball = (s) => (g.situation && g.situation.side === s && g.state === 'in' ? '<span class="ball" title="Has the ball"></span>' : '');
  const row = (s) => {
    const t = g[s];
    const rank = t.rank ? `<span class="sub">${esc(t.rank)}</span> ` : '';
    const name = SPORTS[g.sport].kind === 'fight' ? t.name : t.abbr;
    return `<div class="t" ${lead(s)}><span class="sw" style="--tc:${esc(t.color)}"></span><span class="nm">${rank}${esc(name)}${ball(s)}</span><span></span><span class="sc">${g.state === 'pre' || SPORTS[g.sport].kind === 'fight' ? '' : esc(t.score)}</span></div>`;
  };
  const rz = g.situation && g.situation.redZone ? ' <span class="rz">Red zone</span>' : '';
  return `<header class="bug"><div class="teams">${row('away')}${row('home')}</div><div class="clock"><b>${esc(c.main)}</b>${esc(c.sub)}${rz}</div></header>`;
}

function legRowHTML(leg, ev) {
  const g = gameFor(leg);
  const st = ev ? ev.status : 'pending';
  const p = ev && Number.isFinite(ev.win) ? ev.win : NaN;
  const mark = st === 'won' ? '&#10003;' : st === 'lost' ? '&#215;' : st === 'push' || st === 'void' ? '=' : '';
  const fight = SPORTS[leg.sport].kind === 'fight';
  const m = leg.matchup || {};
  const who = g ? `${g.away.abbr} at ${g.home.abbr}` : m.away && m.home ? `${m.away.abbr} at ${m.home.abbr}` : '';
  const score = g && g.state !== 'pre' && !fight ? `${g.away.abbr} ${g.away.score}, ${g.home.abbr} ${g.home.score}, ${gameClock(g).main}. ` : g && g.state !== 'pre' ? `${gameClock(g).main}. ` : `${who}${who ? ', ' : ''}${kickoff((g && g.start) || leg.start)}. `;
  const right = SETTLED.has(st) ? '' : Number.isFinite(p) ? `${pct(p)}%` : '';
  return `<li class="leg" data-s="${esc(st)}" data-b="${bucket(p)}"><span class="mark" aria-hidden="true">${mark}</span><span class="lb">${esc(legLabel(leg, g))}</span><span class="lp">${right}</span><span class="lt">${esc(score + ((ev && ev.text) || ''))}</span></li>`;
}

function ticketHTML(b, opts = {}) {
  const live = b.live || {};
  const settled = isSettled(b);
  const single = b.legs.length === 1;
  const leg = b.legs[0];
  const g = single ? gameFor(leg) : null;
  const p = live.win;
  const bk = settled ? settledBucket(b) : Number.isFinite(p) ? bucket(p) : 'none';
  const title = single ? legLabel(leg, g) : `${b.legs.length}-leg parlay`;
  const priceText = Number.isFinite(num(b.odds)) ? ` at ${fmtOdds(b.odds)}` : '';
  const stakeLine = `${money(b.stake)}${priceText} to win ${money(toWin(b))}${b.bonus ? ', bonus bet' : ''}`;
  let why = '';
  if (single) {
    const e = (live.evals || [])[0];
    why = e && e.text ? e.text : g ? (g.state === 'pre' ? `Starts ${kickoff(g.start)}` : '') : 'Waiting for the game';
  } else {
    const e = live.evals || [];
    const won = e.filter((x) => x.status === 'won').length;
    const left = e.filter((x) => !SETTLED.has(x.status)).length;
    why = settled ? '' : `${won} of ${b.legs.length} legs in${left ? `, ${left} to go` : ''}`;
  }
  if (!settled && live.push >= 0.03) why += `${why ? '. ' : ''}Push chance ${pct(live.push)}%`;
  if (live.status === 'review') why = 'Needs a check. Settle it by hand.';
  const pctBlock = settled || !Number.isFinite(p) ? '' : `<div class="pct" data-roll="${esc(b.id)}" data-to="${Math.round(p * 100)}" data-text="${pct(p)}" aria-label="${pct(p)} percent to cash"><span class="n">${pct(p)}</span><span class="u">%</span></div>`;
  const legs = single ? '' : `<ul class="legs">${b.legs.map((l, i) => legRowHTML(l, (live.evals || [])[i])).join('')}</ul>`;
  const stamp = settled ? `<div class="stamp${state.fresh.has(b.id) ? ' fresh' : ''}">${esc(stampText(b))}</div>` : '';
  const stub = opts.tv ? '' : `<div class="perf" aria-hidden="true"></div><footer class="stub">
      ${!settled ? `<button class="btn" data-action="hedge" data-id="${esc(b.id)}">Hedge</button>` : ''}
      <button class="btn" data-action="detail" data-id="${esc(b.id)}">Details</button>
      <span class="book">${esc(b.book || '')}</span></footer>`;
  return `<article class="ticket" data-b="${bk}" aria-label="${esc(title)}">
    ${single ? bugHTML(g, leg) : ''}
    <div class="tk-body">
      <div class="pick">${esc(title)}</div>
      <div class="stake">${esc(stakeLine)}</div>
      ${pctBlock}
      ${why ? `<p class="why">${esc(why)}</p>` : ''}
      ${legs}
      ${(b.track || []).length >= 2 ? sparkline(b.track) : ''}
    </div>${stamp}${stub}</article>`;
}

// ------------------------------------------------------------ live

function groups() {
  const open = state.bets.filter((b) => !isSettled(b));
  const live = [];
  const next = [];
  const check = [];
  for (const b of open) {
    const st = b.live && b.live.status;
    if (st === 'review') check.push(b);
    else if (st === 'live' || (b.live && (b.live.evals || []).some((e) => e.status === 'live' || e.status === 'won'))) live.push(b);
    else next.push(b);
  }
  const startOf = (b) => Math.min(...b.legs.map((l) => new Date((gameFor(l) || {}).start || l.start || 0).getTime() || Infinity));
  next.sort((a, b) => startOf(a) - startOf(b));
  live.sort((a, b) => startOf(a) - startOf(b));
  const dayAgo = Date.now() - 18 * 3600 * 1000;
  const recent = state.bets.filter((b) => isSettled(b) && new Date(b.settledAt || 0).getTime() > dayAgo).sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  return { open, live, next, check, recent };
}

function viewLive() {
  const { open, live, next, check, recent } = groups();
  if (!open.length && !recent.length) {
    return `<section class="view"><div class="card empty">
      <p class="big">Nothing in play</p>
      <p class="sub">Add a bet and it shows up here with a live chance to cash.</p>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="btn primary" data-action="add-mode" data-mode="build">Build a bet</button>
        ${state.caps.slip ? `<button class="btn" data-action="add-mode" data-mode="paste">Paste a slip</button>
        <button class="btn" data-action="add-mode" data-mode="photo">Photo of a slip</button>` : ''}
      </div></div></section>`;
  }
  const risk = open.reduce((s, b) => s + (b.bonus ? 0 : Number(b.stake) || 0), 0);
  const could = open.reduce((s, b) => s + (toWin(b) || 0), 0);
  let exp = 0;
  let expKnown = false;
  for (const b of open) {
    const e = expected(b);
    if (Number.isFinite(e)) {
      exp += e;
      expKnown = true;
    }
  }
  const sec = (title, list, sub = '') => (list.length ? `<div class="section-head"><h2>${title}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div><div class="board">${list.map((b) => ticketHTML(b)).join('')}</div>` : '');
  const settledToday = recent.reduce((s, b) => s + (Number(b.profit) || 0), 0);
  return `<section class="view">
    <div class="strip" role="group" aria-label="Open bets">
      <div><div class="k">In play</div><div class="v">${esc(money(risk, { whole: true }))}</div></div>
      <div><div class="k">Could cash</div><div class="v">${esc(money(could, { whole: true }))}</div></div>
      <div><div class="k">Expected</div><div class="v ${exp > 0.004 ? 'pos' : exp < -0.004 ? 'neg' : ''}">${expKnown ? esc(money(exp, { sign: true })) : 'Soon'}</div></div>
    </div>
    ${sec('Needs a check', check)}
    ${sec('Live now', live)}
    ${sec('Up next', next)}
    ${sec('Settled lately', recent, recent.length ? `${money(settledToday, { sign: true })} net` : '')}
  </section>`;
}

function viewTV() {
  const { live, next, check } = groups();
  const list = [...check, ...live, ...next];
  let exp = 0;
  for (const b of list) if (Number.isFinite(expected(b))) exp += expected(b);
  const body = list.length ? list.map((b) => ticketHTML(b, { tv: true })).join('') : '<div class="card empty"><p class="big">Nothing in play</p><p class="sub">Open bets show up here in big type.</p></div>';
  return `<section>
    <div class="tvbar"><h1 class="wordmark">Sweat</h1><span class="exp ${exp > 0 ? 'pos' : exp < 0 ? 'neg' : ''}">${list.length ? `Expected ${esc(money(exp, { sign: true }))}` : ''}</span>
      <span class="clockbig" id="tvclock">${esc(clockTime())}</span>
      <button class="btn" data-action="exit-tv">Exit big screen</button></div>
    <div class="tvgrid">${body}</div></section>`;
}

// ------------------------------------------------------------ add

function viewAdd() {
  const a = state.add;
  if (!state.caps.slip && (a.mode === 'paste' || a.mode === 'photo')) a.mode = 'build';
  const modes = state.caps.slip ? [['build', 'Build'], ['paste', 'Paste'], ['photo', 'Photo'], ['import', 'Import']] : [['build', 'Build'], ['import', 'Import']];
  const seg = `<div class="seg" role="group" aria-label="How to add">${modes.map(([k, l]) => `<button data-action="add-mode" data-mode="${k}" aria-pressed="${a.mode === k}">${l}</button>`).join('')}</div>`;
  if (a.mode === 'paste' || a.mode === 'photo') return `<section class="view">${seg}${viewReader()}</section>`;
  if (a.mode === 'import') return `<section class="view">${seg}${viewImport()}</section>`;
  const sports = `<div class="chips" role="group" aria-label="Sport">${SPORT_KEYS.map((k) => `<button class="chip" data-action="sport" data-sport="${k}" aria-pressed="${a.sport === k}">${esc(SPORTS[k].name)}</button>`).join('')}</div>`;
  const d = new Date(`${a.date.slice(0, 4)}-${a.date.slice(4, 6)}-${a.date.slice(6, 8)}T12:00:00`);
  const daybar = `<div class="daybar"><button class="icon-btn" data-action="day" data-d="-1" aria-label="Day before">${icon('prev')}</button><div class="d">${esc(dayLabel(d))}${dayLabel(d) === 'Today' ? '' : ''}</div><button class="icon-btn" data-action="day" data-d="1" aria-label="Day after">${icon('next')}</button></div>`;
  let list = '';
  if (a.loading) list = '<p class="sub">Loading games...</p>';
  else if (a.error) list = `<div class="card"><p>${esc(a.error)}</p><button class="btn" data-action="reload-games">Try again</button></div>`;
  else {
    const q = a.q.trim();
    const games = a.games.filter((g) => !q || teamScore(q, g.home) > 0.3 || teamScore(q, g.away) > 0.3).sort((x, y) => (x.start < y.start ? -1 : 1));
    if (!a.games.length) list = `<div class="card"><p>No ${esc(SPORTS[a.sport].name)} games on this day.</p><button class="btn" data-action="next-gameday">Find the next game day</button></div>`;
    else if (!games.length) list = `<p class="sub">No game matches "${esc(q)}".</p>`;
    else list = `<div class="games">${games.map(gameRowHTML).join('')}</div>`;
  }
  const search = `<label class="search"><span class="sr">Find a team</span><input class="input" type="search" placeholder="Find a team or fighter" value="${esc(a.q)}" data-bind="add.q" autocomplete="off"></label>`;
  return `<section class="view">${seg}${sports}${daybar}${search}${list}</section>`;
}

function gameRowHTML(g) {
  const c = gameClock(g);
  const o = g.odds;
  const parts = [];
  if (o && o.details) parts.push(o.details);
  if (o && Number.isFinite(o.total)) parts.push(`total ${fmtNum(o.total)}`);
  const team = (s) => `<span class="tm"><span class="sw" style="--tc:${esc(g[s].color)}"></span><span>${g[s].rank ? `${esc(g[s].rank)} ` : ''}${esc(SPORTS[g.sport].kind === 'fight' ? g[s].name : g[s].name)}${g.state !== 'pre' ? ` ${esc(g[s].score)}` : ''}</span><span class="rec">${esc(g[s].record || '')}</span></span>`;
  const when = g.state === 'pre' ? `<b>${esc(kickoff(g.start))}</b>` : `<b>${esc(c.main)}</b>${esc(g.state === 'in' ? 'Live' : '')}`;
  const extra = SPORTS[g.sport].kind === 'fight' && g.fight ? [g.fight.weightClass, g.fight.segment].filter(Boolean).join(', ') : parts.join(', ');
  return `<button class="game" data-action="pick" data-id="${esc(g.id)}">${team('away')}${team('home')}<span class="when">${when}</span>${extra ? `<span class="ln">${esc(extra)}</span>` : ''}</button>`;
}

async function loadGames(force = false) {
  const a = state.add;
  const key = `${a.sport}|${a.date}`;
  if (!force && a.loadedKey === key && !a.error) return;
  a.loading = true;
  a.error = '';
  a.loadedKey = key;
  if (state.tab === 'add') renderMain();
  try {
    const games = await feed.scoreboard(a.sport, a.date);
    if (a.loadedKey !== key) return;
    a.games = games;
    for (const g of games) state.games.set(`${g.sport}:${g.id}`, mergeKeep(state.games.get(`${g.sport}:${g.id}`), g));
  } catch (e) {
    a.error = `Could not load games (${e.message || e}). Check the connection and try again.`;
    a.games = [];
  }
  a.loading = false;
  if (state.tab === 'add') renderMain();
}

function mergeKeep(prev, next) {
  if (!prev) return next;
  return { ...prev, ...next, odds: next.odds || prev.odds, situation: next.situation || null, regulationPeriods: next.regulationPeriods || prev.regulationPeriods, periodSec: next.periodSec || prev.periodSec };
}

async function nextGameDay() {
  const a = state.add;
  for (let i = 1; i <= 10; i++) {
    const d = shiftDate(a.date, 1);
    a.date = d;
    a.loadedKey = '';
    await loadGames(true);
    if (a.games.length || a.error) return;
  }
}

// ------------------------------------------------------------ pick sheet (one leg)

function openPick(gameId) {
  const g = state.add.games.find((x) => x.id === gameId);
  if (!g) return;
  const fight = SPORTS[g.sport].kind === 'fight';
  state.sheet = { type: 'pick', game: g, segment: 'game', market: fight ? 'moneyline' : 'spread', choice: null, line: '', odds: '', team: 'home', player: '', playerId: '', stat: SPORTS[g.sport].kind === 'basketball' ? 'pts' : 'recYds', roster: [], error: '' };
  renderLayer();
}

function marketOptions(s) {
  const g = s.game;
  const o = g.odds || {};
  const full = s.segment === 'game';
  const opt = (choice, a, b) => `<button class="opt" data-action="choose" data-choice="${esc(choice)}" aria-pressed="${s.choice === choice}"><span class="a">${esc(a)}</span><span class="b">${esc(b || 'Enter the price')}</span></button>`;
  if (s.market === 'spread') {
    const sh = full && Number.isFinite(o.spreadHome) ? o.spreadHome : null;
    return `<div class="options">${opt('away', `${g.away.abbr} ${sh != null ? fmtLine(-sh) : ''}`, full && o.awaySpreadOdds ? fmtOdds(o.awaySpreadOdds) : '')}${opt('home', `${g.home.abbr} ${sh != null ? fmtLine(sh) : ''}`, full && o.homeSpreadOdds ? fmtOdds(o.homeSpreadOdds) : '')}</div>`;
  }
  if (s.market === 'moneyline') {
    const fight = SPORTS[g.sport].kind === 'fight';
    return `<div class="options">${opt('away', fight ? g.away.name : `${g.away.abbr} to win`, full && o.awayML ? fmtOdds(o.awayML) : '')}${opt('home', fight ? g.home.name : `${g.home.abbr} to win`, full && o.homeML ? fmtOdds(o.homeML) : '')}</div>`;
  }
  if (s.market === 'total') {
    const t = full && Number.isFinite(o.total) ? fmtNum(o.total) : '';
    return `<div class="options">${opt('over', `Over ${t}`, full && o.overOdds ? fmtOdds(o.overOdds) : '')}${opt('under', `Under ${t}`, full && o.underOdds ? fmtOdds(o.underOdds) : '')}</div>`;
  }
  if (s.market === 'team_total') {
    return `<div class="chips" role="group" aria-label="Team">${['away', 'home'].map((k) => `<button class="chip" data-action="pick-team" data-team="${k}" aria-pressed="${s.team === k}">${esc(g[k].abbr)}</button>`).join('')}</div>
      <div class="options">${opt('over', `${g[s.team].abbr} over`, '')}${opt('under', `${g[s.team].abbr} under`, '')}</div>`;
  }
  // Player props
  const stats = Object.entries(STATS).filter(([, v]) => v.sports.includes(g.sport));
  const td = STATS[s.stat] && STATS[s.stat].kind === 'td';
  const names = s.roster.map((p) => `<option value="${esc(p.name)}">${esc(`${p.team || ''} ${p.pos || ''}`.trim())}</option>`).join('');
  return `<label class="field">Player<input class="input" list="roster" data-bind="sheet.player" value="${esc(s.player)}" placeholder="${s.roster.length ? 'Start typing a name' : 'Player name'}" autocomplete="off"></label>
    <datalist id="roster">${names}</datalist>
    <label class="field">Stat<select class="input" data-bind="sheet.stat">${stats.map(([k, v]) => `<option value="${k}" ${s.stat === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
    <div class="options">${td ? `${opt('yes', 'Scores a touchdown', '')}${opt('no', 'No touchdown', '')}` : `${opt('over', 'Over', '')}${opt('under', 'Under', '')}`}</div>`;
}

function sheetPick(s) {
  const g = s.game;
  const sp = SPORTS[g.sport];
  const fight = sp.kind === 'fight';
  const segs = fight ? [] : sp.key === 'ncaab' ? ['game', '1h'] : ['game', '1h', '1q'];
  const markets = fight ? ['moneyline'] : ['spread', 'moneyline', 'total', 'team_total', 'prop'];
  const needLine = s.market !== 'moneyline' && !(s.market === 'prop' && STATS[s.stat] && STATS[s.stat].kind === 'td');
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(g.away.abbr)} at ${esc(g.home.abbr)}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p class="sub">${esc(g.state === 'pre' ? kickoff(g.start) : gameClock(g).main)}${g.odds && g.odds.provider ? `. Lines from ${esc(g.odds.provider)}, edit them to match your book.` : ''}</p>
    ${segs.length ? `<div class="chips" role="group" aria-label="Part of the game">${segs.map((k) => `<button class="chip" data-action="segment" data-seg="${k}" aria-pressed="${s.segment === k}">${esc(k === 'game' ? 'Full game' : SEGMENTS[k])}</button>`).join('')}</div>` : ''}
    ${markets.length > 1 ? `<div class="seg" role="group" aria-label="Market">${markets.map((m) => `<button data-action="market" data-market="${m}" aria-pressed="${s.market === m}">${MARKET_NAMES[m]}</button>`).join('')}</div>` : ''}
    ${marketOptions(s)}
    <div class="fields">
      ${needLine ? (s.market === 'spread' ? numField('Line', 'sheet.line', s.line, '-3.5', 'decimal') : `<label class="field">Line<input class="input" inputmode="decimal" data-bind="sheet.line" value="${esc(s.line)}" placeholder="47.5" autocomplete="off"></label>`) : ''}
      ${numField('Odds', 'sheet.odds', s.odds, '-110', 'numeric')}
    </div>
    ${s.error ? `<p class="neg">${esc(s.error)}</p>` : ''}
    <button class="btn primary" style="width:100%" data-action="add-leg">Add to slip</button>`;
}

function chooseOption(choice) {
  const s = state.sheet;
  const g = s.game;
  const o = (s.segment === 'game' && g.odds) || {};
  s.choice = choice;
  s.error = '';
  // Only real prices from the feed are filled in; anything else is typed from the book.
  const price = (v) => (v != null && Number.isFinite(Number(v)) ? String(v) : '');
  if (s.market === 'spread' && Number.isFinite(o.spreadHome)) s.line = String(choice === 'home' ? o.spreadHome : -o.spreadHome);
  if (s.market === 'spread') s.odds = price(choice === 'home' ? o.homeSpreadOdds : o.awaySpreadOdds);
  if (s.market === 'moneyline') s.odds = price(choice === 'home' ? o.homeML : o.awayML);
  if (s.market === 'total') {
    if (Number.isFinite(o.total)) s.line = String(o.total);
    s.odds = price(choice === 'over' ? o.overOdds : o.underOdds);
  }
}

function addLeg() {
  const s = state.sheet;
  const g = s.game;
  if (!s.choice) {
    s.error = 'Pick a side first.';
    return renderLayer();
  }
  const line = num(s.line);
  const td = s.market === 'prop' && STATS[s.stat] && STATS[s.stat].kind === 'td';
  if (s.market !== 'moneyline' && !td && !Number.isFinite(line)) {
    s.error = 'Enter the line from your book.';
    return renderLayer();
  }
  if (s.market === 'prop' && !s.player.trim()) {
    s.error = 'Enter the player.';
    return renderLayer();
  }
  const o = num(s.odds);
  if (s.odds !== '' && !Number.isFinite(americanToDecimal(o))) {
    s.error = 'Odds look off. Use American odds like -110 or +150.';
    return renderLayer();
  }
  const leg = {
    id: db.newId('l'),
    sport: g.sport,
    eventId: g.id,
    date: espnDate(new Date(g.start || Date.now())),
    start: g.start,
    matchup: { home: { abbr: g.home.abbr, name: g.home.name, color: g.home.color }, away: { abbr: g.away.abbr, name: g.away.name, color: g.away.color } },
    market: s.market,
    segment: s.segment,
    side: s.market === 'spread' || s.market === 'moneyline' ? s.choice : s.choice,
    odds: Number.isFinite(o) ? o : null,
  };
  if (s.market === 'team_total') leg.team = s.team;
  if (s.market !== 'moneyline' && !td) leg.line = line;
  if (s.market === 'prop') {
    leg.stat = s.stat;
    leg.playerName = s.player.trim();
    const hit = s.roster.find((p) => p.name.toLowerCase() === leg.playerName.toLowerCase());
    if (hit) leg.playerId = hit.id;
  }
  state.slip.legs.push(leg);
  state.sheet = null;
  toast(`Added ${legLabel(leg, g)}`);
  render();
}

async function loadRoster() {
  const s = state.sheet;
  if (!s || s.type !== 'pick' || s.roster.length || s.rosterLoading) return;
  s.rosterLoading = true;
  const g = s.game;
  try {
    const [h, a] = await Promise.all([feed.roster(g.sport, g.home.id).catch(() => []), feed.roster(g.sport, g.away.id).catch(() => [])]);
    if (state.sheet !== s) return;
    s.roster = [...a.map((p) => ({ ...p, team: g.away.abbr })), ...h.map((p) => ({ ...p, team: g.home.abbr }))];
    renderLayer();
  } catch {
    /* typing the name works without the list */
  }
}

// ------------------------------------------------------------ slip sheet

function slipDecimal() {
  const legs = state.slip.legs;
  if (!legs.length) return NaN;
  if (Number.isFinite(americanToDecimal(num(state.slip.odds)))) return americanToDecimal(num(state.slip.odds));
  if (legs.every((l) => Number.isFinite(americanToDecimal(l.odds)))) return legs.reduce((d, l) => d * americanToDecimal(l.odds), 1);
  return NaN;
}

function sheetSlip() {
  const sl = state.slip;
  const parlay = sl.legs.length > 1;
  const stakeDefault = parlay ? state.settings.parlayStake : state.settings.stake;
  const dec = slipDecimal();
  const stake = num(sl.stake === '' ? stakeDefault : sl.stake);
  const win = Number.isFinite(dec) && Number.isFinite(stake) ? stake * (dec - 1) : NaN;
  const fromLegs = sl.legs.every((l) => Number.isFinite(americanToDecimal(l.odds))) ? decimalToAmerican(sl.legs.reduce((d, l) => d * americanToDecimal(l.odds), 1)) : null;
  return `<div class="sheet-head"><h2 id="sheet-title">${parlay ? `${sl.legs.length}-leg parlay` : 'Your bet'}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <ul class="legs">${sl.legs.map((l, i) => `<li class="leg" data-s="pending"><span class="mark"></span><span class="lb">${esc(legLabel(l, gameFor(l)))}</span><span class="lp"><button class="btn small" data-action="drop-leg" data-i="${i}" aria-label="Remove ${esc(legLabel(l))}">Remove</button></span><span class="lt">${esc(`${l.matchup.away.abbr} at ${l.matchup.home.abbr}, ${kickoff(l.start)}${l.odds != null ? `, ${fmtOdds(l.odds)}` : ''}`)}</span></li>`).join('')}</ul>
    <div class="fields">
      <label class="field">Stake<input class="input" inputmode="decimal" data-bind="slip.stake" value="${esc(sl.stake)}" placeholder="${esc(stakeDefault)}"></label>
      ${numField(parlay ? 'Book price for the parlay' : 'Odds', 'slip.odds', sl.odds, parlay ? (fromLegs != null ? fmtOdds(fromLegs) : 'Required') : fmtOdds(sl.legs[0] && sl.legs[0].odds) || 'Required', 'numeric')}
    </div>
    <label class="field">Book<input class="input" list="books" data-bind="slip.book" value="${esc(sl.book)}" placeholder="Where you placed it" autocomplete="off"></label>
    <datalist id="books">${state.settings.books.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
    <label class="switch">Bonus bet (stake not returned)<input type="checkbox" data-bind="slip.bonus" ${sl.bonus ? 'checked' : ''}></label>
    <div class="outcome"><span>To win</span><span class="v" id="towin">${Number.isFinite(win) ? esc(money(win)) : 'Enter the price'}</span></div>
    ${sl.error ? `<p class="neg">${esc(sl.error)}</p>` : ''}
    <div class="row"><button class="btn primary grow" data-action="save-slip">Save bet</button><button class="btn" data-action="clear-slip">Clear</button></div>`;
}

async function saveSlip() {
  if (state.saving) return;
  const sl = state.slip;
  const parlay = sl.legs.length > 1;
  const stake = num(sl.stake === '' ? (parlay ? state.settings.parlayStake : state.settings.stake) : sl.stake);
  if (!(stake > 0)) {
    sl.error = 'Enter a stake.';
    return renderLayer();
  }
  let o = num(sl.odds);
  if (!parlay && !Number.isFinite(americanToDecimal(o))) o = num(sl.legs[0].odds);
  if (!parlay && !Number.isFinite(americanToDecimal(o))) {
    sl.error = 'Enter the odds from your book.';
    return renderLayer();
  }
  if (parlay && !Number.isFinite(americanToDecimal(o))) {
    const dec = slipDecimal();
    if (!Number.isFinite(dec)) {
      sl.error = 'Some legs have no price. Enter the book’s parlay price.';
      return renderLayer();
    }
    o = decimalToAmerican(dec);
  }
  if (!parlay && sl.legs[0].odds == null) sl.legs[0].odds = o;
  const now = new Date().toISOString();
  const bet = { id: db.newId('b'), createdAt: now, placedAt: now, book: sl.book.trim().slice(0, 40), stake, odds: o, bonus: !!sl.bonus, legs: sl.legs, status: 'open', profit: 0, track: [], v: ENGINE_VERSION };
  state.saving = true;
  try {
    await db.putBet(bet);
  } finally {
    state.saving = false;
  }
  state.bets.unshift(bet);
  state.slip = { legs: [], stake: '', odds: '', book: sl.book, bonus: false };
  state.sheet = null;
  evaluateAll(false);
  toast('Saved. It is on the Live tab.');
  go('live');
  tick(true);
}

// ------------------------------------------------------------ paste and photo

function viewReader() {
  const p = state.paste;
  const photo = state.add.mode === 'photo';
  const hasPass = !!state.settings.passcode;
  const passNote = hasPass ? '' : '<div class="card"><p>The slip reader uses the passcode you set in Netlify. Add it once in Settings.</p><button class="btn" data-action="tab" data-tab="settings">Open Settings</button></div>';
  const input = photo
    ? `<div class="card"><label class="btn" style="width:100%"><input type="file" accept="image/*" data-action="photo" class="sr">Choose a screenshot or take a photo</label>${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="Your bet slip">` : ''}</div>`
    : `<label class="field">Paste the slip text<textarea class="input" data-bind="paste.text" placeholder="Copy the bet from your book's bet history and paste it here">${esc(p.text)}</textarea></label>`;
  const ready = photo ? !!p.image : !!p.text.trim();
  const res = p.result ? previewHTML(p.result) : '';
  return `${passNote}${input}
    ${p.error ? `<p class="neg">${esc(p.error)}</p>` : ''}
    <button class="btn primary" data-action="read-slip" ${!ready || p.busy || !hasPass ? 'disabled' : ''}>${p.busy ? 'Reading...' : 'Read slip'}</button>
    ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ''}
    ${res}`;
}

function previewHTML(result, saveAction = 'save-read', list = 'paste') {
  if (!result.length) return '<p class="sub">No bets found on that slip.</p>';
  const ready = result.filter((b) => b.ok).length;
  const items = result.map((b, i) => {
    const legs = b.legs.map((l, j) => {
      if (l.ok) return `<div class="ok">${esc(legLabel(l.leg, l.game))}: ${esc(`${l.game.away.abbr} at ${l.game.home.abbr}, ${kickoff(l.game.start)}`)}</div>`;
      const opts = (l.candidates || []).map((g) => `<option value="${esc(g.id)}">${esc(`${g.away.name} at ${g.home.name}, ${kickoff(g.start)}`)}</option>`).join('');
      return `<div class="warn">${esc(l.reason)}</div>${opts ? `<label class="field">Pick the game<select class="input" data-action="resolve" data-list="${list}" data-b="${i}" data-l="${j}"><option value="">Choose</option>${opts}</select></label>` : ''}`;
    }).join('');
    const head = `${b.parsed.legs.length > 1 ? `${b.parsed.legs.length}-leg parlay` : 'Straight bet'}${b.parsed.stake ? `, ${money(b.parsed.stake)}` : ''}${b.odds != null ? ` at ${fmtOdds(b.odds)}` : ''}${b.parsed.book ? `, ${b.parsed.book}` : ''}${b.parsed.result && b.parsed.result !== 'open' ? `, already ${b.parsed.result.replace('_', ' ')}` : ''}`;
    return `<div class="pv"><h3>${esc(head)}</h3>${legs}${b.reason ? `<div class="warn">${esc(b.reason)}</div>` : ''}</div>`;
  }).join('');
  return `<div class="preview">${items}<button class="btn primary" data-action="${saveAction}" ${ready ? '' : 'disabled'}>Save ${ready} bet${ready === 1 ? '' : 's'}</button></div>`;
}

async function onPhoto(file) {
  if (!file) return;
  try {
    state.paste.image = await shrinkImage(file);
    state.paste.result = null;
    state.paste.error = '';
  } catch {
    state.paste.error = 'Could not open that image.';
  }
  renderMain();
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

async function readSlip() {
  const p = state.paste;
  p.busy = true;
  p.error = '';
  p.result = null;
  renderMain();
  try {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const out = await feed.readSlip({ text: state.add.mode === 'paste' ? p.text : '', image: state.add.mode === 'photo' ? p.image : '', passcode: state.settings.passcode, today: iso });
    p.notes = out.notes || '';
    p.result = await Promise.all((out.bets || []).map(resolveBet));
  } catch (e) {
    p.error = /passcode/i.test(e.message) ? 'The passcode did not match. Check it in Settings.' : `Could not read the slip: ${e.message}`;
  }
  p.busy = false;
  renderMain();
}

const boardCache = new Map();
async function boardFor(sport, date) {
  const k = `${sport}|${date}`;
  if (!boardCache.has(k)) boardCache.set(k, feed.scoreboard(sport, date).catch(() => []));
  return boardCache.get(k);
}

async function resolveBet(parsed) {
  const legs = await Promise.all((parsed.legs || []).map((l) => resolveLeg(l, parsed)));
  let oddsVal = Number.isFinite(americanToDecimal(num(parsed.odds))) ? num(parsed.odds) : null;
  if (oddsVal == null && parsed.stake > 0 && parsed.toWin > 0) oddsVal = decimalToAmerican(1 + parsed.toWin / parsed.stake);
  const priced = legs.length && legs.every((l) => l.ok && Number.isFinite(americanToDecimal(l.leg.odds)));
  if (oddsVal == null && priced) oddsVal = decimalToAmerican(legs.reduce((d, l) => d * americanToDecimal(l.leg.odds), 1));
  const legsOk = legs.length > 0 && legs.every((l) => l.ok);
  const reason = legsOk && oddsVal == null ? 'No price on the slip. Add this one with Build instead.' : '';
  return { parsed, legs, odds: oddsVal, ok: legsOk && oddsVal != null, reason };
}

function splitMatchup(text) {
  const m = String(text || '').split(/\s+(?:@|at|vs\.?|v)\s+/i);
  return m.length === 2 ? [m[0], m[1]] : [text, ''];
}

async function resolveLeg(l, parsed) {
  const sport = SPORTS[l.sport] ? l.sport : null;
  if (!sport) return { ok: false, reason: 'Sport not covered by Sweat', candidates: [] };
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.replace(/-/g, '') : null);
  const start = ymd(l.date) || ymd(parsed.placed) || espnDate();
  const [m1, m2] = splitMatchup(l.matchup);
  const a = l.team || m1 || '';
  const b = l.opponent || (l.team ? (teamScore(l.team, { name: m1, abbr: '', short: '', location: '' }) >= 0.7 ? m2 : m1) : m2) || '';
  if (!a) return { ok: false, reason: 'No team or matchup on this leg', candidates: await boardFor(sport, start), raw: l };
  // An open bet is on a game still to come or in progress; a settled one may be over.
  const open = !parsed.result || parsed.result === 'open';
  let candidates = [];
  let fallback = null;
  for (let i = 0; i < 8; i++) {
    const games = await boardFor(sport, shiftDate(start, i));
    if (i === 0) candidates = games;
    const hit = findGame(games, a, b);
    if (!hit) continue;
    if (!open || hit.game.state !== 'post') return buildLeg(l, hit.game, hit.aSide);
    if (!fallback) fallback = hit;
  }
  if (fallback) return buildLeg(l, fallback.game, fallback.aSide);
  return { ok: false, reason: `Could not find ${l.team || l.matchup || 'that game'} in the next week`, candidates, raw: l };
}

function buildLeg(l, g, aSide) {
  const leg = {
    id: db.newId('l'),
    sport: g.sport,
    eventId: g.id,
    date: espnDate(new Date(g.start || Date.now())),
    start: g.start,
    matchup: { home: { abbr: g.home.abbr, name: g.home.name, color: g.home.color }, away: { abbr: g.away.abbr, name: g.away.name, color: g.away.color } },
    market: l.market,
    segment: l.segment || 'game',
    odds: Number.isFinite(num(l.odds)) ? num(l.odds) : null,
  };
  if (l.market === 'spread' || l.market === 'moneyline') leg.side = aSide || 'home';
  if (l.market === 'team_total') {
    leg.team = aSide || 'home';
    leg.side = l.side === 'under' ? 'under' : 'over';
  }
  if (l.market === 'total') leg.side = l.side === 'under' ? 'under' : 'over';
  if (l.market === 'prop') {
    if (!STATS[l.stat] || !STATS[l.stat].sports.includes(g.sport)) return { ok: false, reason: 'Could not tell which stat this prop is on. Add it with Build.', candidates: [], raw: l };
    if (!String(l.player || '').trim()) return { ok: false, reason: 'No player name on this prop', candidates: [], raw: l };
    leg.stat = l.stat;
    leg.playerName = String(l.player).trim().slice(0, 60);
    leg.side = STATS[leg.stat].kind === 'td' ? (l.side === 'no' ? 'no' : 'yes') : l.side === 'under' ? 'under' : 'over';
  }
  if (l.market !== 'moneyline' && !(l.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td')) {
    if (!Number.isFinite(num(l.line))) return { ok: false, reason: 'No line found for this leg', candidates: [], raw: l };
    leg.line = num(l.line);
  }
  state.games.set(`${g.sport}:${g.id}`, mergeKeep(state.games.get(`${g.sport}:${g.id}`), g));
  return { ok: true, leg, game: g };
}

async function resolvePick(bi, li, gameId, list = 'paste') {
  const r = (list === 'import' ? state.imp : state.paste).result[bi];
  const l = r.legs[li];
  const g = (l.candidates || []).find((x) => x.id === gameId);
  if (!g) return;
  const raw = l.raw || {};
  const side = raw.team ? (teamScore(raw.team, g.home) >= teamScore(raw.team, g.away) ? 'home' : 'away') : 'home';
  r.legs[li] = buildLeg(raw, g, side);
  r.ok = r.legs.every((x) => x.ok);
  renderMain();
}

async function saveRead(list = 'paste') {
  if (state.saving) return;
  state.saving = true;
  const now = new Date().toISOString();
  const add = [];
  const src = list === 'import' ? state.imp : state.paste;
  for (const r of src.result || []) {
    if (!r.ok) continue;
    const p = r.parsed;
    const parlay = r.legs.length > 1;
    const placed = /^\d{4}-\d{2}-\d{2}$/.test(p.placed || '') ? new Date(`${p.placed}T12:00:00`) : null;
    const bet = {
      id: db.newId('b'), createdAt: now, placedAt: placed && Number.isFinite(placed.getTime()) ? placed.toISOString() : now, book: String(p.book || '').slice(0, 40),
      stake: Number(p.stake) > 0 ? Number(p.stake) : (parlay ? state.settings.parlayStake : state.settings.stake),
      odds: r.odds, bonus: !!p.bonus, legs: r.legs.map((x) => x.leg), status: 'open', profit: 0, track: [], v: ENGINE_VERSION, source: list === 'import' ? 'the-number' : state.add.mode,
    };
    if (['won', 'lost', 'push', 'void', 'cashed_out'].includes(p.result)) {
      bet.manual = p.result === 'cashed_out' ? 'cashed' : p.result;
      bet.status = bet.manual;
      bet.settledAt = now;
      if (bet.manual === 'cashed' && Number.isFinite(Number(p.payout))) bet.payout = Number(p.payout);
      bet.profit = manualProfit(bet, bet.manual);
    }
    add.push(bet);
  }
  try {
    await db.putBets(add);
  } finally {
    state.saving = false;
  }
  for (const b of add) state.bets.unshift(b);
  if (list === 'import') state.imp = { text: '', busy: false, error: '', result: null };
  else state.paste = { text: '', image: '', busy: false, error: '', result: null, notes: '' };
  evaluateAll(false);
  toast(`Saved ${add.length} bet${add.length === 1 ? '' : 's'}.`);
  go('live');
  tick(true);
}

// ------------------------------------------------------------ detail, hedge, settle, edit

function sheetDetail(s) {
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return '';
  const live = b.live || {};
  const settled = isSettled(b);
  const legs = `<ul class="legs">${b.legs.map((l, i) => legRowHTML(l, (live.evals || [])[i])).join('')}</ul>`;
  const hi = b.peak != null ? `${Math.round(b.peak * 100)}%` : 'none yet';
  const lo = b.low != null ? `${Math.round(b.low * 100)}%` : 'none yet';
  const placed = new Date(b.placedAt || b.createdAt);
  const c = b.status === 'won' ? 'var(--cover)' : b.status === 'lost' ? 'var(--trouble)' : 'var(--chalk)';
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(betTitle(b, gameFor))}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <div style="--c:${c}">${bigline(b.track)}</div>
    <p class="sub">${esc(`Placed ${dayLabel(placed)} at ${clockTime(placed)}${b.book ? ` with ${b.book}` : ''}. ${money(b.stake)} at ${fmtOdds(b.odds)} to win ${money(toWin(b))}.`)}</p>
    <p class="sub">${esc(`High ${hi}, low ${lo}.${settled ? ` ${stampText(b)}.` : Number.isFinite(live.win) ? ` Cashes ${pct(live.win)}% of the time from here, expected ${money(expected(b), { sign: true })}.` : ''}`)}</p>
    ${legs}
    <div class="row">
      ${!settled ? `<button class="btn" data-action="hedge" data-id="${esc(b.id)}">Hedge</button>` : ''}
      <button class="btn" data-action="settle" data-id="${esc(b.id)}">${settled ? 'Change result' : 'Settle by hand'}</button>
      <button class="btn" data-action="edit" data-id="${esc(b.id)}">Edit</button>
      <button class="btn danger" data-action="delete" data-id="${esc(b.id)}">Delete</button>
    </div>`;
}

// The leg the hedge works on: the only leg, or the last unsettled leg of a parlay.
function hedgeLeg(b) {
  const ev = (b.live && b.live.evals) || [];
  const open = b.legs.map((l, i) => [l, ev[i]]).filter(([, e]) => !e || !SETTLED.has(e.status));
  return open.length === 1 ? open[0][0] : null;
}

function otherSide(leg) {
  if (leg.market === 'spread' || leg.market === 'moneyline') return leg.side === 'home' ? 'away' : 'home';
  if (leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td') return leg.side === 'no' ? 'yes' : 'no';
  return leg.side === 'over' ? 'under' : 'over';
}

function otherLabel(leg, line) {
  const flip = { ...leg, side: otherSide(leg) };
  if (leg.market === 'spread') flip.line = Number.isFinite(line) ? line : -leg.line;
  else if (Number.isFinite(line)) flip.line = line;
  return legLabel(flip, gameFor(leg));
}

// Decimal price the bet pays now: a parlay with a pushed leg pays the shorter price.
function betDecimalNow(b) {
  const evals = (b.live && b.live.evals) || [];
  if (b.legs.length > 1) {
    const anyPush = evals.some((e) => e.status === 'push' || e.status === 'void');
    if (!anyPush && Number.isFinite(americanToDecimal(b.odds))) return americanToDecimal(b.odds);
    return parlayDecimal(b.legs, evals, b.odds);
  }
  return americanToDecimal(b.odds);
}

// What the bet pays if it cashes, after any pushed parlay legs.
function toWin(b) {
  const d = betDecimalNow(b);
  return Number.isFinite(d) ? Math.round((Number(b.stake) || 0) * (d - 1) * 100) / 100 : NaN;
}

// Average result from here: cash times the payout, minus the stake when it loses (a bonus
// bet's stake was never yours).
function expected(b) {
  const r = b.live;
  if (!r || !Number.isFinite(r.win)) return NaN;
  return Math.round((r.win * toWin(b) - (r.lose || 0) * (b.bonus ? 0 : Number(b.stake) || 0)) * 100) / 100;
}

function hedgeCalc(s) {
  const b = state.bets.find((x) => x.id === s.id);
  const leg = b && hedgeLeg(b);
  if (!leg) return null;
  const stake = Number(b.stake) || 0;
  const win1 = stake * (betDecimalNow(b) - 1);
  const lossIfLose = b.bonus ? 0 : stake;
  const d2 = americanToDecimal(num(s.price));
  const live = b.live || {};
  const pWin = Number.isFinite(live.win) ? live.win : NaN;
  const pPush = live.push || 0;
  const lineNow = num(s.line);
  const hasLine = leg.market !== 'moneyline' && !(leg.market === 'prop' && STATS[leg.stat] && STATS[leg.stat].kind === 'td');
  const other = otherLabel(leg, hasLine ? lineNow : NaN);
  const out = { b, leg, stake, win1, lossIfLose, pWin, other, hasLine, ok: Number.isFinite(d2) && Number.isFinite(win1) };
  if (!out.ok) return out;
  // Stake on the other side that pays the same either way.
  const lock = (win1 + lossIfLose) / d2;
  const amt = s.amount === '' || s.amount == null ? lock : Math.max(0, Math.min(num(s.amount), lock * 2));
  let mid = null;
  if (hasLine && Number.isFinite(lineNow)) {
    const w = middleWindow(leg, lineNow);
    if (w) {
      const g = gameFor(leg);
      const pm = g ? chanceInWindow(leg, g, state.players.get(String(leg.eventId)) || {}, w.lo, w.hi) : NaN;
      mid = { w, p: pm, both: win1 + amt * (d2 - 1) };
    }
  }
  const pm = mid && Number.isFinite(mid.p) ? mid.p : 0;
  const win = Number.isFinite(pWin) ? Math.max(0, pWin - pm) : NaN;
  const lose = Number.isFinite(pWin) ? Math.max(0, 1 - pWin - pPush) : NaN;
  const ifFirst = win1 - amt;
  const ifHedge = amt * (d2 - 1) - lossIfLose;
  const ev = Number.isFinite(win) ? win * ifFirst + lose * ifHedge + (mid ? pm * mid.both : 0) : NaN;
  const hold = Number.isFinite(pWin) ? pWin * win1 - lose * lossIfLose : NaN;
  const locked = win1 - lock;
  const worst = Math.min(ifFirst, ifHedge);
  const cash = num(s.cash);
  const verdict = cashOutVerdict(locked, cash, stake, b.bonus);
  return { ...out, d2, lock, amt, mid, win, lose, ifFirst, ifHedge, ev, hold, locked, worst, cash, verdict, math: !!s.math };
}

function hedgeOutHTML(c) {
  if (!c || !c.ok) return '<p class="note">Enter the price on the other side to see the lock and both outcomes.</p>';
  const row = (label, v, p) => `<div class="outcome"><span>${esc(label)}${Number.isFinite(p) ? `<br><span class="note">about ${pct(p)}% from here</span>` : ''}</span><span class="v ${v >= 0 ? 'pos' : 'neg'}">${esc(money(v, { sign: true }))}</span></div>`;
  const locked = c.win1 - c.lock;
  return `<p class="note">${esc(`Full lock is ${money(c.lock)} on ${c.other}. ${locked >= 0 ? `That locks in ${money(locked, { sign: true })}` : `That caps the loss at ${money(-locked)}`} whichever side wins.`)}</p>
    <div class="outcome"><span>Worst case at ${esc(money(c.amt))} hedged</span><span class="v ${c.worst >= 0 ? 'pos' : 'neg'}">${esc(money(c.worst, { sign: true }))}</span></div>
    ${row(`If ${c.mid ? 'only ' : ''}${legLabel(c.leg, gameFor(c.leg))} hits`, c.ifFirst, c.win)}
    ${row(`If ${c.mid ? 'only ' : ''}${c.other} hits`, c.ifHedge, c.lose)}
    ${c.mid ? row(`If it lands ${c.mid.w.lo === c.mid.w.hi ? `on ${c.mid.w.lo}` : `${c.mid.w.lo} to ${c.mid.w.hi}`} (both win)`, c.mid.both, c.mid.p) : ''}
    ${Number.isFinite(c.hold) && Number.isFinite(c.ev) ? `<p class="note">${esc(`Holding is worth ${money(c.hold, { sign: true })} on average. This hedge is worth ${money(c.ev, { sign: true })} on average, ${c.ev >= c.hold ? 'more' : 'less'} than holding by ${money(Math.abs(c.ev - c.hold))}. Hedging trades average value for certainty.`)}</p>` : ''}
    ${c.verdict ? `<p class="verdict ${c.verdict.better === 'cash' ? 'neg' : 'pos'}">${esc(c.verdict.better === 'hedge' ? `Hedge beats cash out by ${money(c.verdict.diff)}.` : c.verdict.better === 'cash' ? `Cash out is better by ${money(-c.verdict.diff)}.` : 'Hedge and cash out are the same.')}</p><p class="note">${esc(`Full hedge locks ${money(c.locked, { sign: true })}. Cash out gives ${money(c.verdict.cashProfit, { sign: true })}.`)}</p>` : ''}
    <button type="button" class="btn" data-action="hedge-math" aria-expanded="${c.math}">${c.math ? 'Hide the math' : 'Show the math'}</button>
    ${c.math ? hedgeMathHTML(c) : ''}`;
}

function hedgeMathHTML(c) {
  const m = (v) => money(v, { sign: true });
  const lines = [
    `Payout if it cashes: ${money(c.stake)} x (price ${fmtNum(betDecimalNow(c.b))} - 1) = ${m(c.win1)} profit.`,
    `At risk if it loses: ${money(c.lossIfLose)}${c.b.bonus ? ' (bonus bet, the stake was never yours)' : ''}.`,
    `Other side pays ${fmtNum(c.d2)} per $1 (decimal price).`,
    `Full lock stake = (${money(c.win1)} + ${money(c.lossIfLose)}) / ${fmtNum(c.d2)} = ${money(c.lock)}.`,
    `If your bet hits: ${money(c.win1)} - ${money(c.amt)} = ${m(c.ifFirst)}.`,
    `If the other side hits: ${money(c.amt)} x (${fmtNum(c.d2)} - 1) - ${money(c.lossIfLose)} = ${m(c.ifHedge)}.`,
    `Worst case is the smaller of the two: ${m(c.worst)}.`,
  ];
  if (c.verdict) lines.push(`Cash out profit = ${money(c.cash)} - ${money(c.b.bonus ? 0 : c.stake)} = ${m(c.verdict.cashProfit)}. Compared with the full lock of ${m(c.locked)}, the difference is ${m(c.verdict.diff)}.`);
  return `<ul class="math">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

// Update the numbers in place so the slider can be dragged and the keyboard stays up.
function renderHedgeOut() {
  const s = state.sheet;
  if (!s || s.type !== 'hedge') return;
  const c = hedgeCalc(s);
  const out = document.getElementById('hedge-out');
  if (out) out.innerHTML = hedgeOutHTML(c);
  const range = document.getElementById('hedge-amt');
  const label = document.getElementById('hedge-amt-label');
  if (range) {
    range.disabled = !(c && c.ok);
    if (c && c.ok) {
      range.max = String(Math.max(1, Math.ceil(c.lock * 2)));
      if (s.amount === '' || s.amount == null) range.value = String(Math.round(c.lock));
      range.setAttribute('aria-valuetext', money(c.amt));
    }
  }
  if (label) label.textContent = c && c.ok ? `Hedge amount: ${money(c.amt)}` : 'Hedge amount';
}

function sheetHedge(s) {
  const c = hedgeCalc(s);
  const head = `<div class="sheet-head"><h2 id="sheet-title">Hedge</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>`;
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return head;
  if (!c) return `${head}<p>Hedging works on a straight bet, or on a parlay with one leg left. This one has more than one leg still open.</p>`;
  const pass = state.settings.passcode;
  return `${head}
    <p class="sub">${esc(`${legLabel(c.leg, gameFor(c.leg))}. ${money(c.stake)} to win ${money(c.win1)} (pays ${money(c.stake + c.win1)} back).${Number.isFinite(c.pWin) ? ` Cashes ${pct(c.pWin)}% of the time from here.` : ''}`)}</p>
    <div class="fields">
      ${c.hasLine ? numField('Other side line now', 'sheet.line', s.line, c.leg.market === 'spread' ? fmtLine(-c.leg.line) : fmtNum(c.leg.line), 'decimal') : ''}
      ${numField('Other side price now', 'sheet.price', s.price, '+150', 'numeric')}
    </div>
    ${pass && state.caps.odds ? `<button class="btn" data-action="live-prices" ${s.loading ? 'disabled' : ''}>${s.loading ? 'Getting prices...' : 'Get live prices'}</button>` : ''}
    ${s.priceNote ? `<p class="note">${esc(s.priceNote)}</p>` : ''}
    <label class="field"><span id="hedge-amt-label">${c.ok ? esc(`Hedge amount: ${money(c.amt)}`) : 'Hedge amount'}</span><input id="hedge-amt" type="range" min="0" max="${c.ok ? Math.max(1, Math.ceil(c.lock * 2)) : 1}" step="1" value="${c.ok ? Math.round(c.amt) : 0}" data-bind="sheet.amount" ${c.ok ? '' : 'disabled'}></label>
    <label class="field">Book cash out offer now (optional)<input class="input" inputmode="decimal" data-bind="sheet.cash" value="${esc(s.cash || '')}" placeholder="${esc(money(c.stake))}" autocomplete="off"></label>
    <div id="hedge-out">${hedgeOutHTML(c)}</div>`;
}

// A number box with a plus or minus switch: phone number pads often have no minus key.
function numField(label, bind, value, placeholder, mode) {
  return `<label class="field">${esc(label)}<span class="pm"><input class="input" inputmode="${mode}" data-bind="${bind}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"><button type="button" class="sign" data-action="flip" data-target="${bind}" aria-label="Switch ${esc(label.toLowerCase())} between plus and minus">&#177;</button></span></label>`;
}

async function fetchLivePrices() {
  const s = state.sheet;
  const b = state.bets.find((x) => x.id === s.id);
  const leg = b && hedgeLeg(b);
  const g = leg && gameFor(leg);
  if (!g) return;
  s.loading = true;
  renderLayer();
  try {
    const r = await feed.liveOdds(leg.sport, g, state.settings.passcode);
    const want = otherSide(leg);
    let best = null;
    for (const bk of r.books || []) {
      const m = bk.markets || {};
      let q = null;
      if (leg.market === 'moneyline' && m.moneyline) q = { price: m.moneyline[want] };
      if (leg.market === 'spread' && m.spread && m.spread[want]) q = m.spread[want];
      if (leg.market === 'total' && m.total && m.total[want]) q = m.total[want];
      if (q && Number.isFinite(q.price) && (!best || americanToDecimal(q.price) > americanToDecimal(best.price))) best = { ...q, book: bk.book };
    }
    if (best) {
      s.amount = '';
      s.price = String(best.price);
      if (best.line != null) s.line = String(best.line);
      s.priceNote = `Best price: ${best.book}${best.line != null ? `, ${fmtNum(best.line)}` : ''} at ${fmtOdds(best.price)}. ${r.remaining != null ? `${r.remaining} price checks left this month.` : ''}`;
    } else s.priceNote = 'No book has that market right now.';
  } catch (e) {
    s.priceNote = `Could not get prices: ${e.message}`;
  }
  s.loading = false;
  renderLayer();
}

// Profit for a result, from the bet as it stands (stake, price, which legs pushed, cash out).
function manualProfit(b, result, payoutAmt = b.payout) {
  const stake = Number(b.stake) || 0;
  if (result === 'won') return settleBet(b, 'won', (b.legResults || []).map((st) => ({ status: st })));
  if (result === 'lost') return b.bonus ? 0 : -stake;
  if (result === 'cashed') return Number.isFinite(Number(payoutAmt)) ? Math.round((Number(payoutAmt) - (b.bonus ? 0 : stake)) * 100) / 100 : 0;
  return 0;
}

function sheetSettle(s) {
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return '';
  const opts = [['won', 'Won'], ['lost', 'Lost'], ['push', 'Push'], ['void', 'Void']];
  return `<div class="sheet-head"><h2 id="sheet-title">Settle by hand</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p class="sub">${esc(betTitle(b, gameFor))}. Use this when the feed cannot grade it, or the book graded it differently.</p>
    <div class="options">${opts.map(([k, l]) => `<button class="opt" data-action="settle-as" data-result="${k}"><span class="a">${l}</span><span class="b">${esc(k === 'won' ? money(manualProfit(b, 'won'), { sign: true }) : k === 'lost' ? money(manualProfit(b, 'lost'), { sign: true }) : 'Stake back')}</span></button>`).join('')}</div>
    <div class="fields"><label class="field">Cashed out for<input class="input" inputmode="decimal" data-bind="sheet.payout" value="${esc(s.payout || '')}" placeholder="Amount paid back"></label></div>
    <button class="btn" data-action="settle-as" data-result="cashed">Save cash out</button>
    ${isSettled(b) ? '<button class="btn" data-action="settle-as" data-result="reopen">Let the feed grade it again</button>' : ''}`;
}

async function settleAs(result) {
  const s = state.sheet;
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return;
  if (result === 'reopen') {
    b.manual = null;
    b.auto = false;
    b.status = 'open';
    b.profit = 0;
    b.payout = null;
    b.settledAt = null;
    b.finalSeenAt = null;
    b.live = null;
  } else {
    if (result === 'cashed' && !Number.isFinite(num(s.payout))) {
      toast('Enter the cash out amount.');
      return;
    }
    b.manual = result;
    b.auto = false;
    b.status = result;
    b.payout = result === 'cashed' ? num(s.payout) : null;
    b.profit = manualProfit(b, result);
    b.settledAt = new Date().toISOString();
    b.live = null;
    state.fresh.add(b.id);
  }
  await db.putBet(b);
  state.sheet = null;
  evaluateAll(false);
  render();
}

function sheetEdit(s) {
  const b = state.bets.find((x) => x.id === s.id);
  if (!b) return '';
  const f = s.form;
  const legRows = b.legs.map((l, i) => {
    const line = l.line != null ? (l.market === 'spread' ? numField(`${legLabel(l, gameFor(l))}: line`, `sheet.form.lines.${i}`, f.lines[i], '', 'decimal') : `<label class="field">${esc(`${legLabel(l, gameFor(l))}: line`)}<input class="input" inputmode="decimal" data-bind="sheet.form.lines.${i}" value="${esc(f.lines[i])}" autocomplete="off"></label>`) : '';
    const price = b.legs.length > 1 ? numField(`${legLabel(l, gameFor(l))}: odds`, `sheet.form.legOdds.${i}`, f.legOdds[i], 'Not entered', 'numeric') : '';
    return line || price ? `<div class="fields">${line}${price}</div>` : '';
  }).join('');
  return `<div class="sheet-head"><h2 id="sheet-title">Edit bet</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <div class="fields">
      <label class="field">Stake<input class="input" inputmode="decimal" data-bind="sheet.form.stake" value="${esc(f.stake)}" autocomplete="off"></label>
      ${numField(b.legs.length > 1 ? 'Parlay price' : 'Odds', 'sheet.form.odds', f.odds, '', 'numeric')}
    </div>
    <label class="field">Book<input class="input" list="books" data-bind="sheet.form.book" value="${esc(f.book)}" autocomplete="off"></label>
    <datalist id="books">${state.settings.books.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
    <label class="switch">Bonus bet<input type="checkbox" data-bind="sheet.form.bonus" ${f.bonus ? 'checked' : ''}></label>
    ${b.status === 'cashed' ? `<label class="field">Cashed out for<input class="input" inputmode="decimal" data-bind="sheet.form.payout" value="${esc(f.payout)}" autocomplete="off"></label>` : ''}
    ${legRows}
    ${s.error ? `<p class="neg">${esc(s.error)}</p>` : ''}
    <button class="btn primary" data-action="save-edit">Save changes</button>`;
}

async function saveEdit() {
  const s = state.sheet;
  const b = state.bets.find((x) => x.id === s.id);
  const f = s.form;
  if (!b) return;
  if (!(num(f.stake) > 0) || !Number.isFinite(americanToDecimal(num(f.odds)))) {
    s.error = 'Check the stake and odds. Odds are American, like -110 or +150.';
    return renderLayer();
  }
  b.stake = num(f.stake);
  b.odds = num(f.odds);
  b.book = String(f.book || '').trim().slice(0, 40);
  b.bonus = !!f.bonus;
  b.legs.forEach((l, i) => {
    if (l.line != null && Number.isFinite(num(f.lines[i]))) l.line = num(f.lines[i]);
    if (b.legs.length > 1) l.odds = Number.isFinite(americanToDecimal(num(f.legOdds[i]))) ? num(f.legOdds[i]) : null;
    else l.odds = b.odds;
  });
  if (b.status === 'cashed' && Number.isFinite(num(f.payout))) b.payout = num(f.payout);
  // Money follows the edit for every settled bet; feed-graded bets are graded again.
  if (b.manual) b.profit = manualProfit(b, b.manual);
  else if (isSettled(b)) {
    b.status = 'open';
    b.settledAt = null;
    b.finalSeenAt = null;
    b.auto = false;
    b.live = null;
  }
  await db.putBet(b);
  state.sheet = null;
  evaluateAll(false);
  render();
  tick(true);
}

let lastSheet = null;
let opener = null;

function renderLayer() {
  const layer = $('#layer');
  const s = state.sheet;
  if (!s) {
    const wasOpen = !!lastSheet;
    layer.innerHTML = '';
    lastSheet = null;
    renderSlipBar();
    if (wasOpen) {
      const back = opener && opener.isConnected ? opener : $('#main');
      if (back) back.focus({ preventScroll: true });
    }
    opener = null;
    return;
  }
  const fresh = s !== lastSheet;
  if (fresh && !lastSheet) {
    const a = document.activeElement;
    opener = a && a !== document.body && !layer.contains(a) ? a : null;
  }
  const html = s.type === 'pick' ? sheetPick(s) : s.type === 'slip' ? sheetSlip() : s.type === 'detail' ? sheetDetail(s) : s.type === 'hedge' ? sheetHedge(s) : s.type === 'settle' ? sheetSettle(s) : s.type === 'edit' ? sheetEdit(s) : s.type === 'confirm' ? sheetConfirm(s) : '';
  const active = document.activeElement;
  const bind = !fresh && active && layer.contains(active) && active.dataset ? active.dataset.bind : null;
  const action = !fresh && active && layer.contains(active) && active.dataset ? active.dataset.action : null;
  const caret = bind && 'selectionStart' in active ? active.selectionStart : null;
  layer.innerHTML = `<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grip" aria-hidden="true"></div>${html}</div>`;
  if (bind) {
    const again = layer.querySelector(`[data-bind="${bind}"]`);
    if (again) {
      again.focus();
      try {
        if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret);
      } catch {
        /* some inputs do not support a caret */
      }
    }
  } else if (action && !fresh) {
    const again = layer.querySelector(`[data-action="${action}"]`);
    if (again) again.focus({ preventScroll: true });
  } else if (fresh) {
    const first = layer.querySelector('.sheet input:not([type="range"]), .sheet select, .sheet textarea') || layer.querySelector('.sheet button');
    if (first) first.focus({ preventScroll: true });
  }
  lastSheet = s;
  renderSlipBar();
}

function sheetConfirm(s) {
  return `<div class="sheet-head"><h2 id="sheet-title">${esc(s.title)}</h2><button class="icon-btn" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <p>${esc(s.text)}</p><div class="row"><button class="btn danger" data-action="confirm-yes">${esc(s.yes)}</button><button class="btn" data-action="close">Keep it</button></div>`;
}

function closeSheet() {
  state.sheet = null;
  renderLayer();
}

// ------------------------------------------------------------ history

function inRange(b) {
  const t = new Date(b.settledAt || b.placedAt || b.createdAt).getTime();
  const r = state.history.range;
  if (r === 'all') return true;
  if (r === 'season') {
    const now = new Date();
    const start = new Date(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1, 7, 1).getTime();
    return t >= start;
  }
  return t >= Date.now() - Number(r) * 86400000;
}

function viewHistory() {
  const h = state.history;
  const done = state.bets.filter((b) => isSettled(b) && inRange(b) && (h.sport === 'all' || b.legs.some((l) => l.sport === h.sport)));
  const ranges = [['7', '7 days'], ['30', '30 days'], ['season', 'This season'], ['all', 'All time']];
  const chips = `<div class="chips" role="group" aria-label="Time range">${ranges.map(([k, l]) => `<button class="chip" data-action="range" data-range="${k}" aria-pressed="${h.range === k}">${l}</button>`).join('')}</div>
    <div class="chips" role="group" aria-label="Sport">${[['all', 'All sports'], ...SPORT_KEYS.map((k) => [k, SPORTS[k].name])].map(([k, l]) => `<button class="chip" data-action="hsport" data-sport="${k}" aria-pressed="${h.sport === k}">${esc(l)}</button>`).join('')}</div>`;
  if (!done.length) return `<section class="view">${chips}<div class="card empty"><p class="big">No results yet</p><p class="sub">Settled bets land here with your record, profit, bad beats and miracles.</p></div></section>`;
  const sorted = [...done].sort((a, b) => (a.settledAt < b.settledAt ? -1 : 1));
  const profit = sorted.reduce((s, b) => s + (Number(b.profit) || 0), 0);
  const risked = sorted.reduce((s, b) => s + (b.bonus || b.status === 'void' ? 0 : Number(b.stake) || 0), 0);
  const w = sorted.filter((b) => b.status === 'won').length;
  const l = sorted.filter((b) => b.status === 'lost').length;
  const p = sorted.filter((b) => b.status === 'push' || b.status === 'void').length;
  let run = 0;
  const pts = [[0, 0], ...sorted.map((b, i) => [i + 1, (run += Number(b.profit) || 0)])];
  const bad = sorted.filter((b) => b.status === 'lost' && b.peak >= 0.85).sort((a, b) => b.peak - a.peak).slice(0, 8);
  const good = sorted.filter((b) => b.status === 'won' && b.low != null && b.low <= 0.15).sort((a, b) => a.low - b.low).slice(0, 8);
  const beat = (b, kind) => `<button class="beat ${kind}" data-action="detail" data-id="${esc(b.id)}" style="text-align:left"><div class="n">${kind === 'bad' ? Math.round(b.peak * 100) : Math.round(b.low * 100)}%</div><p><b>${esc(betTitle(b, gameFor))}</b></p><p class="sub">${esc(kind === 'bad' ? `Was ${Math.round(b.peak * 100)}% to cash, then lost ${money(-b.profit)}` : `Was down to ${Math.round(b.low * 100)}%, then cashed ${money(b.profit)}`)}</p></button>`;
  const byKey = new Map();
  for (const b of sorted) {
    const sp = b.legs.length > 1 ? 'Parlays' : SPORTS[b.legs[0].sport].name;
    const mk = b.legs.length > 1 ? '' : MARKET_NAMES[b.legs[0].market];
    const k = `${sp}${mk ? `, ${mk.toLowerCase()}` : ''}`;
    const r = byKey.get(k) || { n: 0, w: 0, l: 0, p: 0, profit: 0 };
    r.n += 1;
    r.profit += Number(b.profit) || 0;
    if (b.status === 'won') r.w += 1;
    else if (b.status === 'lost') r.l += 1;
    else r.p += 1;
    byKey.set(k, r);
  }
  const table = `<table class="break"><thead><tr><th>Kind</th><th class="r">Record</th><th class="r">Profit</th></tr></thead><tbody>${[...byKey.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, r]) => `<tr><td>${esc(k)}</td><td class="r">${r.w}-${r.l}${r.p ? `-${r.p}` : ''}</td><td class="r ${r.profit >= 0 ? 'pos' : 'neg'}">${esc(money(r.profit, { sign: true }))}</td></tr>`).join('')}</tbody></table>`;
  const byDay = new Map();
  for (const b of [...sorted].reverse()) {
    const d = dayLabel(b.settledAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(b);
  }
  const list = [...byDay.entries()].map(([d, bs]) => `<div class="day-label">${esc(d)}</div>${bs.map((b) => `<button class="hrow" data-action="detail" data-id="${esc(b.id)}"><span class="l">${esc(betTitle(b, gameFor))}</span><span class="m">${esc(`${money(b.stake)} at ${fmtOdds(b.odds)}${b.book ? `, ${b.book}` : ''}, ${stampText(b).toLowerCase()}`)}</span><span class="p ${b.profit > 0 ? 'pos' : b.profit < 0 ? 'neg' : ''}">${esc(money(b.profit, { sign: true }))}</span></button>`).join('')}`).join('');
  return `<section class="view">${chips}
    <div class="totals">
      <div class="hero"><div class="k">Profit</div><div class="v ${profit >= 0 ? 'pos' : 'neg'}">${esc(money(profit, { sign: true }))}</div></div>
      <div><div class="k">Record</div><div class="v">${w}-${l}${p ? `-${p}` : ''}</div></div>
      <div><div class="k">Return on stakes</div><div class="v">${risked > 0 ? `${((profit / risked) * 100).toFixed(1)}%` : 'None'}</div></div>
      <div><div class="k">Bets</div><div class="v">${sorted.length}</div></div>
      <div><div class="k">Staked</div><div class="v">${esc(money(risked, { whole: true }))}</div></div>
    </div>
    <div class="card">${profitChart(pts)}</div>
    ${bad.length ? `<div class="section-head"><h2>Bad beats</h2><span class="sub">Lost after 85% or better</span></div><div class="beats">${bad.map((b) => beat(b, 'bad')).join('')}</div>` : ''}
    ${good.length ? `<div class="section-head"><h2>Miracles</h2><span class="sub">Cashed from 15% or worse</span></div><div class="beats">${good.map((b) => beat(b, 'good')).join('')}</div>` : ''}
    <div class="card"><h3>By kind of bet</h3>${table}</div>
    <div class="hist">${list}</div>
  </section>`;
}

// ------------------------------------------------------------ settings

function viewSettings() {
  const s = state.settings;
  const field = (key, label, attrs = '') => `<label class="field">${label}<input class="input" data-setting="${key}" value="${esc(s[key])}" ${attrs}></label>`;
  const sw = (key, label) => `<label class="switch">${label}<input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  return `<section class="view">
    <div class="card"><h3>Stakes</h3><div class="fields">${field('stake', 'Straight bets', 'inputmode="decimal"')}${field('parlayStake', 'Parlays', 'inputmode="decimal"')}</div></div>
    <div class="card"><h3>Alerts</h3>
      ${sw('alerts', 'Tell me about big swings')}
      <label class="field">Swing size<select class="input" data-setting="swing">${[10, 15, 20, 25].map((v) => `<option value="${v}" ${Number(s.swing) === v ? 'selected' : ''}>${v} points</option>`).join('')}</select></label>
      ${sw('settleAlerts', 'Tell me when a bet settles')}
      ${sw('sound', 'Play a sound')}
      ${sw('keepAwake', 'Keep the screen on while games are live')}
      <p class="note">${perm === 'granted' ? 'Notifications are on for this device.' : perm === 'denied' ? 'Notifications are blocked in this browser. Turn them on in its site settings.' : perm === 'unsupported' ? 'This browser cannot show notifications. On iPhone, add Sweat to the Home Screen first.' : 'Alerts show inside the app. Allow notifications to get them when Sweat is in the background.'}</p>
      ${perm === 'default' ? '<button class="btn" data-action="notify-perm">Allow notifications</button>' : ''}
      <p class="note">Alerts come while Sweat is open, including in a background tab. A phone that is locked may pause them.</p>
    </div>
    <div class="card"><h3>Smart lights</h3>
      <p class="note">Sweat can call a web address when the mood of your open bets changes (covering, coin flip, trouble) and when a bet settles. Works with Home Assistant webhooks, IFTTT and similar.</p>
      ${field('lightsUrl', 'When the mood changes', 'type="url" placeholder="https://..." autocomplete="off"')}
      ${field('settleUrl', 'When a bet settles', 'type="url" placeholder="https://..." autocomplete="off"')}
      <button class="btn" data-action="test-lights">Send a test</button>
    </div>
    ${state.caps.slip || state.caps.odds ? `<div class="card"><h3>${state.caps.slip && state.caps.odds ? 'Slip reader and live prices' : state.caps.slip ? 'Slip reader' : 'Live prices'}</h3>
      <p class="note">${state.caps.slip && state.caps.odds ? 'Reading slips and checking live prices run' : state.caps.slip ? 'Reading slips runs' : 'Checking live prices runs'} on your Netlify site. Enter the passcode you set there. It stays on this device.</p>
      ${field('passcode', 'Passcode', 'type="password" autocomplete="off"')}
    </div>` : ''}
    <div class="card"><h3>Look</h3>
      <div class="seg" role="group" aria-label="Theme">${[['night', 'Night'], ['day', 'Day'], ['auto', 'Match phone']].map(([k, l]) => `<button data-action="theme" data-theme="${k}" aria-pressed="${s.theme === k}">${l}</button>`).join('')}</div>
    </div>
    <div class="card"><h3>Your data</h3>
      <p class="note">Bets live on this device only. Back them up before switching phones.</p>
      <div class="row">
        <button class="btn" data-action="export-json">Back up</button>
        <label class="btn">Restore<input type="file" accept="application/json,.json" data-action="import-json" class="sr"></label>
        <button class="btn" data-action="export-csv">Spreadsheet (CSV)</button>
        <button class="btn" data-action="export-warroom">War Room file</button>
      </div>
      <button class="btn danger" data-action="wipe">Delete every bet</button>
      ${db.isMemoryOnly() ? '<p class="neg">This browser is blocking storage, so bets will be lost when the page closes.</p>' : ''}
    </div>
    <div class="card"><h3>How the numbers work</h3>
      <p class="note">Each percentage is the chance your bet cashes from this moment, built from the book's line and the live game. Football plays out the remaining drives (touchdowns, field goals, the clock and who has the ball), so 3 and 7 land as often as they do in real games. Basketball models the rest of the game from the line, with real late-game habits: big leads shrink and close games get fouling. Props scale a player's pace by the minutes or game left. Fights hold the pregame price until there is a result.</p>
      <p class="note">Checked against real games: NFL 2023 to 2025, NBA and college basketball 2024 to 2026, college football 2017 to 2025. When Sweat says 80%, it happened close to 80% of the time.</p>
      <p class="note">Version ${APP_VERSION}, engine ${ENGINE_VERSION}. Scores from ESPN.</p>
    </div>
  </section>`;
}

async function saveSettings() {
  await db.setKV('settings', state.settings);
}

// ------------------------------------------------------------ exports

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportJson() {
  const data = { app: 'sweat', version: APP_VERSION, exportedAt: new Date().toISOString(), settings: { ...state.settings, passcode: '' }, bets: state.bets.map(stripLive) };
  download(`sweat-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function stripLive(b) {
  const { live, dirty, ...rest } = b;
  return rest;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const head = ['placed', 'settled', 'sports', 'bet', 'legs', 'book', 'stake', 'odds', 'bonus', 'result', 'profit', 'high', 'low'];
  const rows = state.bets.map((b) => [
    b.placedAt || b.createdAt, b.settledAt || '', [...new Set(b.legs.map((l) => SPORTS[l.sport].name))].join(' and '), betTitle(b, gameFor),
    b.legs.map((l) => legLabel(l, gameFor(l))).join('; '), b.book || '', b.stake, fmtOdds(b.odds), b.bonus ? 'yes' : 'no', b.status, b.profit || 0,
    b.peak != null ? Math.round(b.peak * 100) : '', b.low != null ? Math.round(b.low * 100) : '',
  ]);
  download(`sweat-bets-${stamp()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

// Bets in The War Room's vocabulary (sport, event, market, selection, price), for its bet import.
function exportWarRoom() {
  const period = { game: 'full_game', '1h': 'first_half', '1q': 'first_quarter' };
  const bets = state.bets.map((b) => ({
    bet_id: b.id,
    placed_at: b.placedAt || b.createdAt,
    settled_at: b.settledAt || null,
    sportsbook: b.book || null,
    stake: Number(b.stake),
    american_odds: Number.isFinite(num(b.odds)) ? Math.round(num(b.odds)) : null,
    bonus_bet: !!b.bonus,
    result: isSettled(b) ? b.status : 'open',
    profit: Number(b.profit) || 0,
    peak_prob: b.peak != null ? Math.round(b.peak * 1000) / 1000 : null,
    low_prob: b.low != null ? Math.round(b.low * 1000) / 1000 : null,
    legs: b.legs.map((l) => ({
      sport: l.sport,
      league: SPORTS[l.sport].name,
      event: {
        source_event_id: String(l.eventId),
        start_time: l.start ? new Date(l.start).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
        timezone: 'America/New_York',
        participants: [{ side: 'home', name: l.matchup.home.name }, { side: 'away', name: l.matchup.away.name }],
      },
      market: { type: l.market === 'prop' ? 'player_prop' : l.market, period: SPORTS[l.sport].kind === 'fight' ? 'full_event' : period[l.segment || 'game'], participant_scope: l.market === 'team_total' ? l.team : null },
      selection: { side: SPORTS[l.sport].kind === 'fight' ? (l.side === 'home' ? 'fighter_a' : 'fighter_b') : l.side, label: legLabel(l, gameFor(l)) },
      price: { line: l.line != null ? l.line : null, american_odds: l.odds != null ? Math.round(l.odds) : null },
      player: l.playerName || null,
      stat: l.stat || null,
    })),
  }));
  download(`sweat-war-room-${stamp()}.json`, JSON.stringify({ contract: 'sweat-ledger', contract_version: '1.0', source_app: 'sweat', generated_at: new Date().toISOString(), bets }, null, 2), 'application/json');
}

// A restored backup is untrusted: keep only well-formed bets with known sports and markets.
const SIDES = { spread: ['home', 'away'], moneyline: ['home', 'away'], total: ['over', 'under'], team_total: ['over', 'under'], prop: ['over', 'under', 'yes', 'no'] };
const str = (v, n = 60) => (typeof v === 'string' ? v.slice(0, n) : '');
const finite = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '');

function cleanLeg(l) {
  if (!l || !SPORTS[l.sport] || !SIDES[l.market] || !SIDES[l.market].includes(l.side)) return null;
  if (!/^\d{1,14}$/.test(String(l.eventId))) return null;
  if (l.market === 'prop' && (!STATS[l.stat] || !STATS[l.stat].sports.includes(l.sport) || !str(l.playerName))) return null;
  const line = finite(l.line);
  const needsLine = l.market !== 'moneyline' && !(l.market === 'prop' && STATS[l.stat].kind === 'td');
  if (needsLine && line == null) return null;
  const team = (t) => ({ abbr: str(t && t.abbr, 16), name: str(t && t.name, 60), color: color(t && t.color) });
  const start = iso(l.start);
  return {
    id: str(l.id, 60) || db.newId('l'), sport: l.sport, eventId: String(l.eventId), start,
    date: /^\d{8}$/.test(l.date || '') ? l.date : start ? espnDate(new Date(start)) : null,
    matchup: { home: team(l.matchup && l.matchup.home), away: team(l.matchup && l.matchup.away) },
    market: l.market, segment: SEGMENTS[l.segment] ? l.segment : 'game', side: l.side,
    ...(l.market === 'team_total' ? { team: l.team === 'away' ? 'away' : 'home' } : {}),
    ...(needsLine ? { line } : {}),
    odds: Number.isFinite(americanToDecimal(finite(l.odds))) ? finite(l.odds) : null,
    ...(l.market === 'prop' ? { stat: l.stat, playerName: str(l.playerName), playerId: str(l.playerId, 20) || undefined } : {}),
  };
}

function cleanBet(b) {
  if (!b || typeof b.id !== 'string' || !Array.isArray(b.legs) || !b.legs.length || b.legs.length > 25) return null;
  const legs = b.legs.map(cleanLeg);
  if (legs.some((l) => !l)) return null;
  const stake = finite(b.stake);
  if (!(stake > 0)) return null;
  const status = ['open', 'won', 'lost', 'push', 'void', 'cashed'].includes(b.status) ? b.status : 'open';
  const track = Array.isArray(b.track) ? b.track.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(-600) : [];
  return {
    id: b.id.slice(0, 80), createdAt: iso(b.createdAt) || new Date().toISOString(), placedAt: iso(b.placedAt) || iso(b.createdAt) || new Date().toISOString(),
    book: str(b.book, 40), stake, odds: Number.isFinite(americanToDecimal(finite(b.odds))) ? finite(b.odds) : null, bonus: b.bonus === true, legs,
    status, profit: status === 'open' ? 0 : finite(b.profit) || 0, settledAt: status === 'open' ? null : iso(b.settledAt) || new Date().toISOString(),
    manual: ['won', 'lost', 'push', 'void', 'cashed'].includes(b.manual) ? b.manual : null, auto: b.auto === true, payout: finite(b.payout),
    legResults: Array.isArray(b.legResults) ? b.legResults.map((x) => str(x, 10)) : undefined,
    track, peak: finite(b.peak), low: finite(b.low), v: ENGINE_VERSION,
  };
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'sweat' || !Array.isArray(data.bets)) throw new Error('not a Sweat backup');
    const ids = new Set(state.bets.map((b) => b.id));
    const cleaned = data.bets.map(cleanBet);
    const fresh = cleaned.filter((b) => b && !ids.has(b.id) && (b.odds != null || b.legs.length > 1));
    const skipped = data.bets.length - fresh.length;
    await db.putBets(fresh);
    state.bets = [...fresh, ...state.bets].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    evaluateAll(false);
    toast(`Restored ${fresh.length} bet${fresh.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already here or unreadable` : ''}.`);
    render();
    tick(true);
  } catch (e) {
    toast(`That file did not work: ${e.message}`);
  }
}

// ------------------------------------------------------------ live loop

let timer = null;
let lastWake = null;

function schedule() {
  clearTimeout(timer);
  const watched = state.bets.filter(watching);
  if (!watched.length) {
    timer = setTimeout(() => tick(), 5 * 60 * 1000);
    return;
  }
  const now = Date.now();
  let soonest = Infinity;
  let live = false;
  let settling = false;
  for (const b of watched) {
    if (isSettled(b)) settling = true;
    for (const l of b.legs) {
      const g = gameFor(l);
      if (g && g.state === 'in') live = true;
      if (g && g.state === 'post') continue;
      const t = new Date((g && g.start) || l.start || 0).getTime();
      if (Number.isFinite(t)) soonest = Math.min(soonest, t - now);
    }
  }
  let delay = live || soonest < 10 * 60 * 1000 ? 15000 : soonest < 2 * 3600 * 1000 ? 60000 : 5 * 60 * 1000;
  if (settling) delay = Math.min(delay, 60000);
  timer = setTimeout(() => tick(), document.hidden ? Math.max(delay, 30000) : delay);
}

async function tick(force = false) {
  if (state.feed.busy && !force) return;
  const watched = state.bets.filter(watching);
  if (!watched.length) {
    schedule();
    return;
  }
  state.feed.busy = true;
  try {
    const { boards, summaries } = feed.plan(watched);
    const jobs = [
      ...boards.map((x) => feed.scoreboard(x.sport, x.date).then((games) => ({ kind: 'board', games }))),
      ...summaries.map((x) => feed.summary(x.sport, x.eventId).then((r) => ({ kind: 'summary', ...r, eventId: x.eventId }))),
    ];
    const results = await Promise.allSettled(jobs);
    let ok = 0;
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      ok += 1;
      const v = r.value;
      if (v.kind === 'board') {
        for (const g of v.games) state.games.set(`${g.sport}:${g.id}`, mergeKeep(state.games.get(`${g.sport}:${g.id}`), g));
      } else if (v.game) {
        const k = `${v.game.sport}:${v.game.id}`;
        const prev = state.games.get(k);
        // The scoreboard knows the football situation; the summary may not.
        const merged = mergeKeep(prev, v.game);
        if (!v.game.situation && prev && prev.situation && prev.state === 'in' && prev.period === v.game.period) merged.situation = prev.situation;
        state.games.set(k, merged);
        state.players.set(String(v.eventId), v.players || {});
        state.statsFinal.set(String(v.eventId), v.game.state === 'post' && v.game.completed === true);
      }
    }
    state.feed.ok = ok > 0 || !jobs.length;
    if (state.feed.ok) state.feed.at = Date.now();
    state.feed.error = ok ? '' : 'feed down';
  } catch (e) {
    state.feed.ok = false;
    state.feed.error = String((e && e.message) || e);
  } finally {
    state.feed.busy = false;
  }
  try {
    evaluateAll(true);
    persistGames();
    if (state.tab === 'live' || state.tab === 'tv' || state.tab === 'history') renderMain();
    renderTop();
    if (state.sheet && state.sheet.type === 'detail' && !(document.activeElement && document.activeElement.matches('input, select, textarea'))) renderLayer();
    if (state.sheet && state.sheet.type === 'hedge') renderHedgeOut();
    keepAwake();
  } finally {
    schedule();
  }
}

let gameSave = null;
function persistGames() {
  clearTimeout(gameSave);
  gameSave = setTimeout(() => {
    const need = new Set(state.bets.filter((b) => !isSettled(b) || Date.now() - new Date(b.settledAt || 0).getTime() < 86400000).flatMap((b) => b.legs.map(gameKey)));
    db.setKV('games', [...state.games.entries()].filter(([k]) => need.has(k)).map(([, g]) => g)).catch(() => {});
  }, 1000);
}

const AUTO_RESULTS = new Set(['won', 'lost', 'push', 'void']);

// Bets the feed settled stay under watch for a while: a review, a late extra point or a stat
// correction can still change the result, and the bet is regraded if it does.
function watching(b) {
  if (!isSettled(b)) return true;
  if (!b.auto || b.manual) return false;
  const t = Date.parse(b.settledAt || '');
  if (!Number.isFinite(t) || Date.now() - t > 8 * 3600e3) return false;
  const allFinal = b.legs.every((l) => {
    const g = gameFor(l);
    return g && g.state === 'post';
  });
  if (!allFinal) return true;
  if (!b.finalSeenAt) {
    b.finalSeenAt = new Date().toISOString();
    b.dirty = true;
  }
  return Date.now() - Date.parse(b.finalSeenAt) < 20 * 60e3;
}

function legEvals(b) {
  return b.legs.map((l) => {
    const g = gameFor(l);
    if (!g) return { status: 'pending', win: NaN, push: 0, lose: NaN, text: 'Waiting for the game' };
    const id = String(l.eventId);
    const opts = l.market === 'prop' && state.statsFinal.has(id) ? { statsFinal: state.statsFinal.get(id) } : {};
    return evaluateLeg(l, g, state.players.get(id) || {}, opts);
  });
}

function payout(b, status, evals) {
  if (status === 'lost') return b.bonus ? 0 : -(Number(b.stake) || 0);
  if (status === 'won') return settleBet(b, 'won', evals);
  return 0;
}

function evaluateAll(alerts) {
  const changed = [];
  for (const b of state.bets) {
    if (isSettled(b) && !watching(b)) {
      if (!b.live || b.manual || b.live.status !== b.status) {
        const legs = b.legResults || b.legs.map(() => b.status);
        b.live = { status: b.status, win: b.status === 'won' ? 1 : 0, push: 0, lose: b.status === 'lost' ? 1 : 0, evals: legs.map((st) => ({ status: st })) };
      }
      continue;
    }
    const evals = legEvals(b);
    const res = evaluateBet(b, evals);
    if (isSettled(b)) {
      // Under watch: a different final result, or a different payout (a parlay leg that turned
      // into a push), changes the bet.
      const newProfit = AUTO_RESULTS.has(res.status) ? payout(b, res.status, evals) : NaN;
      if (AUTO_RESULTS.has(res.status) && (res.status !== b.status || Math.abs(newProfit - (Number(b.profit) || 0)) > 0.005)) {
        const was = stampText(b);
        b.status = res.status;
        b.profit = newProfit;
        b.legResults = evals.map((e) => e.status);
        b.regradedAt = new Date().toISOString();
        b.live = { ...res, evals };
        changed.push(b);
        if (alerts) {
          state.fresh.add(b.id);
          notify(`Regraded: ${betTitle(b, gameFor)} is now ${stampText(b).toLowerCase()}`, `Was ${was.toLowerCase()}. The score or stats changed after it settled.`, b.status === 'won' ? 'won' : 'lost');
        }
      }
      continue;
    }
    const before = b.live;
    b.live = { ...res, evals };
    if (track(b, res)) changed.push(b);
    if (AUTO_RESULTS.has(res.status)) {
      b.status = res.status;
      b.auto = true;
      b.profit = payout(b, res.status, evals);
      b.legResults = evals.map((e) => e.status);
      b.settledAt = new Date().toISOString();
      if (!changed.includes(b)) changed.push(b);
      if (alerts) {
        state.fresh.add(b.id);
        onSettle(b);
      }
    } else if (alerts && before && Number.isFinite(res.win)) {
      maybeSwing(b, res);
    }
  }
  for (const b of state.bets) {
    if (b.dirty) {
      delete b.dirty;
      if (!changed.includes(b)) changed.push(b);
    }
  }
  if (changed.length) db.putBets(changed.map(stripLive)).catch(() => {});
  if (alerts) lights();
}

// Keep a compact history of the cash chance for the sweat line, plus the high and the low.
function track(b, res) {
  if (!Number.isFinite(res.win)) return false;
  const anyLive = res.status === 'live' || (b.live.evals || []).some((e) => e.status === 'live');
  const t = Date.now();
  const tr = b.track || (b.track = []);
  const last = tr[tr.length - 1];
  let changed = false;
  if (!last || (anyLive && (t - last[0] > 20000 || Math.abs(res.win - last[1]) >= 0.02)) || (!anyLive && Math.abs(res.win - last[1]) >= 0.01 && t - last[0] > 60000)) {
    tr.push([t, Math.round(res.win * 1000) / 1000]);
    changed = true;
    if (tr.length > 600) b.track = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  if (anyLive) {
    if (b.peak == null || res.win > b.peak) {
      b.peak = Math.round(res.win * 1000) / 1000;
      changed = true;
    }
    if (b.low == null || res.win < b.low) {
      b.low = Math.round(res.win * 1000) / 1000;
      changed = true;
    }
  }
  return changed;
}

function maybeSwing(b, res) {
  if (!state.settings.alerts) return;
  if (b.alertP == null) {
    b.alertP = res.win;
    return;
  }
  const d = res.win - b.alertP;
  if (Math.abs(d) * 100 < Number(state.settings.swing || 15)) return;
  b.alertP = res.win;
  const title = betTitle(b, gameFor);
  const e = (b.live.evals || []).find((x) => x.status === 'live') || {};
  notify(`${title} ${d > 0 ? 'jumped' : 'dropped'} to ${pct(res.win)}%`, e.text || '', d > 0 ? 'up' : 'down');
}

function onSettle(b) {
  if (state.settings.settleAlerts) notify(`${betTitle(b, gameFor)}: ${stampText(b)}`, b.legs.length > 1 ? `${b.legs.length}-leg parlay` : ((b.live.evals || [])[0] || {}).text || '', b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'push');
  announce(`${betTitle(b, gameFor)} ${stampText(b)}`);
  hook(state.settings.settleUrl, { event: 'settled', result: b.status, profit: b.profit, bet: betTitle(b, gameFor) });
}

function lights() {
  const live = state.bets.filter((b) => !isSettled(b) && b.live && b.live.status === 'live' && Number.isFinite(b.live.win));
  let mood = 'idle';
  if (live.length) {
    const w = live.reduce((s, b) => s + (Number(b.stake) || 1), 0);
    const p = live.reduce((s, b) => s + (Number(b.stake) || 1) * b.live.win, 0) / w;
    mood = p >= 0.6 ? 'covering' : p >= 0.4 ? 'coin_flip' : 'trouble';
  }
  if (mood !== state.lightState) {
    const first = state.lightState === '';
    state.lightState = mood;
    if (!first || mood !== 'idle') hook(state.settings.lightsUrl, { event: 'mood', state: mood });
  }
}

function hook(url, data) {
  if (!url || !/^https?:\/\//.test(url)) return;
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(data)) u.searchParams.set(k, String(v));
    u.searchParams.set('value1', String(data.state || data.result || ''));
    u.searchParams.set('value2', String(data.profit != null ? data.profit : ''));
    u.searchParams.set('value3', String(data.bet || ''));
    fetch(u.toString(), { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ app: 'sweat', ...data, at: new Date().toISOString() }) }).catch(() => {});
  } catch {
    /* a bad address is shown in Settings when tested */
  }
}

// ------------------------------------------------------------ alerts, sound, wake lock

let audio = null;
function beep(kind) {
  if (!state.settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'won' ? [523, 659, 784] : kind === 'lost' ? [392, 330, 262] : kind === 'up' ? [440, 660] : kind === 'down' ? [440, 294] : [440];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.22);
    });
  } catch {
    /* no audio */
  }
}

async function notify(title, body, kind) {
  beep(kind);
  toast(title);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `sweat-${kind}-${title}` });
    else new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch {
    /* notifications are best effort */
  }
}

function announce(text) {
  const el = $('#live');
  if (el) el.textContent = text;
}

async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator && !lastWake) {
      lastWake = await navigator.wakeLock.request('screen');
      lastWake.addEventListener('release', () => {
        lastWake = null;
      });
    } else if (!on && lastWake) {
      await lastWake.release();
      lastWake = null;
    }
  } catch {
    lastWake = null;
  }
}

function keepAwake() {
  if (state.tab === 'tv') return wake(true);
  const live = state.bets.some((b) => !isSettled(b) && b.live && b.live.status === 'live');
  return wake(!!(state.settings.keepAwake && live && !document.hidden));
}

let toastTimer = null;
function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// ------------------------------------------------------------ events

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
}

function onInput(e) {
  const el = e.target;
  const bind = el.dataset && el.dataset.bind;
  if (bind) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const [root, ...rest] = bind.split('.');
    if (root === 'sheet' && state.sheet) setPath(state.sheet, rest.join('.'), v);
    else if (root === 'slip') setPath(state.slip, rest.join('.'), v);
    else if (root === 'paste') setPath(state.paste, rest.join('.'), v);
    else if (root === 'imp') setPath(state.imp, rest.join('.'), v);
    else if (root === 'add') setPath(state.add, rest.join('.'), v);
    if (root === 'add' && rest[0] === 'q') {
      const pos = el.selectionStart;
      renderMain();
      const again = $('[data-bind="add.q"]');
      if (again) {
        again.focus();
        again.setSelectionRange(pos, pos);
      }
    } else if (root === 'imp') {
      const btn = $('[data-action="read-import"]');
      if (btn) btn.disabled = !state.imp.text.trim() || state.imp.busy;
    } else if (root === 'paste') {
      const btn = $('[data-action="read-slip"]');
      if (btn) btn.disabled = !state.paste.text.trim() || state.paste.busy || !state.settings.passcode;
    } else if (root === 'slip') {
      const t = $('#towin');
      if (t) {
        const dec = slipDecimal();
        const parlay = state.slip.legs.length > 1;
        const stake = num(state.slip.stake === '' ? (parlay ? state.settings.parlayStake : state.settings.stake) : state.slip.stake);
        t.textContent = Number.isFinite(dec) && Number.isFinite(stake) ? money(stake * (dec - 1)) : 'Enter the price';
      }
    } else if (root === 'sheet' && state.sheet && state.sheet.type === 'hedge') {
      if (rest[0] !== 'amount' && rest[0] !== 'cash') state.sheet.amount = '';
      renderHedgeOut();
    } else if (root === 'sheet' && state.sheet && state.sheet.type === 'pick' && rest[0] === 'stat') {
      state.sheet.choice = null;
      renderLayer();
    }
    return;
  }
  const key = el.dataset && el.dataset.setting;
  if (key && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
    state.settings[key] = ['stake', 'parlayStake'].includes(key) ? num(el.value) || 0 : el.value.trim();
    saveSettings();
  }
}

function onChange(e) {
  const el = e.target;
  const key = el.dataset && el.dataset.setting;
  if (key && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
    state.settings[key] = el.type === 'checkbox' ? el.checked : el.value;
    saveSettings();
    if (key === 'keepAwake') keepAwake();
  }
  const action = el.dataset && el.dataset.action;
  if (action === 'photo') onPhoto(el.files && el.files[0]);
  if (action === 'import-json' && el.files && el.files[0]) importJson(el.files[0]);
  if (action === 'resolve') resolvePick(Number(el.dataset.b), Number(el.dataset.l), el.value, el.dataset.list === 'import' ? 'import' : 'paste');
  if (el.dataset && el.dataset.bind === 'sheet.stat') renderLayer();
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (state.sheet) closeSheet();
    else if (state.tab === 'tv') go('live');
  }
  if (e.key === 'Tab' && state.sheet) {
    const f = [...document.querySelectorAll('#layer .sheet button, #layer .sheet input, #layer .sheet select, #layer .sheet textarea')].filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
      e.preventDefault();
      f[0].focus();
    }
  }
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'tab':
      if (state.sheet) closeSheet();
      return go(el.dataset.tab);
    case 'tv':
      return go('tv');
    case 'exit-tv':
      return go('live');
    case 'refresh':
      toast('Checking scores');
      return tick(true);
    case 'add-mode':
      state.add.mode = el.dataset.mode;
      if (state.tab !== 'add') return go('add');
      if (state.add.mode === 'build') loadGames();
      return renderMain();
    case 'sport':
      state.add.sport = el.dataset.sport;
      state.add.q = '';
      return loadGames(true);
    case 'day':
      state.add.date = shiftDate(state.add.date, Number(el.dataset.d));
      return loadGames(true);
    case 'reload-games':
      return loadGames(true);
    case 'next-gameday':
      return nextGameDay();
    case 'pick':
      return openPick(id);
    case 'segment':
      state.sheet.segment = el.dataset.seg;
      state.sheet.choice = null;
      state.sheet.line = '';
      return renderLayer();
    case 'market':
      state.sheet.market = el.dataset.market;
      state.sheet.choice = null;
      state.sheet.line = '';
      state.sheet.odds = '';
      state.sheet.error = '';
      if (el.dataset.market === 'prop') loadRoster();
      return renderLayer();
    case 'pick-team':
      state.sheet.team = el.dataset.team;
      state.sheet.choice = null;
      return renderLayer();
    case 'choose':
      chooseOption(el.dataset.choice);
      return renderLayer();
    case 'add-leg':
      return addLeg();
    case 'open-slip':
      state.sheet = { type: 'slip' };
      return renderLayer();
    case 'drop-leg':
      state.slip.legs.splice(Number(el.dataset.i), 1);
      if (!state.slip.legs.length) state.sheet = null;
      return renderLayer();
    case 'clear-slip':
      state.slip.legs = [];
      state.sheet = null;
      return renderLayer();
    case 'save-slip':
      return saveSlip();
    case 'read-slip':
      return readSlip();
    case 'read-import':
      return readImport();
    case 'save-import':
      return saveRead('import');
    case 'save-read':
      return saveRead();
    case 'detail':
      state.sheet = { type: 'detail', id };
      return renderLayer();
    case 'hedge': {
      const b = state.bets.find((x) => x.id === id);
      const leg = b && hedgeLeg(b);
      let line = '';
      let price = '';
      const g = leg && gameFor(leg);
      if (leg && g && g.odds && g.state === 'pre' && (leg.segment || 'game') === 'game') {
        const o = g.odds;
        const other = otherSide(leg);
        if (leg.market === 'spread' && Number.isFinite(o.spreadHome)) {
          line = String(other === 'home' ? o.spreadHome : -o.spreadHome);
          price = String((other === 'home' ? o.homeSpreadOdds : o.awaySpreadOdds) || '');
        } else if (leg.market === 'moneyline') price = String((other === 'home' ? o.homeML : o.awayML) || '');
        else if (leg.market === 'total' && Number.isFinite(o.total)) {
          line = String(o.total);
          price = String((other === 'over' ? o.overOdds : o.underOdds) || '');
        }
      }
      state.sheet = { type: 'hedge', id, line, price, amount: '', cash: '', math: false };
      return renderLayer();
    }
    case 'hedge-math':
      state.sheet.math = !state.sheet.math;
      return renderHedgeOut();
    case 'live-prices':
      return fetchLivePrices();
    case 'flip': {
      const input = document.querySelector(`[data-bind="${el.dataset.target}"]`);
      if (!input) return;
      const v = input.value.trim();
      input.value = !v ? '-' : v.startsWith('-') ? v.slice(1) : `-${v.replace(/^\+/, '')}`;
      onInput({ target: input });
      input.focus();
      return;
    }
    case 'settle':
      state.sheet = { type: 'settle', id, payout: '' };
      return renderLayer();
    case 'settle-as':
      return settleAs(el.dataset.result);
    case 'edit': {
      const b = state.bets.find((x) => x.id === id);
      state.sheet = { type: 'edit', id, form: { stake: String(b.stake), odds: String(b.odds), book: b.book || '', bonus: !!b.bonus, payout: b.payout != null ? String(b.payout) : '', lines: b.legs.map((l) => (l.line != null ? String(l.line) : '')), legOdds: b.legs.map((l) => (l.odds != null ? String(l.odds) : '')) } };
      return renderLayer();
    }
    case 'save-edit':
      return saveEdit();
    case 'delete':
      state.sheet = { type: 'confirm', title: 'Delete this bet?', text: 'It comes off your history and totals. This cannot be undone.', yes: 'Delete bet', then: async () => {
        await db.deleteBet(id);
        state.bets = state.bets.filter((b) => b.id !== id);
      } };
      return renderLayer();
    case 'wipe':
      state.sheet = { type: 'confirm', title: 'Delete every bet?', text: 'Every open and settled bet on this device goes away. Back up first if you might want them.', yes: 'Delete everything', then: async () => {
        for (const b of state.bets) await db.deleteBet(b.id);
        state.bets = [];
      } };
      return renderLayer();
    case 'confirm-yes': {
      const fn = state.sheet && state.sheet.then;
      state.sheet = null;
      if (fn) await fn();
      return render();
    }
    case 'close':
      return closeSheet();
    case 'range':
      state.history.range = el.dataset.range;
      return renderMain();
    case 'hsport':
      state.history.sport = el.dataset.sport;
      return renderMain();
    case 'theme':
      state.settings.theme = el.dataset.theme;
      applyTheme();
      saveSettings();
      return renderMain();
    case 'notify-perm':
      if (typeof Notification !== 'undefined') await Notification.requestPermission();
      return renderMain();
    case 'test-lights':
      hook(state.settings.lightsUrl, { event: 'mood', state: 'covering', test: true });
      hook(state.settings.settleUrl, { event: 'settled', result: 'won', profit: 9.09, bet: 'Test bet', test: true });
      return toast(state.settings.lightsUrl || state.settings.settleUrl ? 'Test sent. Check your lights.' : 'Add a web address first.');
    case 'export-json':
      return exportJson();
    case 'export-csv':
      return exportCsv();
    case 'export-warroom':
      return exportWarRoom();
    default:
  }
}

// ------------------------------------------------------------ start

if (typeof window !== 'undefined' && !window.__SWEAT_NO_BOOT__) boot();

export { state, evaluateAll, ticketHTML };
