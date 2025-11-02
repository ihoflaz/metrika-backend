/**
 * KPI Monitor Worker Runner
 * 
 * Queue'daki KPI automation job'larını işlemek için worker başlatır
 */

import { startKpiMonitorWorker } from './workers/kpi-monitor.worker';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'KPIWorkerRunner' });

logger.info('🚀 Starting KPI monitor worker...');
const worker = startKpiMonitorWorker();

logger.info('✅ Worker started. Listening for KPI jobs...');
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
