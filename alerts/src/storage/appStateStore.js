const path = require("node:path");
const { z } = require("zod");
const { JsonStore } = require("./jsonStore");
const { nowIso } = require("../utils/dates");

const FlowSchema = z.object({
  type: z.string().min(1),
  step: z.string().min(1),
  data: z.record(z.any()).default({}),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)))
}).passthrough();

const AppStateSchema = z.object({
  version: z.literal(1),
  activeFlow: FlowSchema.nullable().default(null),
  activeFlows: z.record(FlowSchema).default({}),
  lastCheckStartedAt: z.string().nullable(),
  lastCheckFinishedAt: z.string().nullable(),
  lastCheckStatus: z.string().nullable()
}).strict();

const DEFAULT_APP_STATE = {
  version: 1,
  activeFlow: null,
  activeFlows: {},
  lastCheckStartedAt: null,
  lastCheckFinishedAt: null,
  lastCheckStatus: null
};

class AppStateStore {
  constructor({ dataDir, logger }) {
    this.store = new JsonStore({
      filePath: path.join(dataDir, "appState.json"),
      schema: AppStateSchema,
      defaultData: DEFAULT_APP_STATE,
      logger
    });
  }

  async init() {
    await this.store.init();
  }

  async get() {
    return this.store.read();
  }

  async getFlow(telegramUserId) {
    const state = await this.get();
    if (!telegramUserId) return state.activeFlow;
    return state.activeFlows[String(telegramUserId)] || null;
  }

  async setFlow(telegramUserId, flow) {
    if (flow === undefined) {
      flow = telegramUserId;
      telegramUserId = null;
    }

    const nextFlow = flow
      ? { ...flow, data: flow.data || {}, updatedAt: nowIso() }
      : null;

    await this.store.update((state) => {
      if (!telegramUserId) {
        state.activeFlow = nextFlow;
      } else if (nextFlow) {
        state.activeFlows[String(telegramUserId)] = nextFlow;
      } else {
        delete state.activeFlows[String(telegramUserId)];
      }
      return state;
    });
    return nextFlow;
  }

  async clearFlow(telegramUserId) {
    await this.setFlow(telegramUserId || null, null);
  }

  async setCheckStarted() {
    const startedAt = nowIso();
    await this.store.update((state) => {
      state.lastCheckStartedAt = startedAt;
      state.lastCheckStatus = "running";
      return state;
    });
    return startedAt;
  }

  async setCheckFinished(status) {
    const finishedAt = nowIso();
    await this.store.update((state) => {
      state.lastCheckFinishedAt = finishedAt;
      state.lastCheckStatus = status;
      return state;
    });
    return finishedAt;
  }
}

module.exports = {
  AppStateStore
};
