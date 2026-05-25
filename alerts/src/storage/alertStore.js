const path = require("node:path");
const { JsonStore } = require("./jsonStore");
const { AlertsFileSchema, DEFAULT_ALERTS_FILE } = require("../alerts/alertTypes");
const { nowIso } = require("../utils/dates");

class AlertStore {
  constructor({ dataDir, logger }) {
    this.store = new JsonStore({
      filePath: path.join(dataDir, "alerts.json"),
      schema: AlertsFileSchema,
      defaultData: DEFAULT_ALERTS_FILE,
      logger
    });
  }

  async init() {
    await this.store.init();
  }

  async list() {
    const data = await this.store.read();
    return data.alerts;
  }

  async listActive() {
    const alerts = await this.list();
    return alerts.filter((alert) => alert.active);
  }

  async listForUser(telegramUserId) {
    const alerts = await this.list();
    return alerts.filter((alert) => alert.telegramUserId === String(telegramUserId));
  }

  async listActiveForUser(telegramUserId) {
    const alerts = await this.listForUser(telegramUserId);
    return alerts.filter((alert) => alert.active);
  }

  async getById(id) {
    const alerts = await this.list();
    return alerts.find((alert) => alert.id === id) || null;
  }

  async getByIdForUser(id, telegramUserId) {
    const alert = await this.getById(id);
    if (!alert || alert.telegramUserId !== String(telegramUserId)) return null;
    return alert;
  }

  async add(alert) {
    await this.store.update((data) => {
      data.alerts.push(alert);
      return data;
    });
    return alert;
  }

  async updateAlert(id, updater) {
    let updated = null;

    await this.store.update((data) => {
      const index = data.alerts.findIndex((alert) => alert.id === id);
      if (index === -1) return data;

      const nextAlert = updater({ ...data.alerts[index] });
      nextAlert.updatedAt = nowIso();
      data.alerts[index] = nextAlert;
      updated = nextAlert;
      return data;
    });

    return updated;
  }

  async updateAlertForUser(id, telegramUserId, updater) {
    let updated = null;
    const ownerId = String(telegramUserId);

    await this.store.update((data) => {
      const index = data.alerts.findIndex((alert) => alert.id === id && alert.telegramUserId === ownerId);
      if (index === -1) return data;

      const nextAlert = updater({ ...data.alerts[index] });
      nextAlert.updatedAt = nowIso();
      data.alerts[index] = nextAlert;
      updated = nextAlert;
      return data;
    });

    return updated;
  }

  async remove(id) {
    let removed = null;

    await this.store.update((data) => {
      const index = data.alerts.findIndex((alert) => alert.id === id);
      if (index === -1) return data;

      removed = data.alerts[index];
      data.alerts.splice(index, 1);
      return data;
    });

    return removed;
  }

  async removeForUser(id, telegramUserId) {
    let removed = null;
    const ownerId = String(telegramUserId);

    await this.store.update((data) => {
      const index = data.alerts.findIndex((alert) => alert.id === id && alert.telegramUserId === ownerId);
      if (index === -1) return data;

      removed = data.alerts[index];
      data.alerts.splice(index, 1);
      return data;
    });

    return removed;
  }

  async saveAll(alerts) {
    await this.store.write({ alerts });
  }
}

module.exports = {
  AlertStore
};
