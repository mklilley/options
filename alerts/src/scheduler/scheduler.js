function startScheduler({ intervalMinutes, task, logger }) {
  const intervalMs = intervalMinutes * 60 * 1000;
  let running = false;

  async function runScheduledCheck() {
    if (running) {
      logger.warn("Skipping scheduled alert check because the previous check is still running");
      return;
    }

    running = true;
    try {
      await task();
    } catch (error) {
      logger.error({ error }, "Scheduled alert check failed");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(runScheduledCheck, intervalMs);
  logger.info({ intervalMinutes }, "Alert scheduler started");

  return {
    stop() {
      clearInterval(timer);
      logger.info("Alert scheduler stopped");
    }
  };
}

module.exports = {
  startScheduler
};
