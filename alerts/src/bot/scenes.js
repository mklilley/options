const { createId } = require("../utils/ids");
const { nowIso } = require("../utils/dates");
const {
  parsePositiveDecimal,
  parsePercentInput,
  formatMoney
} = require("../utils/money");
const {
  mainMenuKeyboard,
  tickerKeyboard,
  optionTypeKeyboard,
  expirationKeyboard,
  strikeKeyboard,
  disambiguationKeyboard,
  conditionKindKeyboard,
  directionKeyboard,
  confirmKeyboard,
  alertActionsKeyboard,
  deleteConfirmKeyboard,
  checkNowKeyboard,
  backCancelKeyboard
} = require("./menus");
const {
  formatAlertCompact,
  formatCreationSummary,
  formatHelp,
  formatWelcome
} = require("./formatters");

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;

class BotScenes {
  constructor({ config, alertStore, recentTickerStore, appStateStore, massiveClient, alertEngine, logger }) {
    this.config = config;
    this.alertStore = alertStore;
    this.recentTickerStore = recentTickerStore;
    this.appStateStore = appStateStore;
    this.massiveClient = massiveClient;
    this.alertEngine = alertEngine;
    this.logger = logger;
  }

  telegramUserId(ctx) {
    return String(ctx.from.id);
  }

  chatId(ctx) {
    return String(ctx.chat.id);
  }

  async getFlow(ctx) {
    return this.appStateStore.getFlow(this.telegramUserId(ctx));
  }

  async setFlow(ctx, flow) {
    return this.appStateStore.setFlow(this.telegramUserId(ctx), flow);
  }

  async clearFlow(ctx) {
    return this.appStateStore.clearFlow(this.telegramUserId(ctx));
  }

  async showWelcome(ctx) {
    await this.respond(ctx, formatWelcome(), mainMenuKeyboard());
  }

  async showHelp(ctx) {
    await this.respond(ctx, formatHelp(this.config), mainMenuKeyboard());
  }

  async cancel(ctx) {
    await this.clearFlow(ctx);
    await this.respond(ctx, "Cancelled.", mainMenuKeyboard());
  }

  async startNewAlert(ctx) {
    await this.renderTickerStep(ctx, {});
  }

  async listAlerts(ctx) {
    await this.answerCallback(ctx);
    const alerts = await this.alertStore.listForUser(this.telegramUserId(ctx));

    if (alerts.length === 0) {
      await ctx.reply("No alerts yet. Use /new to create one.", mainMenuKeyboard());
      return;
    }

    await ctx.reply(`Current alerts: ${alerts.length}`);
    for (const alert of alerts) {
      await ctx.reply(formatAlertCompact(alert), alertActionsKeyboard(alert));
    }
  }

  async runManualCheck(ctx) {
    await this.answerCallback(ctx, "Checking alerts...");
    const result = await this.alertEngine.checkAll({
      manual: true,
      telegramUserId: this.telegramUserId(ctx)
    });
    await ctx.reply(result.summaryText || "Check finished.");
  }

  async handleText(ctx) {
    const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : "";
    const flow = await this.getFlow(ctx);

    if (!flow) {
      await ctx.reply("No active setup. Use /new to create an alert.", mainMenuKeyboard());
      return;
    }

    if (flow.type === "new_alert") {
      await this.handleNewAlertText(ctx, flow, text);
      return;
    }

    if (flow.type === "edit_alert") {
      await this.handleEditText(ctx, flow, text);
      return;
    }

    await this.clearFlow(ctx);
    await ctx.reply("That saved flow is not recognized. Start again with /new.", mainMenuKeyboard());
  }

