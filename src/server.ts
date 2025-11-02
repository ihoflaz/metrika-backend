import type { Server } from 'node:http';
import { buildContainer } from './di/container';
import { getCronService } from './modules/automation/cron.service';
import { createLogger } from './lib/logger';

// Worker imports - bunlar import edildiklerinde otomatik olarak başlar
import './modules/automation/workers/task-monitor.worker';
import './modules/automation/workers/kpi-monitor.worker';
import './modules/automation/workers/document-approval.worker';
import './modules/automation/workers/notification.worker';

const logger = createLogger({ name: 'server' });

export const startServer = async (): Promise<Server> => {
  const container = buildContainer();
  const config = container.resolve('config');
  const appLogger = container.resolve('logger');
  const app = container.resolve('app');

  // Start CronService
  const cronService = getCronService();
  cronService.start();
  logger.info('✅ CronService started');

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.APP_PORT, config.APP_HOST, () => {
      appLogger.info({ port: config.APP_PORT, host: config.APP_HOST }, 'HTTP server started');
      resolve(server);
    });

    server.on('error', (err: Error) => {
      appLogger.error({ err }, 'Failed to start HTTP server');
      reject(err);
    });
  });
};

if (require.main === module) {
  let server: Server | null = null;

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '🛑 Graceful shutdown initiated');

    // 1. Stop accepting new connections
    if (server) {
      server.close(() => {
        logger.info('✅ HTTP server closed');
      });
    }

    // 2. Stop CronService
    const cronService = getCronService();
    cronService.stop();
    logger.info('✅ CronService stopped');

    // 3. Close QueueService (workers will finish current jobs)
    const { getQueueService } = await import('./modules/automation/queue.service');
    const queueService = getQueueService();
    await queueService.close();
    logger.info('✅ QueueService closed');

    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  startServer()
    .then((s) => {
      server = s;
      logger.info('✅ Server started successfully');
      logger.info('📊 Workers are listening to Redis queues');
      logger.info('⏰ CronService is scheduling periodic jobs');
    })
    .catch((error) => {
      logger.error({ error }, '❌ Fatal error while starting the server');
      process.exitCode = 1;
    });
}
