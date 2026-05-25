class MassiveApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MassiveApiError";
    this.statusCode = details.statusCode || null;
    this.body = details.body || null;
    this.url = details.url || null;
  }
}

class MassiveClient {
  constructor({ apiKey, baseUrl = "https://api.massive.com" }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getExpirationDates(underlyingSymbol, contractType) {
    const contracts = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: normalizeTicker(underlyingSymbol),
      contract_type: contractType,
      expired: "false",
      order: "asc",
      sort: "expiration_date",
      limit: "1000"
    });

    return Array.from(new Set(
      contracts.map(normalizeContract).map((contract) => contract.expirationDate).filter(Boolean)
    )).sort();
  }

  async getStrikesForExpiry(underlyingSymbol, contractType, expirationDate) {
    const contracts = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: normalizeTicker(underlyingSymbol),
      contract_type: contractType,
      expiration_date: expirationDate,
      expired: "false",
      order: "asc",
      sort: "strike_price",
      limit: "1000"
    });

    return Array.from(new Set(
      contracts
        .map(normalizeContract)
        .map((contract) => contract.strikePrice)
        .filter((strike) => Number.isFinite(strike) && strike > 0)
    )).sort((a, b) => a - b);
  }

  async resolveOptionContract(underlyingSymbol, contractType, expirationDate, strikePrice) {
    const contracts = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: normalizeTicker(underlyingSymbol),
      contract_type: contractType,
      expiration_date: expirationDate,
      strike_price: String(strikePrice),
      expired: "false",
      order: "asc",
      sort: "ticker",
      limit: "1000"
    });

    const expectedStrike = Number(strikePrice);
    return contracts
      .map(normalizeContract)
      .filter((contract) => (
        contract.ticker &&
        contract.underlyingTicker === normalizeTicker(underlyingSymbol) &&
        contract.contractType === contractType &&
        contract.expirationDate === expirationDate &&
        Math.abs(contract.strikePrice - expectedStrike) < 0.000001
      ));
  }

  async getOptionSnapshot(underlyingSymbol, optionContract) {
    const response = await this.request(
      `/v3/snapshot/options/${encodeURIComponent(normalizeTicker(underlyingSymbol))}/${encodeURIComponent(optionContract)}`
    );
    return normalizeSnapshot(response.results || response);
  }

  async getAggregates(optionContract, params) {
    const multiplier = params.multiplier || 1;
    const timespan = params.timespan || "day";
    const from = params.from;
    const to = params.to;

    const response = await this.request(
      `/v2/aggs/ticker/${encodeURIComponent(optionContract)}/range/${encodeURIComponent(multiplier)}/${encodeURIComponent(timespan)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
      {
        adjusted: "true",
        sort: "asc",
        limit: "50000"
      }
    );

    const rows = Array.isArray(response.results) ? response.results : [];
    return {
      status: response.status || null,
      queryCount: response.queryCount || response.query_count || rows.length,
      resultsCount: response.resultsCount || response.results_count || rows.length,
      rows: rows.map(normalizeAggregate)
    };
  }

  async getAllPages(pathOrUrl, params = {}) {
    const allResults = [];
    let nextUrl = pathOrUrl;
    let nextParams = params;
    let pages = 0;

    while (nextUrl) {
      pages += 1;
      if (pages > 100) {
        throw new MassiveApiError("Stopped Massive pagination after 100 pages", { url: nextUrl });
      }

      const response = await this.request(nextUrl, nextParams);
      const results = Array.isArray(response.results) ? response.results : [];
      allResults.push(...results);
      nextUrl = response.next_url || response.nextUrl || null;
      nextParams = {};
    }

    return allResults;
  }

  async request(pathOrUrl, params = {}) {
    const url = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, this.baseUrl);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    if (!url.searchParams.has("apiKey")) {
      url.searchParams.set("apiKey", this.apiKey);
    }

    let response;
    try {
      response = await fetch(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new MassiveApiError(`Massive request failed: ${error.message}`, {
        url: safeUrl(url)
      });
    }

    const bodyText = await response.text();
    let body = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }

    if (!response.ok) {
      throw new MassiveApiError(`Massive API returned HTTP ${response.status}`, {
        statusCode: response.status,
        body,
        url: safeUrl(url)
      });
    }

    return body || {};
  }
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getFirstValue(object, keys) {
  if (!object || typeof object !== "object") return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return undefined;
}

function normalizeContract(raw) {
  return {
    ticker: getFirstValue(raw, ["ticker"]) || null,
    underlyingTicker: normalizeTicker(getFirstValue(raw, ["underlying_ticker", "underlyingTicker"])),
    contractType: getFirstValue(raw, ["contract_type", "contractType"]) || null,
    expirationDate: getFirstValue(raw, ["expiration_date", "expirationDate"]) || null,
    strikePrice: toNumber(getFirstValue(raw, ["strike_price", "strikePrice"])),
    raw
  };
}

function normalizeAggregate(raw) {
  const timestamp = toNumber(getFirstValue(raw, ["t", "timestamp"]));
  const open = toNumber(getFirstValue(raw, ["o", "open"]));
  const high = toNumber(getFirstValue(raw, ["h", "high"]));
  const low = toNumber(getFirstValue(raw, ["l", "low"]));
  const close = toNumber(getFirstValue(raw, ["c", "close"]));

  return {
    timestamp,
    datetime: timestamp ? new Date(timestamp).toISOString() : null,
    open,
    high,
    low,
    last: close,
    close,
    volume: toNumber(getFirstValue(raw, ["v", "volume"])),
    vwap: toNumber(getFirstValue(raw, ["vw", "vwap"])),
    transactions: toNumber(getFirstValue(raw, ["n", "transactions"])),
    raw
  };
}

function normalizeSnapshot(raw) {
  const greeksRaw = getFirstValue(raw, ["greeks"]) || {};
  const dayRaw = getFirstValue(raw, ["day"]) || {};
  const openInterestRaw = getFirstValue(raw, ["open_interest", "openInterest"]);
  const impliedVolatilityRaw = getFirstValue(raw, ["implied_volatility", "impliedVolatility"]);

  return {
    delta: toNumber(getFirstValue(greeksRaw, ["delta"])),
    gamma: toNumber(getFirstValue(greeksRaw, ["gamma"])),
    theta: toNumber(getFirstValue(greeksRaw, ["theta"])),
    vega: toNumber(getFirstValue(greeksRaw, ["vega"])),
    impliedVolatility: toNumber(impliedVolatilityRaw),
    openInterest: toNumber(openInterestRaw),
    dayVolume: toNumber(getFirstValue(dayRaw, ["volume", "v"])),
    dayClose: toNumber(getFirstValue(dayRaw, ["close", "c"])),
    raw
  };
}

function safeUrl(url) {
  const safe = new URL(url.toString());
  if (safe.searchParams.has("apiKey")) {
    safe.searchParams.set("apiKey", "REDACTED");
  }
  return safe.toString();
}

module.exports = {
  MassiveClient,
  MassiveApiError,
  normalizeContract,
  normalizeAggregate,
  normalizeSnapshot
};
