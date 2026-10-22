# Sweat

Live cash chances for your bets. Add a bet (build it, paste the slip, or snap a photo of it) and
Sweat follows the game: a big scoreboard number for the chance it cashes from this moment, a
plain sentence about where it stands ("Up 3, short by 0.5"), a sweat line of how that chance has
moved, alerts on big swings, and a stamp when it settles. NFL, college football, NBA, men's
college basketball and UFC.

It is a phone-first web app (installable to the Home Screen) with a big screen mode for the TV.
Bets stay on your device. Scores come from ESPN's public feed.

## What it does

- **Live board.** Every open bet as a ticket: score bug in team colors, who has the ball, red
  zone, the cash chance, the sweat line, and the push chance when there is one. Parlays show each
  leg with its own chance. Totals across the night: money in play, what it could cash, and the
  expected result right now.
- **Ways to add.** Build (pick a game, market, side; ESPN's line and price are filled in to
  edit), or Import a bet sent from The Number (a link opens it, or paste its bet code). Paste
  and photo are optional and off until you switch them on: they use Claude on your Netlify site
  to read the slip and match every leg to the right game.
- **Markets.** Spread, moneyline, total, team total, first half and first quarter, and player
  props (points, rebounds, assists, threes, steals, blocks, combos; passing, rushing and receiving
  yards, receptions, attempts, completions, touchdowns, interceptions, anytime touchdown). Parlays
  of any of them. UFC moneylines.
- **Grading.** Settles itself at the final, at halftime for first-half bets, and early when it can
  (an over that is already over, an anytime touchdown scored). Pushes shorten parlays the way books
  do. Postponed games and players who never get in are voided. Props wait for a final box score.
  For 20 minutes after a final Sweat keeps checking, and if ESPN changes a score or a stat the bet
  is regraded with a note. Anything the feed cannot grade gets "Needs a check" and a
  settle-by-hand button, which also covers cash outs.
- **Hedge and middle.** Enter the other side's line and price (or fetch the best live price with
  your Odds API key). Sweat shows the stake that locks the same result either way, a slider for a
  partial hedge, each outcome with its chance from here, the middle window when there is one, and
  what holding versus hedging is worth on average. Type the book's cash out offer for a plain verdict (hedge beats cash out by so much, or cash out is better), and tap Show the math to see every step.
- **Alerts.** Big swings (10 to 25 points, your choice) and settlements, with a sound and a
  notification when Sweat is in the background. Smart lights: a web address is called when the
  mood of your open bets changes (covering, coin flip, trouble) and when a bet settles. Works with
  Home Assistant webhooks and IFTTT.
- **History.** Profit, record, return on stakes, a profit line, bad beats (lost after 85% or
  better) and miracles (cashed from 15% or worse), results by kind of bet, every settled ticket.
- **Big screen.** All open bets in large type for a TV, with the clock and the night's expected
  result. Keeps the screen awake.
- **Your data.** Back up and restore (JSON), a spreadsheet export (CSV), and a War Room file that
  uses The War Room's field names (sport, event, market, selection, price) for its bet import.

## How the numbers work

