import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startAiJobRunner } from './jobs/aiJobRunner.js';
import { startPublishScheduler } from './jobs/publishScheduler.js';
import { startGrowthScheduler } from './jobs/growthScheduler.js';
import { startKeepAlive } from './jobs/keepAlive.js';
import { startAutopilotScheduler } from './services/autopilot/runner.js';
import { startTelegramBot } from './services/telegram/bot.js';
import { SiteSettings } from './models/index.js';
import { runMigrations } from './scripts/migrations.js';

async function main() {
  await connectDb();
  await SiteSettings.getSingleton();
  await runMigrations();
  const stopScheduler = startPublishScheduler();
  const stopAiRunner = startAiJobRunner();
  const stopAutopilot = startAutopilotScheduler();
  const stopTelegram = startTelegramBot();
  const stopGrowth = startGrowthScheduler();
  const stopKeepAlive = startKeepAlive();
  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    stopScheduler();
    stopAiRunner();
    stopAutopilot();
    stopTelegram();
    stopGrowth();
    stopKeepAlive();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, `Server failed to start: ${err.message}`);
  // Also printed plainly, so hosting logs (and logs/app.log) show the reason.
  // eslint-disable-next-line no-console
  console.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});
