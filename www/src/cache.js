const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

class JsonCache {
  constructor({ cacheDir }) {
    this.cacheDir = cacheDir;
  }

  async cleanup({ maxAgeDays = 90 } = {}) {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const entries = await fs.readdir(this.cacheDir, { withFileTypes: true });
    const summary = {
      checked: 0,
      deleted: 0,
      expired: 0,
      tooOld: 0,
      invalid: 0,
      errors: 0
    };

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      summary.checked += 1;
      const filePath = path.join(this.cacheDir, entry.name);

      try {
        const decision = await this.cleanupDecision(filePath, now, maxAgeMs);
        if (!decision.delete) continue;

        await fs.unlink(filePath);
        summary.deleted += 1;
        summary[decision.reason] += 1;
      } catch {
        summary.errors += 1;
      }
    }

    return summary;
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

  async cleanupDecision(filePath, now, maxAgeMs) {
    const stat = await fs.stat(filePath);
    const raw = await fs.readFile(filePath, "utf8");
    let payload;

    try {
      payload = JSON.parse(raw);
    } catch {
      return { delete: true, reason: "invalid" };
    }

    const expiresAt = Date.parse(payload && payload.expiresAt);
    const cachedAt = Date.parse(payload && payload.cachedAt);
    const ageBasis = Number.isFinite(cachedAt) ? cachedAt : stat.mtimeMs;

    if (!Number.isFinite(expiresAt)) {
      return { delete: true, reason: "invalid" };
    }

    if (expiresAt <= now) {
      return { delete: true, reason: "expired" };
    }

    if (ageBasis <= now - maxAgeMs) {
      return { delete: true, reason: "tooOld" };
    }

    return { delete: false };
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
