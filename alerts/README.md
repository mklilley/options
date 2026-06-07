# Alerts

Allowlisted Telegram bot that watches option prices through the Massive.com API and sends alerts when saved thresholds are reached.

This app intentionally does not use a database. It stores alerts and small bits of state in JSON files under `data/`.

## What It Does

- Lets a small allowlist of trusted Telegram users create option alerts.
- Stores each alert with the Telegram user id and private chat id that created it.
- Discovers option expiries, strikes, and exact option contract tickers from Massive.com.
- Stores the resolved option contract ticker and uses that exact ticker for monitoring.
- Checks active alerts on a schedule, defaulting to every 15 minutes.
- Uses recent 5-minute aggregate VW prices for alert checks.
- Avoids duplicate repeated alerts with a simple armed/triggered state and hysteresis.
- Supports manual `/check`, pause, resume, threshold edit, entry-price edit, and delete.

## Telegram Bot Setup

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`.
3. Follow the prompts and copy the bot token.
4. Start a chat with your new bot.
5. Get each approved Telegram user's user id. A quick way is to message `@userinfobot`, or have the user start the bot and read the id shown in the rejection message.

Only user ids in `TELEGRAM_ALLOWED_USER_IDS` can use this bot. Unknown users are politely rejected and shown their Telegram user id so you can add them if needed.

You can leave `TELEGRAM_ALLOWED_USER_IDS` blank on the first run. The bot will start, reject everyone, and show each rejected user's Telegram user id.

Each approved user should message the bot directly in a private chat. Alerts are sent back to the private chat where that user created the alert.

## Environment

Copy the example file:

```sh
cp .env.example .env
```

Fill in:

```sh
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ADMIN_USER_ID=
MASSIVE_API_KEY=
POLL_INTERVAL_MINUTES=15
DATA_DIR=./data
DEFAULT_PRICE_BASIS=aggregate_vw
AGGREGATE_LOOKBACK_MINUTES=60
AGGREGATE_DELAY_MINUTES=16
AGGREGATE_BAR_MINUTES=5
LAST_AVAILABLE_LOOKBACK_DAYS=7
```

`TELEGRAM_ALLOWED_USER_IDS` is a comma-separated list, for example:

```sh
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
```

Leave it blank temporarily if you need users to message the bot first so you can see their Telegram user ids.

`TELEGRAM_ADMIN_USER_ID` is optional and reserved for future admin-only commands. Core alert functionality works for every allowed user.

`DEFAULT_PRICE_BASIS=aggregate_vw` means alert checks use the latest available aggregate volume-weighted average price.

Aggregate pricing settings:

- `AGGREGATE_LOOKBACK_MINUTES=60` checks the prior 60-minute window.
- `AGGREGATE_DELAY_MINUTES=16` keeps requests behind the current time for delayed data access.
- `AGGREGATE_BAR_MINUTES=5` requests 5-minute aggregate bars.
- `LAST_AVAILABLE_LOOKBACK_DAYS=7` is used for manual-check display only when no recent bar exists.

The bot picks the most recent returned aggregate bar in that window and uses its `vw` value. If no bar is returned, or the latest bar has no positive `vw`, the alert is skipped for that cycle.

When a manual `/check` finds no recent bar, the bot also looks back up to `LAST_AVAILABLE_LOOKBACK_DAYS` and shows the last available aggregate VW as stale, display-only context. That stale value is not used to trigger alerts.

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

`appState.json` stores setup/edit flows per Telegram user, so a restart during setup does not corrupt saved alerts.

Every new alert in `alerts.json` includes:

- `telegramUserId`: the Telegram user who owns the alert
- `chatId`: the private chat where alert messages should be sent

Users can only list, edit, pause, resume, delete, and manually check their own alerts.

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
2. The stored Massive option contract ticker is checked with the options aggregate bars endpoint.
3. The selected alert price is chosen:
   - latest returned aggregate bar `vw`
   - otherwise the alert is skipped for that cycle
4. Change from entry is calculated.
5. The condition is evaluated.
6. If crossed and `triggerState` is `armed`, a Telegram alert is sent and the alert becomes `triggered`.

For manual checks only, skipped alerts may also show the last available aggregate VW from the prior `LAST_AVAILABLE_LOOKBACK_DAYS`. This is informational and is not used for alert evaluation.

Re-arming uses hysteresis:

- Percent alerts: 5 percentage points
- Dollar-change alerts: 10% of threshold or $0.05 minimum
- Target-price alerts: 1% of target price or $0.05 minimum

Example: an alert for `above +25%` triggers at `+25%` and will not re-arm until the change falls to `+20%` or lower.

## Massive.com API

The app uses:

- `GET /v3/reference/options/contracts` for contracts, expiries, strikes, and final contract resolution.
- `GET /v2/aggs/ticker/{optionContract}/range/{multiplier}/minute/{from}/{to}` for monitoring.
- `GET /v3/snapshot/options/{underlyingAsset}` only as a setup helper when trying to estimate nearby strikes.

Massive response mapping is isolated in `src/massive/client.js`. If Massive changes field names, adjust that file first.

## Important Options Warning

Options prices can be delayed, illiquid, stale, or unavailable. Aggregate bars only exist when qualifying trades occur, so thinly traded contracts may have no usable `vw` in the lookback window. This bot is an alerting tool, not trading advice or an execution system.
