# Options History Web

Plain JavaScript web app for inspecting historical option prices from Massive.com.

The app is separate from the Telegram bot. It runs a small Node.js server that serves the browser UI and proxies Massive API requests so the API key is never sent to the browser.

The `www/` folder is self-contained and can be moved into its own repo later.

## Why REST API Plus Cache

For this interactive workflow, REST is the best starting point:

- You choose one ticker, option type, expiry, strike, and date range at a time.
- The app only fetches the contracts and bars needed for that view.
- Responses are cached locally so repeated requests do not hit Massive again.

Flat files are better when you want bulk offline research, large backtests, or full-market historical scans.

## Setup

The web app reads `MASSIVE_API_KEY` from `www/.env`.

Optional `www/.env`:

```sh
cp .env.example .env
```

```env
MASSIVE_API_KEY=
HOST=127.0.0.1
PORT=3001
BASE_PATH=
CACHE_DIR=./cache
CACHE_TTL_MINUTES=60
```

Use `BASE_PATH` when the Node app is reverse-proxied under a URL prefix:

```env
BASE_PATH=/options
```

## Run

From this folder:

```sh
npm start
```

Development mode:

```sh
npm run dev
```

Open:

```text
http://localhost:3001
```

If you set `BASE_PATH=/options`, open:

```text
http://localhost:3001/options/
```

Do not deploy `www/public` by itself for the full app. The HTML may load, but the API routes need the Node server because Massive requests and caching happen server-side.

## Run With pm2

From this folder:

```sh
pm2 start src/server.js --name options-www
pm2 save
pm2 logs options-www
```

Restart after changing `.env`:

```sh
pm2 restart options-www --update-env
```

Stop and remove it:

```sh
pm2 stop options-www
pm2 delete options-www
pm2 save
```

For a subpath deployment, set `BASE_PATH` in `.env` before starting:

```env
HOST=127.0.0.1
PORT=3003
BASE_PATH=/options
```

## Deploy Under A Subpath

For a URL like:

```text
https://dev.lilley.io/options/
```

set:

```env
HOST=127.0.0.1
PORT=3003
BASE_PATH=/options
```

Then run the Node app and reverse proxy that path to it. Example Nginx shape:

```nginx
location = /options {
  return 301 /options/;
}

location /options/ {
  proxy_pass http://127.0.0.1:3003;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

The public URL should be `/options/`, not `/options/www/public/`. The `public/` folder is an implementation detail served by the Node app.

## What It Fetches

- Option expiries, strikes, and exact option contract tickers use `GET /v3/reference/options/contracts`.
- Historical prices use aggregate bars for the resolved option ticker.
- The chart uses aggregate close as the historical last price.
- Current snapshot Greeks are fetched when available and included in the CSV as `snapshot_*` columns.

Massive aggregate bars do not provide historical Greeks per bar. If you need historical delta/gamma/theta/vega for every timestamp, that needs a different data source or a derived options model.

## Cache

Cache files are written to `www/cache/`.

- Reference data is cached for a few hours.
- Contract resolution is cached for a day.
- Historical ranges ending before today are cached for longer.
- Ranges including today use `CACHE_TTL_MINUTES`.

The cache is local JSON and can be deleted safely.
