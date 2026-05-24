function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "unavailable";
  return `$${roundTo(value, 2).toFixed(2)}`;
}

function formatSignedMoney(value) {
  if (!Number.isFinite(value)) return "unavailable";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(roundTo(value, 2)).toFixed(2)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "unavailable";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${roundTo(value, 2).toFixed(2)}%`;
}

function formatStrike(value) {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : String(roundTo(value, 4)).replace(/\.?0+$/, "");
}

function parsePositiveDecimal(input) {
  const cleaned = String(input).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parsePercentInput(input) {
  const cleaned = String(input).trim().replace(/%$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

module.exports = {
  roundTo,
  formatMoney,
  formatSignedMoney,
  formatPercent,
  formatStrike,
  parsePositiveDecimal,
  parsePercentInput
};
