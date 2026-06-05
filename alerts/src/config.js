require("dotenv").config();

const path = require("node:path");
const { z } = require("zod");

function optionalNumber(defaultValue) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    return Number(value);
  }, z.number().int().positive());
}

function optionalString(defaultValue) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    return value;
  }, z.string().min(1));
}

function optionalTelegramId() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return null;
    return String(value);
  }, z.string().regex(/^\d+$/, "must be a numeric Telegram user id").nullable());
}

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
  TELEGRAM_ADMIN_USER_ID: optionalTelegramId(),
  MASSIVE_API_KEY: z.string().min(1, "MASSIVE_API_KEY is required"),
  POLL_INTERVAL_MINUTES: optionalNumber(15),
  DATA_DIR: optionalString("./data"),
  DEFAULT_PRICE_BASIS: optionalString("aggregate_vw"),
  STALE_TRADE_MAX_MINUTES: optionalNumber(30),
  AGGREGATE_LOOKBACK_MINUTES: optionalNumber(60),
  AGGREGATE_DELAY_MINUTES: optionalNumber(16),
  AGGREGATE_BAR_MINUTES: optionalNumber(5)
});

const SupportedPriceBasis = new Set(["last_trade", "last_trade_with_mid_fallback", "aggregate_vw"]);

function normalizePriceBasis(value) {
  if (!SupportedPriceBasis.has(value)) {
    throw new Error(`DEFAULT_PRICE_BASIS must be one of: ${Array.from(SupportedPriceBasis).join(", ")}`);
  }

  // The alert engine uses aggregate VW because this Massive plan does not include options trades/quotes.
  return "aggregate_vw";
}

function parseAllowedUserIds(value) {
  const ids = String(value)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const invalidIds = ids.filter((id) => !/^\d+$/.test(id));
  if (invalidIds.length > 0) {
    throw new Error(`TELEGRAM_ALLOWED_USER_IDS contains invalid Telegram user id(s): ${invalidIds.join(", ")}`);
  }

  return Array.from(new Set(ids));
}

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const env = parsed.data;
  const dataDir = path.resolve(process.cwd(), env.DATA_DIR);
  const telegramAllowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramAllowedUserIds,
    telegramAllowedUserIdSet: new Set(telegramAllowedUserIds),
    telegramAdminUserId: env.TELEGRAM_ADMIN_USER_ID,
    massiveApiKey: env.MASSIVE_API_KEY,
    pollIntervalMinutes: env.POLL_INTERVAL_MINUTES,
    dataDir,
    defaultPriceBasis: normalizePriceBasis(env.DEFAULT_PRICE_BASIS),
    staleTradeMaxMinutes: env.STALE_TRADE_MAX_MINUTES,
    aggregateLookbackMinutes: env.AGGREGATE_LOOKBACK_MINUTES,
    aggregateDelayMinutes: env.AGGREGATE_DELAY_MINUTES,
    aggregateBarMinutes: env.AGGREGATE_BAR_MINUTES
  };
}

module.exports = {
  loadConfig
};
