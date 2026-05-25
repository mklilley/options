function nowIso() {
  return new Date().toISOString();
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return isValidDate(date) ? date : null;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "unknown";

  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    "-",
    pad(date.getUTCMonth() + 1),
    "-",
    pad(date.getUTCDate()),
    " ",
    pad(date.getUTCHours()),
    ":",
    pad(date.getUTCMinutes()),
    " UTC"
  ].join("");
}

function minutesSince(timestampMs, now = Date.now()) {
  if (!Number.isFinite(timestampMs)) return null;
  return (now - timestampMs) / 60000;
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

module.exports = {
  nowIso,
  toDate,
  formatDateTime,
  minutesSince,
  fileTimestamp
};
