import type { Server } from 'node:http';
import { buildContainer } from './di/container';
import { createLogger } from './lib/logger';
import { startSchedulers, stopSchedulers } from './lib/cron/schedulers';
import { TaskAutomationWorker } from './modules/automation/task-automation.worker';
import { KPIMonitoringWorker } from './modules/automation/kpi-monitoring.worker';
import { DocumentApprovalWorker } from './modules/automation/document-approval.worker';
import { NotificationWorker } from './modules/automation/notification.worker';

const logger = createLogger({ name: 'server' });

// Worker instances (will be initialized in startServer)
let taskWorker: TaskAutomationWorker | null = null;
let kpiWorker: KPIMonitoringWorker | null = null;
let documentWorker: DocumentApprovalWorker | null = null;
let notificationWorker: NotificationWorker | null = null;

export const startServer = async (): Promise<Server> => {
  const container = buildContainer();
  const config = container.resolve('config');
  const appLogger = container.resolve('logger');
  const app = container.resolve('app');
  const prisma = container.resolve('prisma');

  // Initialize Workers
  logger.info('🚀 Initializing BullMQ workers...');
  
  taskWorker = new TaskAutomationWorker(prisma);
  logger.info('✅ TaskAutomationWorker initialized');
  
  kpiWorker = new KPIMonitoringWorker(prisma);
  logger.info('✅ KPIMonitoringWorker initialized');
  
  documentWorker = new DocumentApprovalWorker(prisma);
  logger.info('✅ DocumentApprovalWorker initialized');
  
  notificationWorker = new NotificationWorker(config);
  logger.info('✅ NotificationWorker initialized');

  // Start Cron Schedulers
  logger.info('⏰ Starting cron schedulers...');
  startSchedulers();
  logger.info('✅ All cron schedulers started');

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.APP_PORT, config.APP_HOST, () => {
      appLogger.info({ port: config.APP_PORT, host: config.APP_HOST }, 'HTTP server started');
      logger.info('📊 Workers are listening to Redis queues');
      logger.info('⏰ Scheduled jobs are running');
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

    // 2. Stop Cron Schedulers
    logger.info('⏰ Stopping cron schedulers...');
    stopSchedulers();
    logger.info('✅ Cron schedulers stopped');

    // 3. Close Workers (finish current jobs, then disconnect)
    logger.info('🛑 Closing workers...');
    try {
      if (taskWorker) {
        await taskWorker.close();
        logger.info('✅ TaskAutomationWorker closed');
      }
      if (kpiWorker) {
        await kpiWorker.close();
        logger.info('✅ KPIMonitoringWorker closed');
      }
      if (documentWorker) {
        await documentWorker.close();
        logger.info('✅ DocumentApprovalWorker closed');
      }
      if (notificationWorker) {
        await notificationWorker.close();
        logger.info('✅ NotificationWorker closed');
      }
    } catch (error) {
      logger.error({ error }, '❌ Error closing workers');
    }

    // 4. Close QueueService (cleanup queue connections)
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
      logger.info('🎉 All systems operational:');
      logger.info('   - HTTP Server listening');
      logger.info('   - 4 BullMQ Workers active');
      logger.info('   - 8 Cron Schedulers running');
      logger.info('   - Redis connection established');
    })
    .catch((error) => {
      logger.error({ error }, '❌ Fatal error while starting the server');
      process.exitCode = 1;
    });
}
