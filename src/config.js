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

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_ADMIN_USER_ID: z.string().regex(/^\d+$/, "TELEGRAM_ADMIN_USER_ID must be a numeric Telegram user id"),
  TELEGRAM_ADMIN_CHAT_ID: z.string().regex(/^-?\d+$/, "TELEGRAM_ADMIN_CHAT_ID must be a numeric Telegram chat id"),
  MASSIVE_API_KEY: z.string().min(1, "MASSIVE_API_KEY is required"),
  POLL_INTERVAL_MINUTES: optionalNumber(15),
  DATA_DIR: optionalString("./data"),
  DEFAULT_PRICE_BASIS: optionalString("last_trade"),
  STALE_TRADE_MAX_MINUTES: optionalNumber(30)
});

const SupportedPriceBasis = new Set(["last_trade", "last_trade_with_mid_fallback"]);

function normalizePriceBasis(value) {
  if (!SupportedPriceBasis.has(value)) {
    throw new Error(`DEFAULT_PRICE_BASIS must be one of: ${Array.from(SupportedPriceBasis).join(", ")}`);
  }

  // The alert engine always falls back to bid/ask mid when last trade is absent or stale.
  return "last_trade_with_mid_fallback";
}

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const env = parsed.data;
  const dataDir = path.resolve(process.cwd(), env.DATA_DIR);

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramAdminUserId: env.TELEGRAM_ADMIN_USER_ID,
    telegramAdminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
    massiveApiKey: env.MASSIVE_API_KEY,
    pollIntervalMinutes: env.POLL_INTERVAL_MINUTES,
    dataDir,
    defaultPriceBasis: normalizePriceBasis(env.DEFAULT_PRICE_BASIS),
    staleTradeMaxMinutes: env.STALE_TRADE_MAX_MINUTES
  };
}

module.exports = {
  loadConfig
};