  async handleNewAlertText(ctx, flow, text) {
    if (flow.step === "ticker") {
      await this.processTicker(ctx, text, flow.data);
      return;
    }

    if (flow.step === "strike") {
      const strikePrice = parsePositiveDecimal(text);
      if (!strikePrice) {
        await ctx.reply("Send a positive strike price, for example 220 or 220.50.", backCancelKeyboard());
        return;
      }
      await this.resolveSelectedContract(ctx, { ...flow.data, strikePrice });
      return;
    }

    if (flow.step === "entry_price") {
      const entryPrice = parsePositiveDecimal(text);
      if (!entryPrice) {
        await ctx.reply("Send a positive option entry price, for example 3.40.", backCancelKeyboard());
        return;
      }
      await this.renderConditionKindStep(ctx, { ...flow.data, entryPrice });
      return;
    }

    if (flow.step === "threshold") {
      const threshold = this.parseThreshold(text, flow.data.conditionKind);
      if (!threshold) {
        await ctx.reply(this.thresholdPrompt(flow.data), backCancelKeyboard());
        return;
      }
      await this.renderConfirmStep(ctx, { ...flow.data, threshold });
      return;
    }

    await ctx.reply("Use the buttons for this step, or send /cancel.", backCancelKeyboard());
  }

  async handleNewCallback(ctx) {
    const data = ctx.callbackQuery.data;

    if (data === "new:cancel") {
      await this.cancel(ctx);
      return;
    }

    const flow = await this.getFlow(ctx);
    const flowData = flow && flow.type === "new_alert" ? flow.data : {};

    if (data === "new:back") {
      await this.goBack(ctx, flow);
      return;
    }

    if (data.startsWith("new:ticker:")) {
      await this.processTicker(ctx, data.slice("new:ticker:".length), flowData);
      return;
    }

    if (data.startsWith("new:type:")) {
      await this.renderExpiryStep(ctx, { ...flowData, contractType: data.slice("new:type:".length), expirations: null, expiryPage: 0 });
      return;
    }

    if (data.startsWith("new:expPage:")) {
      const page = Number(data.slice("new:expPage:".length));
      await this.renderExpiryStep(ctx, { ...flowData, expiryPage: page }, { useCached: true });
      return;
    }

    if (data.startsWith("new:exp:")) {
      const expirationDate = data.slice("new:exp:".length);
      await this.renderStrikeStep(ctx, {
        ...flowData,
        expirationDate,
        strikes: null,
        strikePage: 0,
        underlyingPriceHint: null
      });
      return;
    }

    if (data.startsWith("new:strPage:")) {
      const page = Number(data.slice("new:strPage:".length));
      await this.renderStrikeStep(ctx, { ...flowData, strikePage: page }, { useCached: true });
      return;
    }

    if (data.startsWith("new:str:")) {
      const index = Number(data.slice("new:str:".length));
      const strikePrice = flowData.strikes ? flowData.strikes[index] : null;
      if (!Number.isFinite(strikePrice)) {
        await this.respond(ctx, "That strike is no longer available. Choose again.", strikeKeyboard(flowData.strikes || [], flowData.strikePage || 0));
        return;
      }
      await this.resolveSelectedContract(ctx, { ...flowData, strikePrice });
      return;
    }

    if (data.startsWith("new:contract:")) {
      const index = Number(data.slice("new:contract:".length));
      const contract = flowData.contractChoices ? flowData.contractChoices[index] : null;
      if (!contract) {
        await this.respond(ctx, "That contract choice is no longer available. Choose again.", disambiguationKeyboard(flowData.contractChoices || []));
        return;
      }
      await this.renderEntryPriceStep(ctx, { ...flowData, optionContract: contract.ticker });
      return;
    }

    if (data.startsWith("new:kind:")) {
      await this.renderDirectionStep(ctx, { ...flowData, conditionKind: data.slice("new:kind:".length) });
      return;
    }

    if (data.startsWith("new:dir:")) {
      await this.renderThresholdStep(ctx, { ...flowData, direction: data.slice("new:dir:".length) });
      return;
    }

    if (data === "new:confirm") {
      await this.confirmAlert(ctx, flowData);
      return;
    }

    await this.answerCallback(ctx);
  }

  async handleAlertCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const [, action, id] = data.split(":");

    if (!id) {
      await this.answerCallback(ctx);
      return;
    }

    if (action === "pause") {
      const updated = await this.alertStore.updateAlertForUser(id, this.telegramUserId(ctx), (alert) => ({ ...alert, active: false }));
      await this.renderUpdatedAlert(ctx, updated, "Alert paused.");
      return;
    }

