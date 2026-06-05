const { getFirstValue, marketTimestampToMs, toNumber } = require("./types");

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
  constructor({ apiKey, logger, baseUrl = "https://api.massive.com" }) {
    this.apiKey = apiKey;
    this.logger = logger;
    this.baseUrl = baseUrl;
  }

  async getContractsForUnderlying(underlyingSymbol, contractType) {
    const results = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: underlyingSymbol.toUpperCase(),
      contract_type: contractType,
      expired: "false",
      order: "asc",
      sort: "expiration_date",
      limit: "1000"
    });

    return results.map(normalizeContract).filter((contract) => contract.ticker);
  }

  async getExpirationDates(underlyingSymbol, contractType) {
    const contracts = await this.getContractsForUnderlying(underlyingSymbol, contractType);
    return Array.from(new Set(contracts.map((contract) => contract.expirationDate).filter(Boolean))).sort();
  }

  async getStrikesForExpiry(underlyingSymbol, contractType, expirationDate) {
    const results = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: underlyingSymbol.toUpperCase(),
      contract_type: contractType,
      expiration_date: expirationDate,
      expired: "false",
      order: "asc",
      sort: "strike_price",
      limit: "1000"
    });

    const strikes = results
      .map(normalizeContract)
      .map((contract) => contract.strikePrice)
      .filter((strike) => Number.isFinite(strike) && strike > 0);

    return Array.from(new Set(strikes)).sort((a, b) => a - b);
  }

  async resolveOptionContract(underlyingSymbol, contractType, expirationDate, strikePrice) {
    const results = await this.getAllPages("/v3/reference/options/contracts", {
      underlying_ticker: underlyingSymbol.toUpperCase(),
      contract_type: contractType,
      expiration_date: expirationDate,
      strike_price: String(strikePrice),
      expired: "false",
      order: "asc",
      sort: "ticker",
      limit: "1000"
    });

    const expectedStrike = Number(strikePrice);
    return results
      .map(normalizeContract)
      .filter((contract) => {
        const sameUnderlying = contract.underlyingTicker === underlyingSymbol.toUpperCase();
        const sameType = contract.contractType === contractType;
        const sameExpiry = contract.expirationDate === expirationDate;
        const sameStrike = Math.abs(contract.strikePrice - expectedStrike) < 0.000001;
        return contract.ticker && sameUnderlying && sameType && sameExpiry && sameStrike;
      });
  }

  async getOptionSnapshot(underlyingSymbol, optionContract) {
    const underlying = encodeURIComponent(underlyingSymbol.toUpperCase());
    const contract = encodeURIComponent(optionContract);
    const response = await this.request(`/v3/snapshot/options/${underlying}/${contract}`);
    return normalizeSnapshot(response.results || response);
  }

  async getRecentAggregateBars(optionContract, options = {}) {
    const nowMs = options.nowMs || Date.now();
    const delayMinutes = options.delayMinutes || 16;
    const lookbackMinutes = options.lookbackMinutes || 60;
    const barMinutes = options.barMinutes || 5;
    const barMs = barMinutes * 60 * 1000;
    const cutoffMs = nowMs - (delayMinutes * 60 * 1000);
    const toMs = Math.floor((cutoffMs - barMs) / barMs) * barMs;
    const fromMs = toMs - (lookbackMinutes * 60 * 1000);

    const response = await this.request(
      `/v2/aggs/ticker/${encodeURIComponent(optionContract)}/range/${encodeURIComponent(barMinutes)}/minute/${encodeURIComponent(fromMs)}/${encodeURIComponent(toMs)}`,
      {
        adjusted: "true",
        sort: "asc",
        limit: "50000"
      }
    );

    const rows = Array.isArray(response.results)
      ? response.results.map(normalizeAggregate).filter((row) => (
        Number.isFinite(row.timestampMs) &&
        row.timestampMs >= fromMs &&
        row.timestampMs <= toMs
      ))
      : [];

    return {
      status: response.status || null,
      queryCount: response.queryCount || response.query_count || rows.length,
      resultsCount: response.resultsCount || response.results_count || rows.length,
      range: {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        fromMs,
        toMs,
        delayMinutes,
        lookbackMinutes,
        barMinutes
      },
      rows,
      latestBar: rows[rows.length - 1] || null
    };
  }

  async getUnderlyingPriceHint(underlyingSymbol, contractType, expirationDate) {
    try {
      const response = await this.request(`/v3/snapshot/options/${encodeURIComponent(underlyingSymbol.toUpperCase())}`, {
        contract_type: contractType,
        expiration_date: expirationDate,
        order: "asc",
        sort: "ticker",
        limit: "10"
      });

      const snapshots = Array.isArray(response.results) ? response.results : [];
      for (const rawSnapshot of snapshots) {
        const snapshot = normalizeSnapshot(rawSnapshot);
        if (Number.isFinite(snapshot.underlyingAsset.price) && snapshot.underlyingAsset.price > 0) {
          return snapshot.underlyingAsset.price;
        }
      }
    } catch (error) {
      this.logger.debug({ underlyingSymbol, contractType, expirationDate, error }, "Could not fetch underlying price hint");
    }

    return null;
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
      response = await fetch(url, {
        headers: {
          accept: "application/json"
        }
      });
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

    if (body && typeof body === "object" && body.status && !["OK", "DELAYED", "SUCCESS"].includes(String(body.status).toUpperCase())) {
      throw new MassiveApiError(`Massive API status: ${body.status}`, {
        body,
        url: safeUrl(url)
      });
    }

    return body || {};
  }
}

