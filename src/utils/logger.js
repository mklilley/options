const pino = require("pino");

function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL || "info",
    base: undefined,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

module.exports = {
  createLogger
};