Each percentage is the chance the bet cashes from this moment, starting from the book's line
(ESPN's pickcenter line, or your own line and price when ESPN has none).

- **Football** plays out the rest of the game drive by drive: each drive ends in a touchdown
  (7, 6 or 8), a field goal or nothing, with rates set so the expected points match the market.
  The drive in progress uses where the ball is and the down (from 2023 to 2025 NFL play by play).
  Late in a half it goes drive by drive with the clock, so a team down 4 to 8 goes for the
  touchdown and a leader runs clock. Overtime is modeled, and final margins are reweighted toward
  3, 7, 10 and 14 the way real games land (fitted on closing lines and finals). College games mix
  a few what-ifs around the line, because college lines miss by more.
- **Basketball** models the rest of the game from the line, with what real games showed: leads
  bigger than the line expected shrink (about half of the surprise melts away), scoring follows
  the real minute-by-minute pattern (college scores more after halftime), a hot or cold start says
  almost nothing about the rest of the game, the last minutes swing more, and close games late get
  extra points from fouling.
- **Props** blend a player's pace with the line, scaled by the minutes or game left, with foul
  trouble and blowouts in basketball.
- **Fights** hold the pregame price (minus the book's cut) until there is a result.

### Checked against real games

Lower Brier is better (0.25 is a coin flip). "Said 85, happened 84" means that when Sweat said
85%, the bet cashed 84% of the time.

| Check | Moments | Sweat | Benchmark |
|---|---|---|---|
| NFL win chance, live, 2023 to 2025 | 23,145 | 0.149 | nflfastR market model 0.147 |
| NFL pregame margin spread vs real | 3,893 games | 12.82 | 12.92 real |
| NFL push on 3 / 7 | 560 / 237 games | 8.2% / 5.3% | 9.3% / 7.6% real |
| NBA win chance, live, 2024-25 season | 23,633 | 0.144, said 85 happened 84 | |
| NBA win chance, live, with ESPN lines, 2025 and 2026 | 6,955 | 0.159 (last 5 min 0.051) | ESPN win chance 0.158 (last 5 min 0.055) |
| NBA over, live, with ESPN lines | 6,955 | 0.169, said 85 happened 86 | |
| College basketball win chance, live, 2024-25 | 109,541 | 0.120 (last 5 min 0.049) | ESPN win chance 0.120 (last 5 min 0.051) |
| College basketball win chance, live, ESPN lines | 8,924 | 0.132 | ESPN win chance 0.134 |
| College football pregame margin / total spread | 1,600 games | 16.04 / 16.50 | 16.12 / 16.61 real |

Nothing here predicts winners better than the market; the point is an honest live number from
the line you bet. The calibration scripts are in `scripts/` (see Calibration below).

## Set up on Netlify

The site needs Netlify Functions, so deploy from Git or the Netlify CLI (a drag-and-drop upload
skips functions; the app then talks to ESPN directly and the slip reader and live prices are off).

1. Put this folder in a GitHub repo and create a Netlify site from it. The settings come from
   `netlify.toml` (build `npm run build`, publish `public`, functions `netlify/functions`).
2. No keys are needed: scores, live chances, hedging, alerts, history and big screen mode all
   work without any. Two features are optional and stay hidden until they are set up (Site
   configuration, Environment variables):
   - Live prices in the hedge tool: `ODDS_API_KEY` (from the-odds-api.com; the free plan's 500
     requests a month is plenty, each check costs 3) and `APP_PASSCODE`.
   - Paste and Photo (reading slips with Claude): off until you set `SLIP_READER` to `on`, with
     `APP_PASSCODE`. Claude is then reached with your own `ANTHROPIC_API_KEY` if you add one.
     Without one, on Netlify plans that include AI Gateway, slips go through Netlify's gateway
     and are billed to your Netlify credits. Netlify adds its own Anthropic key to every site on
     those plans, which is why a key alone never switches the reader on.
   - `SLIP_MODEL` (optional): the Claude model for slips. Default `claude-sonnet-5-5`.
   `APP_PASSCODE` is any passcode you choose; you type it once in Sweat's Settings. Redeploy after
   changing these so the functions see them.
3. Deploy, open the site on your phone, and add it to the Home Screen. With a key added, enter
   the passcode in Settings. Allow notifications if you want alerts when Sweat is in the background (on iPhone,
   notifications work once Sweat is on the Home Screen).

Scores need no key. ESPN's feed is public but unofficial, so it can change without notice; the
normalizer in `src/espn.js` is the one place to fix if it does.

## Work on it

```
npm install
npm run build        # public/index.html (one file), fonts, service worker
npm test             # engine, ESPN, import and function unit tests (node:test), 39 checks
npm run e2e          # browser run of a scripted night (needs Playwright with Chromium)
npm run check:dashes # no en or em dashes anywhere
```

`npm run e2e` serves `public/` and runs the real Netlify functions against a scripted night of
ESPN responses (pregame, live, halftime, the last two minutes, final), with Claude and The Odds
API answered locally. It builds bets, reads a slip, hedges, sweats, settles, checks history and
big screen mode, and saves screenshots to `tests/e2e/shots`.

Layout:

```
src/engine.js        the math: odds, models, grading, parlays, hedges (pure, tested)
src/espn.js          ESPN responses to Sweat's game shape (shared by the app and the function)
src/feed.js          live data: the site's function first, ESPN directly as a fallback
src/store.js         IndexedDB for bets and settings
src/importer.js      bets sent from The Number (#import= links and pasted codes)
src/app.js, ui.js    the app
src/styles.css       night game look (Big Shoulders Display, Barlow)
netlify/functions    espn (cached, trimmed scores), slip (Claude), odds (The Odds API), status
netlify/lib          which optional features are switched on (shared by the functions)
scripts/             build, dash check, calibration
tests/               unit tests, fixtures (real ESPN summaries), end-to-end run
```

## Calibration

The scripts print the checks in the table above and fit the settings in `SPORTS` in
`src/engine.js`.

- `node scripts/calibrate-nfl.mjs games.csv [nfl_states.csv] [--fit]`: `games.csv` from
  nflverse/nfldata (closing lines and finals). `nfl_states.csv` is a sample of live moments from
  nflverse play by play (2023 to 2025) with the columns the script reads.
- `node scripts/calibrate-hoops.mjs states.csv nba|ncaab [--grid] [--try=...]`: live moments
  from sportsdataverse play by play (hoopR) or raw ESPN game files, with the line and the final.
- `node scripts/calibrate-cfb.mjs cfb_lines.csv [--fit] [--set=...]`: ESPN closing lines and
  finals sampled from sportsdataverse's raw college football files.

## Limits worth knowing

- Sweat does not know timeouts. In the last five minutes of close NFL games nflfastR's model,
  which does, is a little sharper (Brier 0.078 against Sweat's 0.084).
- Phone number pads often have no minus key; the plus or minus button next to lines and odds
  flips the sign.

- Alerts arrive while Sweat is open, including in a background tab. A locked phone can pause
  them; there is no push server.
- First half and first quarter lines are not in ESPN's feed; enter them from your book.
- Player props match players by name in ESPN's box score. If a name does not match at the final,
  the bet asks to be settled by hand.
- UFC has no live model, only the pregame price until the result.
- Bets live in this browser. Back up before switching phones or clearing site data.
