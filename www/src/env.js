const fs = require("node:fs");
const path = require("node:path");

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const projectRoot = path.resolve(__dirname, "..");

  loadDotEnvFile(path.join(projectRoot, ".env"));

  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || "127.0.0.1";
  const cacheTtlMinutes = Number(process.env.CACHE_TTL_MINUTES || 60);

  if (!process.env.MASSIVE_API_KEY) {
    throw new Error("MASSIVE_API_KEY is required in www/.env");
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  if (!Number.isInteger(cacheTtlMinutes) || cacheTtlMinutes <= 0) {
    throw new Error("CACHE_TTL_MINUTES must be a positive integer");
  }

  const cacheDir = path.resolve(projectRoot, process.env.CACHE_DIR || "./cache");

  return {
    projectRoot,
    publicDir: path.join(projectRoot, "public"),
    massiveApiKey: process.env.MASSIVE_API_KEY,
    host,
    port,
    cacheDir,
    cacheTtlMinutes
  };
}

module.exports = {
  loadEnv
};
