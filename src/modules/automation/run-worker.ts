/**
 * Worker Test Runner
 * 
 * Queue'daki job'ları işlemek için task monitor worker'ı başlatır
 */

import { startTaskMonitorWorker } from './workers/task-monitor.worker';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'WorkerRunner' });

logger.info('🚀 Starting task monitor worker...');
const worker = startTaskMonitorWorker();

logger.info('✅ Worker started. Listening for jobs...');
logger.info('Press Ctrl+C to stop');

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\n🛑 Shutting down worker...');
  await worker.close();
  logger.info('✅ Worker stopped');
  process.exit(0);
});

// Keep process alive
setInterval(() => {
  logger.debug('Worker still running...');
}, 30000);
