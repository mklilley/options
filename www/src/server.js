const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { loadEnv } = require("./env");
const { JsonCache } = require("./cache");
const { MassiveClient, MassiveApiError } = require("./massiveClient");

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;
const CONTRACT_TYPES = new Set(["call", "put"]);
const TIMESPANS = new Set(["minute", "hour", "day", "week", "month"]);

async function main() {
  const config = loadEnv();
  const cache = new JsonCache({ cacheDir: config.cacheDir });
  const massiveClient = new MassiveClient({ apiKey: config.massiveApiKey });

  await runCacheCleanup(cache, config);

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { config, cache, massiveClient });
    } catch (error) {
      sendError(res, error);
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`Options history web app listening on http://${config.host}:${config.port}${config.basePath || ""}/`);
  });
}

async function runCacheCleanup(cache, config) {
  try {
    const summary = await cache.cleanup({ maxAgeDays: config.cacheCleanupMaxAgeDays });
    if (summary.deleted > 0) {
      console.log(
        `Cache cleanup deleted ${summary.deleted} file(s): ` +
        `${summary.expired} expired, ${summary.tooOld} older than ${config.cacheCleanupMaxAgeDays} days, ${summary.invalid} invalid`
      );
    }
    if (summary.errors > 0) {
      console.warn(`Cache cleanup skipped ${summary.errors} file(s) because they could not be deleted`);
    }
  } catch (error) {
    console.warn(`Cache cleanup failed: ${error.message}`);
  }
}

async function handleRequest(req, res, context) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const routeUrl = routeUrlForBasePath(url, context.config.basePath);

  if (!routeUrl) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (routeUrl.redirectTo) {
    res.writeHead(302, { location: routeUrl.redirectTo });
    res.end();
    return;
  }

  if (routeUrl.pathname.startsWith("/api/")) {
    await handleApi(req, res, routeUrl, context);
    return;
  }

  await serveStatic(res, context.config.publicDir, routeUrl.pathname);
}

function routeUrlForBasePath(url, basePath) {
  const routeUrl = new URL(url);
  if (!basePath) return routeUrl;

  if (url.pathname === basePath) {
    return {
      redirectTo: `${basePath}/${url.search || ""}`
    };
  }

  if (!url.pathname.startsWith(`${basePath}/`)) {
    return null;
  }

  routeUrl.pathname = url.pathname.slice(basePath.length) || "/";
  return routeUrl;
}

