const pino = require("pino");

function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL || "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

module.exports = {
  createLogger
};