    if (action === "resume") {
      const updated = await this.alertStore.updateAlertForUser(id, this.telegramUserId(ctx), (alert) => ({ ...alert, active: true, triggerState: "armed" }));
      await this.renderUpdatedAlert(ctx, updated, "Alert resumed.");
      return;
    }

    if (action === "del") {
      const alert = await this.alertStore.getByIdForUser(id, this.telegramUserId(ctx));
      if (!alert) {
        await this.respond(ctx, "Alert not found.", mainMenuKeyboard());
        return;
      }
      await this.respond(ctx, `${formatAlertCompact(alert)}\n\nDelete this alert?`, deleteConfirmKeyboard(id));
      return;
    }

    if (action === "delno") {
      const alert = await this.alertStore.getByIdForUser(id, this.telegramUserId(ctx));
      await this.renderUpdatedAlert(ctx, alert, "Kept alert.");
      return;
    }

    if (action === "delok") {
      const removed = await this.alertStore.removeForUser(id, this.telegramUserId(ctx));
      await this.respond(ctx, removed ? "Deleted alert." : "Alert not found.", mainMenuKeyboard());
      return;
    }

    if (action === "entry") {
      const alert = await this.alertStore.getByIdForUser(id, this.telegramUserId(ctx));
      if (!alert) {
        await this.respond(ctx, "Alert not found.", mainMenuKeyboard());
        return;
      }
      await this.setFlow(ctx, { type: "edit_alert", step: "entry_price", data: { alertId: id } });
      await this.respond(ctx, `Send the new entry price for:\n\n${formatAlertCompact(alert)}\n\nUse /cancel to cancel.`);
      return;
    }

    if (action === "th") {
      const alert = await this.alertStore.getByIdForUser(id, this.telegramUserId(ctx));
      if (!alert) {
        await this.respond(ctx, "Alert not found.", mainMenuKeyboard());
        return;
      }
      await this.setFlow(ctx, { type: "edit_alert", step: "threshold", data: { alertId: id } });
      await this.respond(ctx, `Send the new threshold for:\n\n${formatAlertCompact(alert)}\n\nUse /cancel to cancel.`);
      return;
    }

    if (action === "check") {
      await this.answerCallback(ctx, "Checking alert...");
      const result = await this.alertEngine.checkAll({
        manual: true,
        alertId: id,
        telegramUserId: this.telegramUserId(ctx)
      });
      await ctx.reply(result.summaryText || "Check finished.");
      return;
    }

