const { evaluateAlert, markAlertUnchecked } = require("./alertEvaluator");
const { selectAlertPrice } = require("../massive/priceSelector");
const { nowIso } = require("../utils/dates");
const {
  formatAlertTriggeredMessage,
  formatCheckSummary
} = require("../bot/formatters");

class AlertEngine {
  constructor({ alertStore, appStateStore, massiveClient, sendMessage, config, logger }) {
    this.alertStore = alertStore;
    this.appStateStore = appStateStore;
    this.massiveClient = massiveClient;
    this.sendMessage = sendMessage;
    this.config = config;
    this.logger = logger;
    this.running = false;
  }

  async checkAll(options = {}) {
    const { manual = false, alertId = null, telegramUserId = null } = options;

    if (this.running) {
      return {
        checkedCount: 0,
        triggeredCount: 0,
        skippedCount: 0,
        summaries: [{
          status: "skipped",
          message: "A check is already running."
        }]
      };
    }

    this.running = true;
    await this.appStateStore.setCheckStarted();

    const checkedAt = nowIso();
    const summaries = [];
    const triggeredMessages = [];
    let changed = false;
    let allAlerts = [];

    try {
      allAlerts = await this.alertStore.list();
      let alertsToCheck = alertId
        ? allAlerts.filter((alert) => (
          alert.id === alertId &&
          (!telegramUserId || alert.telegramUserId === String(telegramUserId))
        ))
        : allAlerts.filter((alert) => (
          alert.active &&
          (!telegramUserId || alert.telegramUserId === String(telegramUserId))
        ));

      if (alertId && alertsToCheck.length === 0) {
        summaries.push({
          status: "not_found",
          message: "Alert not found."
        });
      }

      for (const alert of alertsToCheck) {
        try {
          const snapshot = await this.massiveClient.getOptionSnapshot(alert.underlyingSymbol, alert.optionContract);
          const selectedPrice = selectAlertPrice(snapshot, {
            staleTradeMaxMinutes: this.config.staleTradeMaxMinutes,
            nowMs: Date.parse(checkedAt)
          });

          if (!selectedPrice.available) {
            Object.assign(alert, markAlertUnchecked(alert, selectedPrice, checkedAt));
            changed = true;

            this.logger.info({
              alertId: alert.id,
              optionContract: alert.optionContract,
              reason: selectedPrice.reason
            }, "Alert skipped because no usable option price was available");

            summaries.push({
              alert,
              selectedPrice,
              snapshot,
              status: "skipped",
              reason: selectedPrice.reason
            });
            continue;
          }

          if (!alert.active) {
            const absoluteChange = selectedPrice.price - alert.entryPrice;
            const percentChange = (absoluteChange / alert.entryPrice) * 100;
            alert.updatedAt = checkedAt;
            alert.lastObservedPrice = selectedPrice.price;
            alert.lastObservedAt = checkedAt;
            alert.lastObservedPriceSource = selectedPrice.source;
            alert.lastObservedChangePercent = percentChange;
            changed = true;

            summaries.push({
              alert,
              selectedPrice,
              snapshot,
              status: "paused",
              evaluation: {
                absoluteChange,
                percentChange,
                shouldNotify: false,
                status: "paused"
              }
            });
            continue;
          }

          const evaluation = evaluateAlert(alert, selectedPrice, checkedAt);
          Object.assign(alert, evaluation.updatedAlert);
          changed = true;

          if (evaluation.shouldNotify) {
            if (alert.chatId) {
              triggeredMessages.push({
                chatId: alert.chatId,
                message: formatAlertTriggeredMessage(alert, selectedPrice, evaluation, snapshot, checkedAt)
              });
            } else {
              this.logger.error({
                alertId: alert.id,
                telegramUserId: alert.telegramUserId
              }, "Alert triggered but has no chatId; cannot send Telegram message");
            }
          }

          summaries.push({
            alert,
            selectedPrice,
            snapshot,
            status: evaluation.status,
            evaluation
          });
        } catch (error) {
          this.logger.error({
            alertId: alert.id,
            optionContract: alert.optionContract,
            error
          }, "Alert check failed");

          summaries.push({
            alert,
            status: "error",
            reason: error.message
          });
        }
      }

      if (changed) {
        await this.alertStore.saveAll(allAlerts);
      }

      await this.appStateStore.setCheckFinished("ok");
    } catch (error) {
      await this.appStateStore.setCheckFinished("error");
      throw error;
    } finally {
      this.running = false;
    }

    for (const triggeredMessage of triggeredMessages) {
      try {
        await this.sendMessage(triggeredMessage.chatId, triggeredMessage.message);
      } catch (error) {
        this.logger.error({ chatId: triggeredMessage.chatId, error }, "Failed to send Telegram alert message");
      }
    }

    return {
      checkedCount: alertId ? summaries.filter((summary) => summary.alert).length : summaries.length,
      triggeredCount: triggeredMessages.length,
      skippedCount: summaries.filter((summary) => summary.status === "skipped" || summary.status === "error").length,
      manual,
      summaries,
      summaryText: formatCheckSummary(summaries)
    };
  }
}

module.exports = {
  AlertEngine
};
