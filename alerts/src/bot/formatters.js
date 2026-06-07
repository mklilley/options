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
  if (source === "aggregate_vw") return "aggregate VW";
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

function formatInteger(value) {
  if (!Number.isFinite(value)) return "unavailable";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatAge(fromValue, toValue) {
  const from = Date.parse(fromValue);
  const to = Date.parse(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "unknown age";

  const totalMinutes = Math.max(0, Math.round((to - from) / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 48) {
    return minutes > 0
      ? `${totalHours} hour${totalHours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`
      : `${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0
    ? `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`
    : `${days} day${days === 1 ? "" : "s"}`;
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

function formatAlertTriggeredMessage(alert, selectedPrice, evaluation, aggregateBars, checkedAt) {
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
    selectedPrice.aggregateBarAt ? `Aggregate bar: ${formatDateTime(selectedPrice.aggregateBarAt)}` : null,
    Number.isFinite(selectedPrice.aggregateBarClose) ? `Bar close: ${formatMoney(selectedPrice.aggregateBarClose)}` : null,
    Number.isFinite(selectedPrice.aggregateBarVolume) ? `Volume: ${formatInteger(selectedPrice.aggregateBarVolume)}` : null,
    Number.isFinite(selectedPrice.aggregateBarTransactions) ? `Trades: ${formatInteger(selectedPrice.aggregateBarTransactions)}` : null,
    aggregateBars && aggregateBars.range
      ? `Lookback: ${formatDateTime(aggregateBars.range.from)} to ${formatDateTime(aggregateBars.range.to)}`
      : null,
    `Checked: ${formatDateTime(checkedAt)}`,
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
      lines.push(`Status: skipped, ${summary.reason || "no aggregate VW available"}`);
      appendLastAvailablePrice(lines, summary);
      continue;
    }

    const selectedPrice = summary.selectedPrice || {};
    const evaluation = summary.evaluation || {};
    lines.push(`Current: ${formatMoney(selectedPrice.price)}`);
    lines.push(`Source: ${sourceLabel(selectedPrice.source)}`);
    if (selectedPrice.aggregateBarAt) {
      lines.push(`Bar: ${formatDateTime(selectedPrice.aggregateBarAt)}`);
    }

    if (Number.isFinite(evaluation.absoluteChange) && Number.isFinite(evaluation.percentChange)) {
      lines.push(`Change: ${formatSignedMoney(evaluation.absoluteChange)} / ${formatPercent(evaluation.percentChange)}`);
    }

    lines.push(`Status: ${statusLabel(summary.status)}`);
  }

  return lines.join("\n");
}

function appendLastAvailablePrice(lines, summary) {
  const lastAvailable = summary.lastAvailable;
  const price = lastAvailable && lastAvailable.price;
  if (!price || !price.available) return;

  lines.push("");
  lines.push("Last available:");
  lines.push(`${formatMoney(price.price)} aggregate VW`);

  if (price.aggregateBarAt) {
    const checkedAt = summary.checkedAt || new Date().toISOString();
    lines.push(`Bar: ${formatDateTime(price.aggregateBarAt)} (${formatAge(price.aggregateBarAt, checkedAt)} old)`);
  }

  if (Number.isFinite(price.aggregateBarClose)) {
    lines.push(`Bar close: ${formatMoney(price.aggregateBarClose)}`);
  }
  if (Number.isFinite(price.aggregateBarVolume)) {
    lines.push(`Volume: ${formatInteger(price.aggregateBarVolume)}`);
  }
  if (Number.isFinite(price.aggregateBarTransactions)) {
    lines.push(`Trades: ${formatInteger(price.aggregateBarTransactions)}`);
  }

  lines.push("Note: stale price is display-only and was not used for alert evaluation.");
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
    `Price basis: recent ${config.aggregateBarMinutes}-minute aggregate VW`,
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
    `Alert prices use the latest ${config.aggregateBarMinutes}-minute aggregate VW in a ${config.aggregateLookbackMinutes}-minute lookback window.`,
    `The aggregate window ends ${config.aggregateDelayMinutes} minutes behind the current time to match delayed data access.`,
    `Manual checks show the last available aggregate VW from the prior ${config.lastAvailableLookbackDays} days when no recent bar is available, but stale prices do not trigger alerts.`
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
