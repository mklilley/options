const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

class JsonCache {
  constructor({ cacheDir }) {
    this.cacheDir = cacheDir;
  }

  async getOrSet(namespace, params, ttlMs, loader) {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const key = cacheKey(namespace, params);
    const filePath = path.join(this.cacheDir, `${key}.json`);

    const cached = await this.read(filePath);
    if (cached && cached.expiresAt && Date.parse(cached.expiresAt) > Date.now()) {
      return {
        data: cached.data,
        cache: {
          hit: true,
          key,
          cachedAt: cached.cachedAt,
          expiresAt: cached.expiresAt
        }
      };
    }

    const data = await loader();
    const now = Date.now();
    const payload = {
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      namespace,
      params,
      data
    };

    await this.write(filePath, payload);

    return {
      data,
      cache: {
        hit: false,
        key,
        cachedAt: payload.cachedAt,
        expiresAt: payload.expiresAt
      }
    };
  }

  async read(filePath) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async write(filePath, data) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }
}

function cacheKey(namespace, params) {
  const stable = stableStringify({ namespace, params });
  return crypto.createHash("sha1").update(stable).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }

  return JSON.stringify(value);
}

module.exports = {
  JsonCache
};
