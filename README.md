# options-alert

A simple single-user Telegram bot that watches option prices through the Massive.com API and sends alerts when saved thresholds are reached.

This app intentionally does not use a database. It stores alerts and small bits of state in JSON files under `data/`.

## What It Does

- Lets one trusted Telegram user create option alerts.
- Discovers option expiries, strikes, and exact option contract tickers from Massive.com.
- Stores the resolved option contract ticker and uses that exact ticker for monitoring.
- Checks active alerts on a schedule, defaulting to every 15 minutes.
- Prefers latest trade price when it is available and not stale.
- Falls back to bid/ask mid price when latest trade is missing or stale.
- Avoids duplicate repeated alerts with a simple armed/triggered state and hysteresis.
- Supports manual `/check`, pause, resume, threshold edit, entry-price edit, and delete.

## Telegram Bot Setup

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`.
3. Follow the prompts and copy the bot token.
4. Start a chat with your new bot.
5. Get your Telegram user id and chat id. A quick way is to message `@userinfobot`, or log incoming updates during local testing.

Only the user id in `TELEGRAM_ADMIN_USER_ID` can use this bot. Other users are rejected.

## Environment

Copy the example file:

```sh
cp .env.example .env
```

Fill in:

```sh
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_USER_ID=
TELEGRAM_ADMIN_CHAT_ID=
MASSIVE_API_KEY=
POLL_INTERVAL_MINUTES=15
DATA_DIR=./data
DEFAULT_PRICE_BASIS=last_trade
STALE_TRADE_MAX_MINUTES=30
```

`DEFAULT_PRICE_BASIS=last_trade` means latest trade is preferred, with bid/ask mid fallback when the trade is missing or stale.

## Install

Requires Node.js 20 or newer.

```sh
npm install
```

## Run Locally

Development mode uses Node's built-in watcher:

```sh
npm run dev
```

Production-style local run:

```sh
npm start
```

Syntax check:

```sh
npm run build
npm run typecheck
```

There is no TypeScript. The `typecheck` script is a plain JavaScript syntax check.

## Run With pm2

```sh
npm install -g pm2
pm2 start src/index.js --name options-alert
pm2 save
pm2 logs options-alert
```

To restart after changing `.env`:

```sh
pm2 restart options-alert --update-env
```

## JSON Storage

The app uses:

```text
data/alerts.json
data/recentTickers.json
data/appState.json
```

Storage behavior:

- The data directory is created automatically.
- Missing JSON files are created with valid empty/default structures.
- Loaded JSON is validated with zod.
- Writes are atomic: data is written to a temp file and then renamed.
- A `.bak` copy is kept before overwriting existing JSON.
- If a JSON file is corrupt, the app tries the `.bak`; if that fails, it preserves a `.corrupt-*` copy and recreates defaults.

`appState.json` stores the current single-user setup/edit flow, so a restart during setup does not corrupt saved alerts.

## Alert Evaluation

Supported alert types:

- Percent change from entry
- Dollar change from entry
- Target option price

Supported directions:

- Above
- Below

Every polling cycle:

1. Active alerts are loaded from `alerts.json`.
2. The stored Massive option contract ticker is checked with the option snapshot endpoint.
3. The selected alert price is chosen:
   - latest trade if available and not stale
   - otherwise bid/ask mid if both bid and ask are positive
   - otherwise the alert is skipped for that cycle
4. Change from entry is calculated.
5. The condition is evaluated.
6. If crossed and `triggerState` is `armed`, a Telegram alert is sent and the alert becomes `triggered`.

Re-arming uses hysteresis:

- Percent alerts: 5 percentage points
- Dollar-change alerts: 10% of threshold or $0.05 minimum
- Target-price alerts: 1% of target price or $0.05 minimum

Example: an alert for `above +25%` triggers at `+25%` and will not re-arm until the change falls to `+20%` or lower.

## Massive.com API

The app uses:

- `GET /v3/reference/options/contracts` for contracts, expiries, strikes, and final contract resolution.
- `GET /v3/snapshot/options/{underlyingAsset}/{optionContract}` for monitoring.

Massive response mapping is isolated in `src/massive/client.js`. If Massive changes field names, adjust that file first.

## Important Options Warning

Options prices can be delayed, illiquid, stale, or unavailable. Bid/ask spreads can be wide, especially outside regular market hours or for thinly traded contracts. A bid/ask midpoint is only an estimate and may not be executable. This bot is an alerting tool, not trading advice or an execution system.