function safeUrl(url) {
  const safe = new URL(url.toString());
  if (safe.searchParams.has("apiKey")) {
    safe.searchParams.set("apiKey", "REDACTED");
  }
  return safe.toString();
}

function normalizeContract(raw) {
  const strikePrice = toNumber(getFirstValue(raw, ["strike_price", "strikePrice"]));
  const ticker = getFirstValue(raw, ["ticker"]);
  const underlyingTicker = getFirstValue(raw, ["underlying_ticker", "underlyingTicker"]);
  const contractType = getFirstValue(raw, ["contract_type", "contractType"]);
  const expirationDate = getFirstValue(raw, ["expiration_date", "expirationDate"]);

  return {
    ticker: ticker || null,
    underlyingTicker: underlyingTicker ? String(underlyingTicker).toUpperCase() : null,
    contractType: contractType || null,
    expirationDate: expirationDate || null,
    strikePrice,
    exerciseStyle: getFirstValue(raw, ["exercise_style", "exerciseStyle"]) || null,
    primaryExchange: getFirstValue(raw, ["primary_exchange", "primaryExchange"]) || null,
    raw
  };
}

function normalizeAggregate(raw) {
  const timestampMs = toNumber(getFirstValue(raw, ["t", "timestamp"]));

  return {
    timestampMs,
    datetime: timestampMs ? new Date(timestampMs).toISOString() : null,
    open: toNumber(getFirstValue(raw, ["o", "open"])),
    high: toNumber(getFirstValue(raw, ["h", "high"])),
    low: toNumber(getFirstValue(raw, ["l", "low"])),
    close: toNumber(getFirstValue(raw, ["c", "close"])),
    volume: toNumber(getFirstValue(raw, ["v", "volume"])),
    vwap: toNumber(getFirstValue(raw, ["vw", "vwap"])),
    transactions: toNumber(getFirstValue(raw, ["n", "transactions"])),
    raw
  };
}

function normalizeSnapshot(raw) {
  const detailsRaw = getFirstValue(raw, ["details"]) || {};
  const tradeRaw = getFirstValue(raw, ["last_trade", "lastTrade"]) || {};
  const quoteRaw = getFirstValue(raw, ["last_quote", "lastQuote"]) || {};
  const underlyingRaw = getFirstValue(raw, ["underlying_asset", "underlyingAsset"]) || {};

  const tradeTimestamp = getFirstValue(tradeRaw, [
    "sip_timestamp",
    "sipTimestamp",
    "last_updated",
    "lastUpdated",
    "participant_timestamp",
    "participantTimestamp",
    "trf_timestamp",
    "trfTimestamp"
  ]);

  const quoteTimestamp = getFirstValue(quoteRaw, [
    "last_updated",
    "lastUpdated",
    "sip_timestamp",
    "sipTimestamp"
  ]);

  const bid = toNumber(getFirstValue(quoteRaw, ["bid", "bp", "bid_price", "bidPrice"]));
  const ask = toNumber(getFirstValue(quoteRaw, ["ask", "ap", "ask_price", "askPrice"]));

  return {
    raw,
    details: {
      ticker: getFirstValue(detailsRaw, ["ticker"]) || getFirstValue(raw, ["ticker"]) || null,
      contractType: getFirstValue(detailsRaw, ["contract_type", "contractType"]) || null,
      expirationDate: getFirstValue(detailsRaw, ["expiration_date", "expirationDate"]) || null,
      strikePrice: toNumber(getFirstValue(detailsRaw, ["strike_price", "strikePrice"]))
    },
    lastTrade: {
      price: toNumber(getFirstValue(tradeRaw, ["price", "p"])),
      size: toNumber(getFirstValue(tradeRaw, ["size", "s"])),
      timestampMs: marketTimestampToMs(tradeTimestamp),
      timestampRaw: tradeTimestamp || null,
      timeframe: getFirstValue(tradeRaw, ["timeframe"]) || null,
      raw: tradeRaw
    },
    lastQuote: {
      bid,
      ask,
      midpoint: toNumber(getFirstValue(quoteRaw, ["midpoint", "mid"])),
      timestampMs: marketTimestampToMs(quoteTimestamp),
      timestampRaw: quoteTimestamp || null,
      timeframe: getFirstValue(quoteRaw, ["timeframe"]) || null,
      raw: quoteRaw
    },
    underlyingAsset: {
      ticker: getFirstValue(underlyingRaw, ["ticker"]) || null,
      price: toNumber(getFirstValue(underlyingRaw, ["price"])),
      timestampMs: marketTimestampToMs(getFirstValue(underlyingRaw, ["last_updated", "lastUpdated"])),
      timeframe: getFirstValue(underlyingRaw, ["timeframe"]) || null,
      raw: underlyingRaw
    },
    marketStatus: getFirstValue(raw, ["market_status", "marketStatus"]) || null
  };
}

module.exports = {
  MassiveClient,
  MassiveApiError,
  normalizeContract,
  normalizeAggregate,
  normalizeSnapshot
};
