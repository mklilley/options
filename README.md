# Options

Two small plain JavaScript tools for working with options data from Massive.com.

## Projects

- `alerts/` - Telegram bot for saved option price alerts.
- `www/` - Local web app for looking up historical option aggregate prices, charting them, caching repeated requests, and exporting CSV.

Both projects are intentionally simple and independent. Each folder has its own `package.json`, `.env.example`, and README.

## Run The Telegram Bot

```sh
cd alerts
npm install
cp .env.example .env
npm start
```

See [alerts/README.md](alerts/README.md) for setup, Telegram allowlist behavior, JSON storage, polling, and pm2 notes.

## Run The Web App

```sh
cd www
cp .env.example .env
npm start
```

Then open:

```text
http://127.0.0.1:3001
```

See [www/README.md](www/README.md) for cache behavior, API usage, and CSV export notes.

## Local Folder Name

The repo is structured as `options`. If your local checkout folder is still named `options-alert`, rename that folder from its parent directory when convenient.
