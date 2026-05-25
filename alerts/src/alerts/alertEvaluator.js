const { nowIso } = require("../utils/dates");

function evaluateAlert(alert, selectedPrice, checkedAt = nowIso()) {
  const currentPrice = selectedPrice.price;
  const absoluteChange = currentPrice - alert.entryPrice;
  const percentChange = (absoluteChange / alert.entryPrice) * 100;
  const condition = getConditionMath(alert, currentPrice, absoluteChange, percentChange);
  const crossed = condition.direction === "above"
    ? condition.value >= condition.boundary
    : condition.value <= condition.boundary;

  const updatedAlert = {
    ...alert,
    updatedAt: checkedAt,
    lastObservedPrice: currentPrice,
    lastObservedAt: checkedAt,
    lastObservedPriceSource: selectedPrice.source,
    lastObservedChangePercent: percentChange
  };

  let shouldNotify = false;
  let status = "not_triggered";
  let rearmed = false;

  if (alert.triggerState === "armed" && crossed) {
    shouldNotify = true;
    status = "triggered";
    updatedAlert.triggerState = "triggered";
    updatedAlert.lastTriggeredAt = checkedAt;
  } else if (alert.triggerState === "triggered") {
    const shouldRearm = condition.direction === "above"
      ? condition.value <= condition.boundary - condition.hysteresis
      : condition.value >= condition.boundary + condition.hysteresis;

    if (shouldRearm) {
      status = "rearmed";
      rearmed = true;
      updatedAlert.triggerState = "armed";
    } else if (crossed) {
      status = "already_triggered";
    } else {
      status = "cooldown";
    }
  }

  return {
    updatedAlert,
    shouldNotify,
    status,
    rearmed,
    crossed,
    absoluteChange,
    percentChange,
    condition
  };
}

function getConditionMath(alert, currentPrice, absoluteChange, percentChange) {
  const { kind, direction, threshold } = alert.condition;

  if (kind === "percent_change_from_entry") {
    return {
      kind,
      direction,
      threshold,
      value: percentChange,
      boundary: direction === "above" ? threshold : -threshold,
      hysteresis: 5
    };
  }

  if (kind === "absolute_change_from_entry") {
    return {
      kind,
      direction,
      threshold,
      value: absoluteChange,
      boundary: direction === "above" ? threshold : -threshold,
      hysteresis: Math.max(threshold * 0.1, 0.05)
    };
  }

  return {
    kind,
    direction,
    threshold,
    value: currentPrice,
    boundary: threshold,
    hysteresis: Math.max(threshold * 0.01, 0.05)
  };
}

function markAlertUnchecked(alert, selectedPrice, checkedAt = nowIso()) {
  return {
    ...alert,
    updatedAt: checkedAt,
    lastObservedPrice: null,
    lastObservedAt: checkedAt,
    lastObservedPriceSource: "unavailable",
    lastObservedChangePercent: null
  };
}

module.exports = {
  evaluateAlert,
  markAlertUnchecked,
  getConditionMath
};
