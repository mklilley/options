const fs = require("node:fs/promises");
const path = require("node:path");
const { fileTimestamp } = require("../utils/dates");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(typeof value === "function" ? value() : value));
}

class JsonStore {
  constructor({ filePath, schema, defaultData, logger }) {
    this.filePath = filePath;
    this.schema = schema;
    this.defaultData = defaultData;
    this.logger = logger;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    if (!(await exists(this.filePath))) {
      await this.write(clone(this.defaultData), { backup: false });
      this.initialized = true;
      return;
    }

    const loaded = await this.tryLoadFile(this.filePath);
    if (loaded.ok) {
      this.initialized = true;
      return;
    }

    const backupPath = `${this.filePath}.bak`;
    const loadedBackup = await this.tryLoadFile(backupPath);
    if (loadedBackup.ok) {
      this.logger.warn({ file: this.filePath, backupPath, error: loaded.error.message }, "Restoring JSON store from backup");
      await this.write(loadedBackup.data, { backup: false });
      this.initialized = true;
      return;
    }

    const corruptPath = `${this.filePath}.corrupt-${fileTimestamp()}`;
    this.logger.error({ file: this.filePath, corruptPath, error: loaded.error.message }, "JSON store is corrupt; preserving corrupt copy and recreating default data");

    try {
      await fs.copyFile(this.filePath, corruptPath);
    } catch (error) {
      this.logger.error({ file: this.filePath, error }, "Failed to preserve corrupt JSON file");
    }

    await this.write(clone(this.defaultData), { backup: false });
    this.initialized = true;
  }

  async read() {
    await this.init();
    const loaded = await this.tryLoadFile(this.filePath);
    if (!loaded.ok) {
      throw loaded.error;
    }
    return loaded.data;
  }

  async write(data, options = {}) {
    const { backup = true } = options;
    const parsed = this.schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Refusing to write invalid JSON store ${this.filePath}: ${parsed.error.message}`);
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    if (backup && (await exists(this.filePath))) {
      try {
        await fs.copyFile(this.filePath, `${this.filePath}.bak`);
      } catch (error) {
        this.logger.warn({ file: this.filePath, error }, "Could not write JSON backup");
      }
    }

    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const json = `${JSON.stringify(parsed.data, null, 2)}\n`;

    try {
      await fs.writeFile(tempPath, json, { encoding: "utf8", flag: "wx" });
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Nothing useful to do; the original file was not renamed.
      }
      throw error;
    }
  }

  async update(mutator) {
    const data = await this.read();
    const nextData = await mutator(data);
    await this.write(nextData || data);
    return nextData || data;
  }

  async tryLoadFile(filePath) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsedJson = JSON.parse(raw);
      const parsedData = this.schema.safeParse(parsedJson);
      if (!parsedData.success) {
        throw new Error(parsedData.error.message);
      }
      return { ok: true, data: parsedData.data };
    } catch (error) {
      return { ok: false, error };
    }
  }
}

module.exports = {
  JsonStore
};
