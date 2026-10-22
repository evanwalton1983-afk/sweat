// End-to-end test: a phone builds bets, reads a slip, sweats a scripted night, settles, checks
// history, and a TV runs big screen mode. Screenshots go to the folder given (default
// tests/e2e/shots). Needs Playwright with Chromium.
//
//   node tests/e2e/run.mjs [shots-dir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(process.argv[2] || path.join(here, 'shots'));
fs.mkdirSync(shots, { recursive: true });
const port = 4410 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;

const server = spawn(process.execPath, [path.join(here, 'server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const step = (i) => fetch(`${base}/__step?i=${i}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = async (name, p = page) => {
  await pause(900);
  await p.screenshot({ path: path.join(shots, `${name}.png`) });
};
const refresh = async (p = page) => {
  await p.click('[data-action="refresh"]');
  await pause(1500);
};

try {
  await step(0);
  // A site without the optional keys hides what needs them.
  await fetch(`${base}/__keys?on=0`);
  await page.goto(`${base}/#live`);
  await page.waitForSelector('.empty');
  await pause(800);
  check(!(await page.isVisible('text=Paste a slip')), 'without keys there are no slip reader buttons');
  await page.click('[data-tab="add"]');
  await page.waitForSelector('.game');
  check((await page.locator('[data-action="add-mode"][data-mode="paste"]').count()) === 0, 'without keys Add has no Paste or Photo');
  await page.click('[data-tab="settings"]');
  check(!(await page.isVisible('[data-setting="passcode"]')), 'without keys Settings does not ask for a passcode');

  // Netlify plans with AI Gateway add an Anthropic key to every site by themselves. That alone
  // must not switch on the slip reader; live prices (the owner's own key) still show.
  await fetch(`${base}/__keys?on=gateway`);
  await page.goto(`${base}/?keys=gateway#live`);
  await page.waitForSelector('.empty');
  await pause(800);
  check(!(await page.isVisible('text=Paste a slip')), 'Netlify\'s own Anthropic key does not switch on the slip reader');
  await page.click('[data-tab="add"]');
  await page.waitForSelector('.game');
  check((await page.locator('[data-action="add-mode"][data-mode="paste"]').count()) === 0, 'with only Netlify\'s key Add has no Paste or Photo');
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('[data-setting="passcode"]', { timeout: 5000 }).catch(() => {});
  check(await page.isVisible('[data-setting="passcode"]') && await page.isVisible('h3:text-is("Live prices")'), 'with an odds key Settings asks for the passcode for live prices only');
  const refused = (await fetch(`${base}/api/slip`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sweat-passcode': 'test-pass' }, body: JSON.stringify({ text: 'Bills -3.5 -110' }) })).status;
  const claudeCalls = (await (await fetch(`${base}/__calls`)).json()).filter((u) => /anthropic|gateway\.test/.test(u));
  check(refused === 503 && claudeCalls.length === 0, 'the slip function refuses and never calls Claude while the reader is off');

  await fetch(`${base}/__keys?on=1`);
  await page.goto(`${base}/?keys=1#live`);
  await page.waitForSelector('.empty');
  await pause(800);
  check(await page.isVisible('text=Nothing in play'), 'empty live board explains what to do');
  await shot('01-empty');

  // Build a straight bet: Bills -3.5.
  await page.click('[data-action="add-mode"][data-mode="build"]');
  await page.waitForSelector('.game');
  await shot('02-games');
  await page.click('.game:has-text("Buffalo Bills")');
  await page.waitForSelector('.sheet');
  check(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus moves into the sheet');
  await page.click('[data-action="choose"][data-choice="home"]');
  check((await page.inputValue('[data-bind="sheet.line"]')) === '-3.5', 'spread line prefilled from ESPN');
  check((await page.inputValue('[data-bind="sheet.odds"]')) === '', 'no made-up price when ESPN has none');
  await page.fill('[data-bind="sheet.odds"]', '110');
  await page.click('[data-action="flip"][data-target="sheet.odds"]');
  check((await page.inputValue('[data-bind="sheet.odds"]')) === '-110', 'plus or minus switch flips the price');
  await shot('03-pick');
  await page.click('[data-action="add-leg"]');
  await page.click('[data-action="open-slip"]');
  await page.fill('[data-bind="slip.stake"]', '10');
  await page.fill('[data-bind="slip.book"]', 'DraftKings');
  await shot('04-slip');
  await page.click('[data-action="save-slip"]');
  await page.waitForSelector('.ticket');
  check((await page.locator('.ticket').count()) === 1, 'saved bet shows on Live');

  // Over 44.5 on the same game, edited from 47.5.
  await page.click('[data-tab="add"]');
  await page.click('.game:has-text("Buffalo Bills")');
  await page.click('[data-action="market"][data-market="total"]');
  await page.click('[data-action="choose"][data-choice="over"]');
  await page.fill('[data-bind="sheet.line"]', '44.5');
  await page.fill('[data-bind="sheet.odds"]', '-110');
  await page.click('[data-action="add-leg"]');
  await page.click('[data-action="open-slip"]');
  await page.click('[data-action="save-slip"]');

  // Parlay: Bills moneyline plus Chiefs -7 tonight.
  await page.click('[data-tab="add"]');
  await page.click('.game:has-text("Buffalo Bills")');
  await page.click('[data-action="market"][data-market="moneyline"]');
  await page.click('[data-action="choose"][data-choice="home"]');
  await page.click('[data-action="add-leg"]');
  await page.click('.game:has-text("Kansas City")');
  await page.click('[data-action="choose"][data-choice="away"]');
  await page.fill('[data-bind="sheet.odds"]', '-110');
  await page.click('[data-action="add-leg"]');
  await page.click('[data-action="open-slip"]');
  check((await page.locator('#sheet-title').innerText()) === '2-leg parlay', 'two legs make a parlay');
  await page.click('[data-action="save-slip"]');

  // NBA player prop: OG Anunoby over 15.5 points.
  await page.click('[data-tab="add"]');
  await page.click('[data-action="sport"][data-sport="nba"]');
  await page.waitForSelector('.game:has-text("Knicks")');
  await page.click('.game:has-text("Knicks")');
  await page.click('[data-action="market"][data-market="prop"]');
  await page.fill('[data-bind="sheet.player"]', 'OG Anunoby');
  await page.click('[data-action="choose"][data-choice="over"]');
  await page.fill('[data-bind="sheet.line"]', '15.5');
  await page.fill('[data-bind="sheet.odds"]', '-120');
  await shot('05-prop');
  await page.click('[data-action="add-leg"]');
  await page.click('[data-action="open-slip"]');
  await page.click('[data-action="save-slip"]');

  // UFC moneyline.
  await page.click('[data-tab="add"]');
  await page.click('[data-action="sport"][data-sport="ufc"]');
  await page.waitForSelector('.game:has-text("Alan Alpha")');
  await page.click('.game:has-text("Alan Alpha")');
  await page.click('[data-action="choose"][data-choice="home"]');
  await page.fill('[data-bind="sheet.odds"]', '-150');
  await page.click('[data-action="add-leg"]');
  await page.click('[data-action="open-slip"]');
  await page.click('[data-action="save-slip"]');

  // Read a slip (Claude is mocked; the function and the matching are real).
  await page.click('[data-tab="settings"]');
  await page.fill('[data-setting="passcode"]', 'test-pass');
  await page.click('[data-tab="add"]');
  await page.click('[data-action="add-mode"][data-mode="paste"]');
  await page.fill('[data-bind="paste.text"]', 'Miami Dolphins +3.5 -110, risk $20. Parlay: Knicks ML, Chiefs at Raiders under 44.5, $5 to win $13.20');
  await page.click('[data-action="read-slip"]');
  await page.waitForSelector('.pv');
  await shot('06-slip-read');
  check((await page.locator('.pv .ok').count()) === 3, 'slip reader matched all three legs to games');
  await page.click('[data-action="save-read"]');
  await page.waitForSelector('.ticket');
  check((await page.locator('.ticket').count()) === 7, 'seven open bets after the slip');
  await shot('07-pregame');

  // The night.
  for (const i of [1, 2, 3]) {
    await step(i);
    await refresh();
  }
  check(await page.isVisible('.bug .clock:has-text("Halftime")'), 'halftime shows on the score bug');
  await shot('08-halftime');

  await step(4);
  await refresh();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('09-late');
  const billsTicket = page.locator('.ticket', { hasText: 'BUF -3.5' }).first();
  const billsPct = Number(await billsTicket.locator('.pct .n').innerText());
  check(billsPct < 30, `Bills -3.5 looks bad with Miami driving late (${billsPct}%)`);

  // Hedge sheet on the Bills.
  await billsTicket.locator('[data-action="hedge"]').click();
  await page.fill('[data-bind="sheet.price"]', '-300');
  await page.fill('[data-bind="sheet.line"]', '6.5');
  await pause(300);
  check(await page.isVisible('text=Full lock is'), 'hedge shows a full lock');
  check(await page.isVisible('text=both win'), 'hedge shows the middle');
  const slider = await page.$('#hedge-amt');
  await slider.evaluate((el) => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pause(200);
  check((await slider.evaluate((el) => el.isConnected)) && (await page.innerText('#hedge-amt-label')) === 'Hedge amount: $5.00', 'hedge slider moves without rebuilding the sheet');
  check(await page.isVisible('text=Worst case at'), 'hedge shows the worst case');
  await page.fill('[data-bind="sheet.cash"]', '1');
  await pause(200);
  check(await page.isVisible('text=Hedge beats cash out by') || await page.isVisible('text=Cash out is better by'), 'hedge gives a cash out verdict');
  check((await slider.evaluate((el) => el.isConnected)) && (await page.innerText('#hedge-amt-label')) === 'Hedge amount: $5.00', 'typing a cash out keeps the slider');
  await page.click('[data-action="hedge-math"]');
  await pause(200);
  check(await page.isVisible('text=Full lock stake ='), 'hedge shows the math on tap');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'hedge sheet has no sideways scroll at phone width');
  await shot('10-hedge');
  await page.click('[data-action="close"] >> nth=-1');

  await step(5);
  await refresh();
  const overTicket = page.locator('.ticket', { hasText: 'Over 44.5' }).first();
  const overPct = Number(await overTicket.locator('.pct .n').innerText());
  check(overPct >= 80, `over 44.5 at 44 with Miami at the 4 (${overPct}%)`);
  await shot('11-last-minute');

  // Big screen at the same moment.
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('pageerror', (e) => errors.push(`tv pageerror: ${e.message}`));
  await tv.goto(`${base}/#live`);
  await tv.evaluate(async (bets) => {
    const open = indexedDB.open('sweat', 1);
    await new Promise((r) => { open.onsuccess = r; open.onupgradeneeded = () => { open.result.createObjectStore('bets', { keyPath: 'id' }); open.result.createObjectStore('kv'); }; });
    const t = open.result.transaction('bets', 'readwrite');
    for (const b of bets) t.objectStore('bets').put(b);
    await new Promise((r) => { t.oncomplete = r; });
  }, await page.evaluate(async () => {
    const open = indexedDB.open('sweat', 1);
    await new Promise((r) => { open.onsuccess = r; });
    const t = open.result.transaction('bets', 'readonly').objectStore('bets').getAll();
    return new Promise((r) => { t.onsuccess = () => r(t.result); });
  }));
  await tv.goto(`${base}/?screen=tv#tv`);
  await tv.waitForSelector('.tvgrid .ticket');
  await pause(2500);
  await tv.screenshot({ path: path.join(shots, '12-tv.png') });
  check((await tv.locator('.tvgrid .ticket').count()) >= 6, 'big screen shows the open bets');
  await tv.close();

  await step(6);
  await refresh();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('13-final');
  const stampOf = async (text) => (await page.locator('.ticket', { hasText: text }).first().locator('.stamp').innerText()).trim();
  check((await stampOf('BUF -3.5')).startsWith('Cashed'), 'Bills -3.5 cashed');
  check((await stampOf('Over 44.5')) === 'Lost', 'over 44.5 lost at 44');
  check((await stampOf('OG Anunoby')).startsWith('Cashed'), 'Anunoby over 15.5 cashed');
  check((await stampOf('Alan Alpha')).startsWith('Cashed'), 'Alpha won the fight');
  check((await stampOf('MIA +3.5')) === 'Lost', 'Dolphins +3.5 from the slip lost');
  check(await page.isVisible('.ticket:has-text("2-leg parlay") .legs .leg[data-s="won"]'), 'parlay leg one is in, leg two still to go');

  // History.
  await page.click('[data-tab="history"]');
  await page.click('[data-action="range"][data-range="7"]');
  await page.waitForSelector('.totals');
  check(await page.isVisible('h2:has-text("Bad beats")'), 'the over shows as a bad beat');
  check(await page.isVisible('h2:has-text("Miracles")'), 'the Bills show as a miracle');
  await shot('14-history');
  await page.screenshot({ path: path.join(shots, '15-history-full.png'), fullPage: true });

  // Detail sheet.
  await page.click('.beat.good');
  await page.waitForSelector('.bigline');
  await shot('16-detail');
  await page.keyboard.press('Escape');

  // Settings and the day theme.
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="theme"][data-theme="day"]');
  await page.click('[data-tab="live"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('17-day-theme');
  await page.click('[data-tab="settings"]');
  await page.click('[data-action="theme"][data-theme="night"]');
  await shot('18-settings');

  // A scoring change after the final regrades the over.
  await page.click('[data-tab="live"]');
  await step(7);
  await refresh();
  check((await stampOf('Over 44.5')).startsWith('Cashed'), 'a scoring change after the final regrades the over to a win');
  await shot('19-regraded');

  // Exports download.
  await page.click('[data-tab="settings"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-warroom"]')]);
  const wr = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(wr.contract === 'sweat-ledger' && wr.bets.length === 7, 'War Room file has every bet');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-csv"]')]);
  check(fs.readFileSync(await csv.path(), 'utf8').split('\n').length === 8, 'CSV has a header and seven rows');

  // A bet sent from The Number: a link opens Add with the bet matched to ESPN's game, ready to save.
  const payload = { from: 'the-number', v: 1, bets: [{ book: 'FanDuel', stake: 15, odds: -120, bonus: false, legs: [{ sport: 'nfl', market: 'spread', segment: 'game', team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders', odds: -120, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), line: -6.5 }] }] };
  const code = `NUM1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  await page.goto(`${base}/?from=number#import=${code}`);
  await page.waitForSelector('[data-action="save-import"]');
  check((await page.getAttribute('[data-action="add-mode"][data-mode="import"]', 'aria-pressed')) === 'true', 'a link from The Number opens the Import tab');
  check(/KC -6\.5: KC at LV/.test(await page.innerText('.preview')) && !(await page.isDisabled('[data-action="save-import"]')), 'the bet from The Number is matched to the Chiefs game');
  check(!page.url().includes('NUM1'), 'the bet code leaves the address bar');
  await shot('20-import');
  await page.click('[data-action="save-import"]');
  await page.waitForSelector('.ticket');
  check((await page.locator('.ticket:has-text("KC -6.5")').count()) === 1, 'the imported bet is on the Live tab');
  await page.click('[data-tab="add"]');
  await page.click('[data-action="add-mode"][data-mode="import"]');
  await page.fill('[data-bind="imp.text"]', 'not a code');
  await page.click('[data-action="read-import"]');
  await page.waitForSelector('.view .neg');
  check(/not a bet code from The Number/.test(await page.innerText('.view .neg')), 'a pasted code that is not one says so');

  const html = await page.content();
  check(!/[\u2013\u2014]/.test(html), 'no long dashes on screen');
} catch (e) {
  failures.push(`crashed: ${e.message}`);
  console.error(e);
  await page.screenshot({ path: path.join(shots, 'crash.png') }).catch(() => {});
} finally {
  for (const e of errors) failures.push(e);
  await browser.close();
  server.kill();
}

if (errors.length) console.log(errors.join('\n'));
console.log(failures.length ? `\n${failures.length} problem(s)` : '\nAll end-to-end checks passed');
process.exit(failures.length ? 1 : 0);
