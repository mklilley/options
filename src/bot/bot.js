const { Telegraf } = require("telegraf");
const { BotScenes } = require("./scenes");

function createBot({ config, alertStore, recentTickerStore, appStateStore, massiveClient, alertEngine, logger }) {
  const bot = new Telegraf(config.telegramBotToken);
  const scenes = new BotScenes({
    config,
    alertStore,
    recentTickerStore,
    appStateStore,
    massiveClient,
    alertEngine,
    logger
  });

  bot.use(async (ctx, next) => {
    const fromId = ctx.from && ctx.from.id ? String(ctx.from.id) : null;
    if (!fromId || !config.telegramAllowedUserIdSet.has(fromId)) {
      logger.warn({ fromId }, "Rejected non-allowlisted Telegram user");
      const message = fromId
        ? "You are not approved to use this bot yet.\n\nCopy the Telegram user ID in the next message and send it to the admin to request access."
        : "Sorry, you are not approved to use this bot. I could not read your Telegram user ID from this update.";

      if (ctx.callbackQuery) {
        try {
          await ctx.answerCbQuery(fromId ? `Not approved. Your user ID: ${fromId}` : "Not approved.");
        } catch {
          // Ignore rejected-user Telegram errors.
        }
        if (ctx.chat && fromId) {
          await ctx.reply(message);
          await ctx.reply(fromId);
        }
      } else if (ctx.message) {
        await ctx.reply(message);
        if (fromId) {
          await ctx.reply(fromId);
        }
      }
      return;
    }

    if (ctx.chat && ctx.chat.type !== "private") {
      logger.warn({ fromId, chatId: ctx.chat.id, chatType: ctx.chat.type }, "Rejected non-private Telegram chat");
      if (ctx.callbackQuery) {
        try {
          await ctx.answerCbQuery("Please use this bot in a private chat.");
        } catch {
          // Ignore private-chat enforcement Telegram errors.
        }
      } else if (ctx.message) {
        await ctx.reply("Please message me in a private chat. Alerts are tied to each user's own private chat.");
      }
      return;
    }

    await next();
  });

  bot.start((ctx) => scenes.showWelcome(ctx));
  bot.command("menu", (ctx) => scenes.showWelcome(ctx));
  bot.command("help", (ctx) => scenes.showHelp(ctx));
  bot.command("new", (ctx) => scenes.startNewAlert(ctx));
  bot.command("alerts", (ctx) => scenes.listAlerts(ctx));
  bot.command("check", (ctx) => scenes.runManualCheck(ctx));
  bot.command("cancel", (ctx) => scenes.cancel(ctx));

  bot.action(/^menu:/, async (ctx) => {
    const action = ctx.callbackQuery.data.split(":")[1];

    if (action === "new") {
      await scenes.startNewAlert(ctx);
    } else if (action === "alerts") {
      await scenes.listAlerts(ctx);
    } else if (action === "check") {
      await scenes.runManualCheck(ctx);
    } else if (action === "help") {
      await scenes.showHelp(ctx);
    } else {
      await ctx.answerCbQuery();
    }
  });

  bot.action(/^new:/, (ctx) => scenes.handleNewCallback(ctx));
  bot.action(/^al:/, (ctx) => scenes.handleAlertCallback(ctx));
  bot.on("text", (ctx) => scenes.handleText(ctx));

  bot.catch((error, ctx) => {
    logger.error({ error, updateType: ctx.updateType }, "Telegram bot error");
  });

  bot.setAppCommands = async () => {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "menu", description: "Show the main menu" },
      { command: "new", description: "Create a new option alert" },
      { command: "alerts", description: "List and manage alerts" },
      { command: "check", description: "Check alerts now" },
      { command: "help", description: "How the bot works" },
      { command: "cancel", description: "Cancel current setup or edit flow" }
    ]);
  };

  return bot;
}

module.exports = {
  createBot
};
