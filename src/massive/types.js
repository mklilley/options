function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
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

function marketTimestampToMs(value) {
  const number = toNumber(value);
  if (!number || number <= 0) return null;

  if (number >= 1e17) return Math.floor(number / 1e6); // nanoseconds
  if (number >= 1e14) return Math.floor(number / 1e3); // microseconds
  if (number >= 1e11) return Math.floor(number); // milliseconds
  return Math.floor(number * 1000); // seconds
}

module.exports = {
  toNumber,
  isPositiveNumber,
  getFirstValue,
  marketTimestampToMs
};
