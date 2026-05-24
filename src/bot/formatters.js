const {
  formatDateTime
} = require("../utils/dates");
const {
  formatMoney,
  formatPercent,
  formatSignedMoney,
  formatStrike
} = require("../utils/money");

function optionTitle(alert) {
  const side = alert.contractType === "call" ? "C" : "P";
  return `${alert.underlyingSymbol} ${formatStrike(alert.strikePrice)}${side} ${alert.expirationDate}`;
}

function sourceLabel(source) {
  if (source === "last_trade") return "last trade";
  if (source === "mid_bid_ask") return "bid/ask mid";
  return "unavailable";
}

function conditionLabel(condition) {
  const direction = condition.direction;

  if (condition.kind === "percent_change_from_entry") {
    const sign = direction === "above" ? "+" : "-";
    return `${direction} ${sign}${formatNumber(condition.threshold)}%`;
  }

  if (condition.kind === "absolute_change_from_entry") {
    const sign = direction === "above" ? "+" : "-";
    return `${direction} ${sign}${formatMoney(condition.threshold)} from entry`;
  }

  return `${direction} ${formatMoney(condition.threshold)}`;
}

function alertKindLabel(kind) {
  if (kind === "percent_change_from_entry") return "% change from entry";
  if (kind === "absolute_change_from_entry") return "$ change from entry";
  return "target option price";
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatAlertCompact(alert) {
  const lines = [
    optionTitle(alert),
    `Contract: ${alert.optionContract}`,
    `Status: ${alert.active ? "active" : "paused"} / ${alert.triggerState}`,
    `Entry: ${formatMoney(alert.entryPrice)}`,
    `Alert: ${conditionLabel(alert.condition)}`
  ];

  if (alert.lastObservedAt) {
    lines.push(`Last: ${formatMoney(alert.lastObservedPrice)} (${sourceLabel(alert.lastObservedPriceSource)}) at ${formatDateTime(alert.lastObservedAt)}`);
    if (Number.isFinite(alert.lastObservedChangePercent)) {
      lines.push(`Change: ${formatPercent(alert.lastObservedChangePercent)}`);
    }
  }

  return lines.join("\n");
}

function formatAlertTriggeredMessage(alert, selectedPrice, evaluation, snapshot, checkedAt) {
  const bidAsk = selectedPrice.bid && selectedPrice.ask
    ? `${formatMoney(selectedPrice.bid)} / ${formatMoney(selectedPrice.ask)}`
    : "unavailable";

  const lastTrade = selectedPrice.lastTradePrice
    ? formatMoney(selectedPrice.lastTradePrice)
    : "unavailable";

  return [
    "🚨 Option alert triggered",
    "",
    optionTitle(alert),
    `Underlying: ${alert.underlyingSymbol} (${alert.contractType})`,
    `Contract: ${alert.optionContract}`,
    "",
    `Entry: ${formatMoney(alert.entryPrice)}`,
    `Current: ${formatMoney(selectedPrice.price)}`,
    `Source: ${sourceLabel(selectedPrice.source)}`,
    `Change: ${formatSignedMoney(evaluation.absoluteChange)} / ${formatPercent(evaluation.percentChange)}`,
    "",
    `Threshold: ${conditionLabel(alert.condition)}`,
    "",
    `Bid/Ask: ${bidAsk}`,
    `Last trade: ${lastTrade}`,
    `Checked: ${formatDateTime(checkedAt)}`,
    snapshot && snapshot.marketStatus ? `Market status: ${snapshot.marketStatus}` : null
  ].filter(Boolean).join("\n");
}

function formatCheckSummary(summaries) {
  const alertSummaries = summaries.filter((summary) => summary.alert);
  if (alertSummaries.length === 0) {
    const message = summaries[0] && summaries[0].message ? summaries[0].message : "No active alerts to check.";
    return `Checked 0 active alerts.\n\n${message}`;
  }

  const lines = [
    `Checked ${alertSummaries.length} alert${alertSummaries.length === 1 ? "" : "s"}.`
  ];

  for (const summary of alertSummaries) {
    lines.push("");
    lines.push(optionTitle(summary.alert));

    if (summary.status === "error") {
      lines.push("Current: unavailable");
      lines.push(`Status: error, ${summary.reason}`);
      continue;
    }

    if (summary.status === "skipped") {
      lines.push("Current: unavailable");
      lines.push(`Status: skipped, ${summary.reason || "no last trade or valid bid/ask"}`);
      continue;
    }

    const selectedPrice = summary.selectedPrice || {};
    const evaluation = summary.evaluation || {};
    lines.push(`Current: ${formatMoney(selectedPrice.price)}`);
    lines.push(`Source: ${sourceLabel(selectedPrice.source)}`);

    if (Number.isFinite(evaluation.absoluteChange) && Number.isFinite(evaluation.percentChange)) {
      lines.push(`Change: ${formatSignedMoney(evaluation.absoluteChange)} / ${formatPercent(evaluation.percentChange)}`);
    }

    lines.push(`Status: ${statusLabel(summary.status)}`);
  }

  return lines.join("\n");
}

function statusLabel(status) {
  const labels = {
    triggered: "triggered",
    already_triggered: "already triggered",
    cooldown: "waiting to re-arm",
    rearmed: "re-armed",
    not_triggered: "not triggered",
    paused: "paused",
    skipped: "skipped",
    error: "error"
  };
  return labels[status] || status;
}

function formatCreationSummary(data, config) {
  return [
    "Confirm new alert",
    "",
    `Underlying: ${data.underlyingSymbol} - ${data.underlyingName}`,
    `Contract type: ${data.contractType}`,
    `Expiry: ${data.expirationDate}`,
    `Strike: ${formatMoney(data.strikePrice)}`,
    `Option contract: ${data.optionContract}`,
    `Entry price: ${formatMoney(data.entryPrice)}`,
    `Alert: ${conditionLabel({
      kind: data.conditionKind,
      direction: data.direction,
      threshold: data.threshold
    })}`,
    "Price basis: last trade preferred, mid fallback",
    `Poll frequency: every ${config.pollIntervalMinutes} minutes`
  ].join("\n");
}

function formatHelp(config) {
  return [
    "This bot watches saved option contracts and alerts you when your configured threshold is reached.",
    "",
    "Commands:",
    "/new - create an alert",
    "/alerts - list, pause, resume, edit, delete, or check alerts",
    "/check - check active alerts now",
    "/cancel - cancel the current setup or edit flow",
    "",
    `Scheduled checks run every ${config.pollIntervalMinutes} minutes.`,
    `Last trades older than ${config.staleTradeMaxMinutes} minutes are treated as stale when timestamps are available.`,
    "When last trade is missing or stale, the bot uses bid/ask mid if both bid and ask are positive."
  ].join("\n");
}

function formatWelcome() {
  return [
    "Options alert bot",
    "",
    "Use the menu below or send /new to create an alert."
  ].join("\n");
}

module.exports = {
  optionTitle,
  sourceLabel,
  conditionLabel,
  alertKindLabel,
  formatAlertCompact,
  formatAlertTriggeredMessage,
  formatCheckSummary,
  formatCreationSummary,
  formatHelp,
  formatWelcome,
  statusLabel
};
