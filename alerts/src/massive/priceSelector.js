const { isPositiveNumber } = require("./types");
const { minutesSince } = require("../utils/dates");

function selectAlertPrice(snapshot, options = {}) {
  const staleTradeMaxMinutes = options.staleTradeMaxMinutes || 30;
  const nowMs = options.nowMs || Date.now();

  const trade = snapshot.lastTrade || {};
  const quote = snapshot.lastQuote || {};
  const lastTradePrice = trade.price;
  const bid = quote.bid;
  const ask = quote.ask;

  if (isPositiveNumber(lastTradePrice)) {
    const ageMinutes = trade.timestampMs ? minutesSince(trade.timestampMs, nowMs) : null;
    const hasTimestamp = Number.isFinite(ageMinutes);

    if (!hasTimestamp || ageMinutes <= staleTradeMaxMinutes) {
      return {
        source: "last_trade",
        price: lastTradePrice,
        available: true,
        reason: null,
        bid,
        ask,
        lastTradePrice,
        lastTradeAt: trade.timestampMs ? new Date(trade.timestampMs).toISOString() : null,
        quoteAt: quote.timestampMs ? new Date(quote.timestampMs).toISOString() : null
      };
    }
  }

  if (isPositiveNumber(bid) && isPositiveNumber(ask)) {
    return {
      source: "mid_bid_ask",
      price: (bid + ask) / 2,
      available: true,
      reason: isPositiveNumber(lastTradePrice) ? "latest trade is stale" : "latest trade is missing",
      bid,
      ask,
      lastTradePrice: isPositiveNumber(lastTradePrice) ? lastTradePrice : null,
      lastTradeAt: trade.timestampMs ? new Date(trade.timestampMs).toISOString() : null,
      quoteAt: quote.timestampMs ? new Date(quote.timestampMs).toISOString() : null
    };
  }

  return {
    source: "unavailable",
    price: null,
    available: false,
    reason: buildUnavailableReason(trade, quote, staleTradeMaxMinutes, nowMs),
    bid,
    ask,
    lastTradePrice: isPositiveNumber(lastTradePrice) ? lastTradePrice : null,
    lastTradeAt: trade.timestampMs ? new Date(trade.timestampMs).toISOString() : null,
    quoteAt: quote.timestampMs ? new Date(quote.timestampMs).toISOString() : null
  };
}

function selectAggregateVwPrice(aggregateBars) {
  const latestBar = aggregateBars && aggregateBars.latestBar;

  if (!latestBar) {
    return {
      source: "unavailable",
      price: null,
      available: false,
      reason: "no aggregate bars returned for the lookback window",
      aggregateRange: aggregateBars ? aggregateBars.range : null
    };
  }

  if (!isPositiveNumber(latestBar.vwap)) {
    return {
      source: "unavailable",
      price: null,
      available: false,
      reason: "latest aggregate bar has no positive VW price",
      aggregateRange: aggregateBars.range,
      aggregateBarAt: latestBar.datetime,
      aggregateBarClose: latestBar.close,
      aggregateBarVolume: latestBar.volume,
      aggregateBarTransactions: latestBar.transactions
    };
  }

  return {
    source: "aggregate_vw",
    price: latestBar.vwap,
    available: true,
    reason: null,
    bid: null,
    ask: null,
    lastTradePrice: null,
    aggregateRange: aggregateBars.range,
    aggregateBarAt: latestBar.datetime,
    aggregateBarOpen: latestBar.open,
    aggregateBarHigh: latestBar.high,
    aggregateBarLow: latestBar.low,
    aggregateBarClose: latestBar.close,
    aggregateBarVolume: latestBar.volume,
    aggregateBarTransactions: latestBar.transactions
  };
}

function buildUnavailableReason(trade, quote, staleTradeMaxMinutes, nowMs) {
  const reasons = [];

  if (!isPositiveNumber(trade.price)) {
    reasons.push("latest trade missing");
  } else if (trade.timestampMs) {
    const ageMinutes = minutesSince(trade.timestampMs, nowMs);
    if (ageMinutes > staleTradeMaxMinutes) {
      reasons.push(`latest trade stale (${Math.round(ageMinutes)} minutes old)`);
    }
  }

  if (!isPositiveNumber(quote.bid) || !isPositiveNumber(quote.ask)) {
    reasons.push("bid/ask missing or not positive");
  }

  return reasons.join("; ") || "no usable price";
}

module.exports = {
  selectAlertPrice,
  selectAggregateVwPrice
};
