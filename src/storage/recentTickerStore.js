const path = require("node:path");
const { z } = require("zod");
const { JsonStore } = require("./jsonStore");
const { nowIso } = require("../utils/dates");

const RecentTickerSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  lastUsedAt: z.string().nullable()
}).strict();

const RecentTickersFileSchema = z.object({
  tickers: z.array(RecentTickerSchema)
}).strict();

const DEFAULT_TICKERS = [
  { symbol: "AAPL", name: "Apple Inc.", lastUsedAt: null },
  { symbol: "MSFT", name: "Microsoft Corporation", lastUsedAt: null },
  { symbol: "NVDA", name: "NVIDIA Corp.", lastUsedAt: null },
  { symbol: "TSLA", name: "Tesla, Inc.", lastUsedAt: null },
  { symbol: "SPY", name: "S&P 500 ETF", lastUsedAt: null },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", lastUsedAt: null }
];

class RecentTickerStore {
  constructor({ dataDir, logger }) {
    this.store = new JsonStore({
      filePath: path.join(dataDir, "recentTickers.json"),
      schema: RecentTickersFileSchema,
      defaultData: { tickers: DEFAULT_TICKERS },
      logger
    });
  }

  async init() {
    await this.store.init();
  }

  async list() {
    const data = await this.store.read();
    return data.tickers;
  }

  async findName(symbol) {
    const normalized = symbol.toUpperCase();
    const tickers = await this.list();
    const found = tickers.find((ticker) => ticker.symbol === normalized);
    return found ? found.name : normalized;
  }

  async touch(symbol, name) {
    const normalized = symbol.toUpperCase();
    const displayName = name || normalized;
    const timestamp = nowIso();

    await this.store.update((data) => {
      const existing = data.tickers.filter((ticker) => ticker.symbol !== normalized);
      data.tickers = [
        { symbol: normalized, name: displayName, lastUsedAt: timestamp },
        ...existing
      ].slice(0, 20);
      return data;
    });
  }
}

module.exports = {
  RecentTickerStore
};
