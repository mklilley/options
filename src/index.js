const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const { AlertStore } = require("./storage/alertStore");
const { RecentTickerStore } = require("./storage/recentTickerStore");
const { AppStateStore } = require("./storage/appStateStore");
const { MassiveClient } = require("./massive/client");
const { AlertEngine } = require("./alerts/alertEngine");
const { createBot } = require("./bot/bot");
const { startScheduler } = require("./scheduler/scheduler");

async function main() {
  const logger = createLogger();
  const config = loadConfig();

  const alertStore = new AlertStore({ dataDir: config.dataDir, logger });
  const recentTickerStore = new RecentTickerStore({ dataDir: config.dataDir, logger });
  const appStateStore = new AppStateStore({ dataDir: config.dataDir, logger });

  await Promise.all([
    alertStore.init(),
    recentTickerStore.init(),
    appStateStore.init()
  ]);

  const massiveClient = new MassiveClient({
    apiKey: config.massiveApiKey,
    logger
  });

  let bot;
  const alertEngine = new AlertEngine({
    alertStore,
    appStateStore,
    massiveClient,
    config,
    logger,
    sendMessage: async (message) => {
      await bot.telegram.sendMessage(config.telegramAdminChatId, message);
    }
  });

  bot = createBot({
    config,
    alertStore,
    recentTickerStore,
    appStateStore,
    massiveClient,
    alertEngine,
    logger
  });

  try {
    await bot.setAppCommands();
  } catch (error) {
    logger.warn({ error }, "Could not set Telegram command menu");
  }

  await bot.launch();
  logger.info("Telegram bot started");

  const scheduler = startScheduler({
    intervalMinutes: config.pollIntervalMinutes,
    logger,
    task: () => alertEngine.checkAll()
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, "Shutting down");
    scheduler.stop();
    bot.stop(signal);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  const logger = createLogger();
  logger.error({ error }, "Application failed to start");
  process.exit(1);
});