    await this.answerCallback(ctx);
  }

  async handleEditText(ctx, flow, text) {
    const alert = await this.alertStore.getByIdForUser(flow.data.alertId, this.telegramUserId(ctx));
    if (!alert) {
      await this.clearFlow(ctx);
      await ctx.reply("Alert not found. Edit cancelled.", mainMenuKeyboard());
      return;
    }

    if (flow.step === "entry_price") {
      const entryPrice = parsePositiveDecimal(text);
      if (!entryPrice) {
        await ctx.reply("Send a positive entry price, for example 3.40. Use /cancel to cancel.");
        return;
      }

      const updated = await this.alertStore.updateAlertForUser(alert.id, this.telegramUserId(ctx), (current) => ({
        ...current,
        entryPrice,
        triggerState: "armed",
        lastTriggeredAt: null
      }));
      await this.clearFlow(ctx);
      await ctx.reply(`Entry price updated.\n\n${formatAlertCompact(updated)}`, alertActionsKeyboard(updated));
      return;
    }

    if (flow.step === "threshold") {
      const threshold = this.parseThreshold(text, alert.condition.kind);
      if (!threshold) {
        await ctx.reply("Send a positive threshold value. Percent alerts accept 25 or 25%. Use /cancel to cancel.");
        return;
      }

      const updated = await this.alertStore.updateAlertForUser(alert.id, this.telegramUserId(ctx), (current) => ({
        ...current,
        condition: {
          ...current.condition,
          threshold
        },
        triggerState: "armed",
        lastTriggeredAt: null
      }));
      await this.clearFlow(ctx);
      await ctx.reply(`Threshold updated.\n\n${formatAlertCompact(updated)}`, alertActionsKeyboard(updated));
      return;
    }

    await this.clearFlow(ctx);
    await ctx.reply("Edit cancelled because the saved edit step was not recognized.", mainMenuKeyboard());
  }

  async processTicker(ctx, input, existingData) {
    const underlyingSymbol = String(input || "").trim().toUpperCase();
    if (!TICKER_PATTERN.test(underlyingSymbol)) {
      await this.respond(ctx, "Send a valid ticker, for example AAPL, SPY, or BRK.B.", tickerKeyboard(await this.recentTickerStore.list()));
      return;
    }

    const underlyingName = await this.recentTickerStore.findName(underlyingSymbol);
    await this.renderOptionTypeStep(ctx, {
      ...existingData,
      underlyingSymbol,
      underlyingName,
      contractType: null,
      expirationDate: null,
      strikePrice: null,
      optionContract: null
    });
  }

  async renderTickerStep(ctx, data) {
    const tickers = await this.recentTickerStore.list();
    await this.setFlow(ctx, { type: "new_alert", step: "ticker", data });
    await this.respond(ctx, "Choose a ticker or type one manually.", tickerKeyboard(tickers));
  }

  async renderOptionTypeStep(ctx, data) {
    await this.setFlow(ctx, { type: "new_alert", step: "contract_type", data });
    await this.respond(ctx, `Select option type for ${data.underlyingSymbol}.`, optionTypeKeyboard());
  }

  async renderExpiryStep(ctx, data, options = {}) {
    if (!data.underlyingSymbol || !data.contractType) {
      await this.renderTickerStep(ctx, {});
      return;
    }

    await this.answerCallback(ctx, "Loading expiries...");

    let expirations = options.useCached ? data.expirations : null;
    if (!expirations || expirations.length === 0) {
      try {
        expirations = await this.massiveClient.getExpirationDates(data.underlyingSymbol, data.contractType);
      } catch (error) {
        this.logger.error({ error, underlyingSymbol: data.underlyingSymbol, contractType: data.contractType }, "Failed to fetch expirations");
        await this.respond(ctx, `Could not fetch expiries for ${data.underlyingSymbol}: ${error.message}`, optionTypeKeyboard());
        return;
      }
    }

    const nextData = { ...data, expirations, expiryPage: Number(data.expiryPage) || 0 };
    await this.setFlow(ctx, { type: "new_alert", step: "expiry", data: nextData });

    if (expirations.length === 0) {
      await this.respond(ctx, `No active ${data.contractType} expiries found for ${data.underlyingSymbol}.`, optionTypeKeyboard());
      return;
    }

    await this.respond(ctx, `Select expiry for ${data.underlyingSymbol} ${data.contractType}s.`, expirationKeyboard(expirations, nextData.expiryPage));
  }

  async renderStrikeStep(ctx, data, options = {}) {
    if (!data.underlyingSymbol || !data.contractType || !data.expirationDate) {
      await this.renderExpiryStep(ctx, data);
      return;
    }

    await this.answerCallback(ctx, "Loading strikes...");

    let strikes = options.useCached ? data.strikes : null;
    let underlyingPriceHint = options.useCached ? data.underlyingPriceHint : null;

    if (!strikes || strikes.length === 0) {
      try {
        const [rawStrikes, priceHint] = await Promise.all([
          this.massiveClient.getStrikesForExpiry(data.underlyingSymbol, data.contractType, data.expirationDate),
          this.massiveClient.getUnderlyingPriceHint(data.underlyingSymbol, data.contractType, data.expirationDate)
        ]);
        underlyingPriceHint = priceHint;
        strikes = orderStrikes(rawStrikes, underlyingPriceHint);
      } catch (error) {
        this.logger.error({ error, data }, "Failed to fetch strikes");
        await this.respond(ctx, `Could not fetch strikes for ${data.underlyingSymbol}: ${error.message}`, expirationKeyboard(data.expirations || [], data.expiryPage || 0));
        return;
      }
    }

    const nextData = {
      ...data,
      strikes,
      underlyingPriceHint,
      strikePage: Number(data.strikePage) || 0
    };
    await this.setFlow(ctx, { type: "new_alert", step: "strike", data: nextData });

    if (strikes.length === 0) {
      await this.respond(ctx, `No strikes found for ${data.underlyingSymbol} ${data.expirationDate}.`, expirationKeyboard(data.expirations || [], data.expiryPage || 0));
      return;
    }

    const hint = underlyingPriceHint ? `\nNearest strikes are shown first around ${formatMoney(underlyingPriceHint)}.` : "";
    await this.respond(
      ctx,
      `Select strike for ${data.underlyingSymbol} ${data.expirationDate}, or type a strike manually.${hint}`,
      strikeKeyboard(strikes, nextData.strikePage)
    );
  }

  async resolveSelectedContract(ctx, data) {
    if (!data.underlyingSymbol || !data.contractType || !data.expirationDate || !data.strikePrice) {
      await this.renderStrikeStep(ctx, data);
      return;
    }

    await this.answerCallback(ctx, "Resolving contract...");

    let contracts;
    try {
      contracts = await this.massiveClient.resolveOptionContract(
        data.underlyingSymbol,
        data.contractType,
        data.expirationDate,
        data.strikePrice
      );
    } catch (error) {
      this.logger.error({ error, data }, "Failed to resolve option contract");
      await this.respond(ctx, `Could not resolve that option contract: ${error.message}`, strikeKeyboard(data.strikes || [], data.strikePage || 0));
      return;
    }

    if (contracts.length === 0) {
      await this.respond(ctx, "No exact contract found for that ticker, expiry, strike, and side.", strikeKeyboard(data.strikes || [], data.strikePage || 0));
      return;
    }

    if (contracts.length > 1) {
      const nextData = { ...data, contractChoices: contracts };
      await this.setFlow(ctx, { type: "new_alert", step: "disambiguate", data: nextData });
      await this.respond(ctx, "More than one contract matched. Choose the exact contract.", disambiguationKeyboard(contracts));
      return;
    }

    await this.renderEntryPriceStep(ctx, { ...data, optionContract: contracts[0].ticker });
  }

  async renderEntryPriceStep(ctx, data) {
    await this.recentTickerStore.touch(data.underlyingSymbol, data.underlyingName);
    await this.setFlow(ctx, { type: "new_alert", step: "entry_price", data });
    await this.respond(ctx, `Contract resolved:\n${data.optionContract}\n\nSend your option entry price.`, backCancelKeyboard());
  }

  async renderConditionKindStep(ctx, data) {
    await this.setFlow(ctx, { type: "new_alert", step: "condition_kind", data });
    await this.respond(ctx, "Select alert type.", conditionKindKeyboard());
  }

  async renderDirectionStep(ctx, data) {
    await this.setFlow(ctx, { type: "new_alert", step: "direction", data });
    await this.respond(ctx, "Select alert direction.", directionKeyboard());
  }

  async renderThresholdStep(ctx, data) {
    await this.setFlow(ctx, { type: "new_alert", step: "threshold", data });
    await this.respond(ctx, this.thresholdPrompt(data), backCancelKeyboard());
  }

  async renderConfirmStep(ctx, data) {
    await this.setFlow(ctx, { type: "new_alert", step: "confirm", data });
    await this.respond(ctx, formatCreationSummary(data, this.config), confirmKeyboard());
  }

  async confirmAlert(ctx, data) {
    const missing = [
      "underlyingSymbol",
      "underlyingName",
      "contractType",
      "expirationDate",
      "strikePrice",
      "optionContract",
      "entryPrice",
      "conditionKind",
      "direction",
      "threshold"
    ].filter((key) => data[key] === undefined || data[key] === null || data[key] === "");

    if (missing.length > 0) {
      await this.respond(ctx, `Cannot save alert because setup is missing: ${missing.join(", ")}`, mainMenuKeyboard());
      return;
    }

    const timestamp = nowIso();
    const alert = {
      id: createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      active: true,
      telegramUserId: this.telegramUserId(ctx),
      chatId: this.chatId(ctx),
      underlyingSymbol: data.underlyingSymbol,
      underlyingName: data.underlyingName,
      contractType: data.contractType,
      expirationDate: data.expirationDate,
      strikePrice: Number(data.strikePrice),
      optionContract: data.optionContract,
      entryPrice: Number(data.entryPrice),
      priceBasis: this.config.defaultPriceBasis,
      condition: {
        kind: data.conditionKind,
        direction: data.direction,
        threshold: Number(data.threshold)
      },
      lastObservedPrice: null,
      lastObservedAt: null,
      lastObservedPriceSource: null,
      lastObservedChangePercent: null,
      lastTriggeredAt: null,
      triggerState: "armed"
    };

    await this.alertStore.add(alert);
    await this.recentTickerStore.touch(alert.underlyingSymbol, alert.underlyingName);
    await this.clearFlow(ctx);

    await this.respond(ctx, `Alert saved.\n\n${formatAlertCompact(alert)}`, checkNowKeyboard(alert.id));
  }

  async goBack(ctx, flow) {
    if (!flow || flow.type !== "new_alert") {
      await this.renderTickerStep(ctx, {});
      return;
    }

    const data = flow.data || {};
    if (flow.step === "ticker") {
      await this.clearFlow(ctx);
      await this.respond(ctx, "Setup cancelled.", mainMenuKeyboard());
    } else if (flow.step === "contract_type") {
      await this.renderTickerStep(ctx, data);
    } else if (flow.step === "expiry") {
      await this.renderOptionTypeStep(ctx, data);
    } else if (flow.step === "strike") {
      await this.renderExpiryStep(ctx, data, { useCached: true });
    } else if (flow.step === "disambiguate" || flow.step === "entry_price") {
      await this.renderStrikeStep(ctx, data, { useCached: true });
    } else if (flow.step === "condition_kind") {
      await this.renderEntryPriceStep(ctx, data);
    } else if (flow.step === "direction") {
      await this.renderConditionKindStep(ctx, data);
    } else if (flow.step === "threshold") {
      await this.renderDirectionStep(ctx, data);
    } else if (flow.step === "confirm") {
      await this.renderThresholdStep(ctx, data);
    } else {
      await this.renderTickerStep(ctx, {});
    }
  }

  parseThreshold(text, kind) {
    if (kind === "percent_change_from_entry") {
      return parsePercentInput(text);
    }
    return parsePositiveDecimal(text);
  }

  thresholdPrompt(data) {
    if (data.conditionKind === "percent_change_from_entry") {
      return "Enter the percentage threshold, for example 25 or 25%.";
    }

    if (data.conditionKind === "absolute_change_from_entry") {
      return "Enter the dollar change threshold, for example 0.50.";
    }

    return "Enter the target option price, for example 5.25.";
  }

  async renderUpdatedAlert(ctx, alert, fallbackMessage) {
    if (!alert) {
      await this.respond(ctx, "Alert not found.", mainMenuKeyboard());
      return;
    }
    await this.respond(ctx, `${fallbackMessage}\n\n${formatAlertCompact(alert)}`, alertActionsKeyboard(alert));
  }

  async respond(ctx, text, extra) {
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, extra);
        return;
      } catch (error) {
        const description = error && error.description ? error.description : "";
        if (description.includes("message is not modified")) {
          await this.answerCallback(ctx);
          return;
        }
        this.logger.debug({ error }, "Could not edit Telegram message; sending a new message");
      }
    }

    await ctx.reply(text, extra);
  }

  async answerCallback(ctx, text) {
    if (!ctx.callbackQuery) return;
    try {
      await ctx.answerCbQuery(text);
    } catch (error) {
      this.logger.debug({ error }, "Could not answer callback query");
    }
  }
}

function orderStrikes(strikes, underlyingPriceHint) {
  const unique = Array.from(new Set(strikes)).filter((strike) => Number.isFinite(strike));
  if (!Number.isFinite(underlyingPriceHint) || underlyingPriceHint <= 0) {
    return unique.sort((a, b) => a - b);
  }

  return unique.sort((a, b) => {
    const distance = Math.abs(a - underlyingPriceHint) - Math.abs(b - underlyingPriceHint);
    return distance === 0 ? a - b : distance;
  });
}

module.exports = {
  BotScenes
};