async function handleApi(req, res, url, context) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Only GET is supported" });
    return;
  }

  if (url.pathname === "/api/expirations") {
    const params = getReferenceParams(url);
    const result = await context.cache.getOrSet(
      "expirations",
      params,
      hours(6),
      () => context.massiveClient.getExpirationDates(params.underlyingSymbol, params.contractType)
    );
    sendJson(res, 200, { expirations: result.data, cache: result.cache });
    return;
  }

  if (url.pathname === "/api/strikes") {
    const params = getStrikeParams(url);
    const result = await context.cache.getOrSet(
      "strikes",
      params,
      hours(6),
      () => context.massiveClient.getStrikesForExpiry(params.underlyingSymbol, params.contractType, params.expirationDate)
    );
    sendJson(res, 200, { strikes: result.data, cache: result.cache });
    return;
  }

  if (url.pathname === "/api/resolve") {
    const params = getResolveParams(url);
    const result = await context.cache.getOrSet(
      "resolve",
      params,
      hours(24),
      () => context.massiveClient.resolveOptionContract(
        params.underlyingSymbol,
        params.contractType,
        params.expirationDate,
        params.strikePrice
      )
    );
    sendJson(res, 200, { contracts: result.data, cache: result.cache });
    return;
  }

  if (url.pathname === "/api/history") {
    const payload = await getHistoryPayload(url, context);
    sendJson(res, 200, payload);
    return;
  }

  if (url.pathname === "/api/history.csv") {
    const payload = await getHistoryPayload(url, context);
    const csv = toCsv(payload);
    const fileName = `${payload.contract.optionContract.replace(/[^A-Z0-9.-]/gi, "_")}_${payload.range.from}_${payload.range.to}.csv`;
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`
    });
    res.end(csv);
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function getHistoryPayload(url, context) {
  const params = getHistoryParams(url);
  const resolved = await resolveContract(params, context);
  const optionContract = params.optionContract || resolved.contracts[0].ticker;

  const historyParams = {
    optionContract,
    multiplier: params.multiplier,
    timespan: params.timespan,
    from: params.from,
    to: params.to
  };

  const ttl = rangeEndsBeforeToday(params.to)
    ? days(30)
    : minutes(context.config.cacheTtlMinutes);

  const history = await context.cache.getOrSet(
    "history",
    historyParams,
    ttl,
    () => context.massiveClient.getAggregates(optionContract, historyParams)
  );

  let snapshot = null;
  let snapshotError = null;
  try {
    const snapshotResult = await context.cache.getOrSet(
      "snapshot",
      { underlyingSymbol: params.underlyingSymbol, optionContract },
      minutes(Math.min(context.config.cacheTtlMinutes, 15)),
      () => context.massiveClient.getOptionSnapshot(params.underlyingSymbol, optionContract)
    );
    snapshot = snapshotResult.data;
  } catch (error) {
    snapshotError = error.message;
  }

  return {
    contract: {
      underlyingSymbol: params.underlyingSymbol,
      contractType: params.contractType || (resolved.contracts[0] && resolved.contracts[0].contractType) || null,
      expirationDate: params.expirationDate || (resolved.contracts[0] && resolved.contracts[0].expirationDate) || null,
      strikePrice: params.strikePrice || (resolved.contracts[0] && resolved.contracts[0].strikePrice) || null,
      optionContract
    },
    range: {
      from: params.from,
      to: params.to,
      multiplier: params.multiplier,
      timespan: params.timespan
    },
    bars: history.data.rows,
    resultMeta: {
      status: history.data.status,
      queryCount: history.data.queryCount,
      resultsCount: history.data.resultsCount
    },
    snapshot,
    snapshotError,
    cache: {
      history: history.cache,
      resolved: resolved.cache
    }
  };
}

async function resolveContract(params, context) {
  if (params.optionContract) {
    return {
      contracts: [{
        ticker: params.optionContract,
        underlyingTicker: params.underlyingSymbol,
        contractType: params.contractType || null,
        expirationDate: params.expirationDate || null,
        strikePrice: params.strikePrice || null
      }],
      cache: null
    };
  }

  const resolveParams = {
    underlyingSymbol: params.underlyingSymbol,
    contractType: params.contractType,
    expirationDate: params.expirationDate,
    strikePrice: params.strikePrice
  };

  const result = await context.cache.getOrSet(
    "resolve",
    resolveParams,
    hours(24),
    () => context.massiveClient.resolveOptionContract(
      resolveParams.underlyingSymbol,
      resolveParams.contractType,
      resolveParams.expirationDate,
      resolveParams.strikePrice
    )
  );

  if (!Array.isArray(result.data) || result.data.length === 0) {
    throw badRequest("No option contract found for that ticker, type, expiry, and strike");
  }

  if (result.data.length > 1) {
    throw badRequest("More than one option contract matched; pass optionContract directly");
  }

  return {
    contracts: result.data,
    cache: result.cache
  };
}

async function serveStatic(res, publicDir, requestPath) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(publicDir, `.${decodeURIComponent(safePath)}`);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": mimeType(filePath) });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function getReferenceParams(url) {
  const underlyingSymbol = normalizeTicker(required(url, "underlyingSymbol"));
  const contractType = required(url, "contractType");

  validateTicker(underlyingSymbol);
  validateContractType(contractType);

  return { underlyingSymbol, contractType };
}

function getStrikeParams(url) {
  return {
    ...getReferenceParams(url),
    expirationDate: validateDate(required(url, "expirationDate"), "expirationDate")
  };
}

function getResolveParams(url) {
  return {
    ...getStrikeParams(url),
    strikePrice: validatePositiveNumber(required(url, "strikePrice"), "strikePrice")
  };
}

function getHistoryParams(url) {
  const optionContract = optional(url, "optionContract");
  const underlyingSymbol = normalizeTicker(required(url, "underlyingSymbol"));
  const contractType = optional(url, "contractType") || null;
  const expirationDate = optional(url, "expirationDate") || null;
  const strikePriceRaw = optional(url, "strikePrice");
  const from = validateDate(optional(url, "from") || defaultFromDate(), "from");
  const to = validateDate(optional(url, "to") || today(), "to");
  const timespan = optional(url, "timespan") || "day";
  const multiplier = validatePositiveInteger(optional(url, "multiplier") || "1", "multiplier");

  validateTicker(underlyingSymbol);
  validateTimespan(timespan);

  if (new Date(from) > new Date(to)) {
    throw badRequest("from must be before or equal to to");
  }

  if (!optionContract) {
    if (!contractType || !expirationDate || !strikePriceRaw) {
      throw badRequest("contractType, expirationDate, and strikePrice are required when optionContract is not provided");
    }
    validateContractType(contractType);
  }

  return {
    underlyingSymbol,
    optionContract: optionContract || null,
    contractType,
    expirationDate: expirationDate ? validateDate(expirationDate, "expirationDate") : null,
    strikePrice: strikePriceRaw ? validatePositiveNumber(strikePriceRaw, "strikePrice") : null,
    from,
    to,
    timespan,
    multiplier
  };
}

function required(url, name) {
  const value = optional(url, name);
  if (!value) throw badRequest(`${name} is required`);
  return value;
}

function optional(url, name) {
  const value = url.searchParams.get(name);
  return value === null ? null : value.trim();
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function validateTicker(value) {
  if (!TICKER_PATTERN.test(value)) {
    throw badRequest("underlyingSymbol must be a valid ticker");
  }
}

function validateContractType(value) {
  if (!CONTRACT_TYPES.has(value)) {
    throw badRequest("contractType must be call or put");
  }
}

function validateTimespan(value) {
  if (!TIMESPANS.has(value)) {
    throw badRequest("timespan must be minute, hour, day, week, or month");
  }
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${name} must be YYYY-MM-DD`);
  }
  return value;
}

function validatePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest(`${name} must be a positive number`);
  }
  return number;
}

function validatePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest(`${name} must be a positive integer`);
  }
  return number;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendError(res, error) {
  const statusCode = error.statusCode || (error instanceof MassiveApiError ? 502 : 500);
  const payload = {
    error: error.message || "Internal server error"
  };

  if (error instanceof MassiveApiError) {
    payload.massiveStatusCode = error.statusCode;
    payload.massiveBody = error.body;
  }

  console.error(error);
  sendJson(res, statusCode, payload);
}

function toCsv(payload) {
  const snapshot = payload.snapshot || {};
  const columns = [
    "optionContract",
    "underlyingSymbol",
    "contractType",
    "expirationDate",
    "strikePrice",
    "timestamp",
    "datetime",
    "open",
    "high",
    "low",
    "last",
    "volume",
    "vwap",
    "transactions",
    "snapshot_delta",
    "snapshot_gamma",
    "snapshot_theta",
    "snapshot_vega",
    "snapshot_implied_volatility",
    "snapshot_open_interest"
  ];

  const rows = payload.bars.map((bar) => ({
    optionContract: payload.contract.optionContract,
    underlyingSymbol: payload.contract.underlyingSymbol,
    contractType: payload.contract.contractType,
    expirationDate: payload.contract.expirationDate,
    strikePrice: payload.contract.strikePrice,
    timestamp: bar.timestamp,
    datetime: bar.datetime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    last: bar.last,
    volume: bar.volume,
    vwap: bar.vwap,
    transactions: bar.transactions,
    snapshot_delta: snapshot.delta,
    snapshot_gamma: snapshot.gamma,
    snapshot_theta: snapshot.theta,
    snapshot_vega: snapshot.vega,
    snapshot_implied_volatility: snapshot.impliedVolatility,
    snapshot_open_interest: snapshot.openInterest
  }));

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[ext] || "application/octet-stream";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFromDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

function rangeEndsBeforeToday(to) {
  return to < today();
}

function minutes(value) {
  return value * 60 * 1000;
}

function hours(value) {
  return minutes(value * 60);
}

function days(value) {
  return hours(value * 24);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  main
};
