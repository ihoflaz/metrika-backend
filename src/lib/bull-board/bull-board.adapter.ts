import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueService } from '../../modules/automation/queue.service';
import { QueueName } from '../../config/queue.config';
import { createLogger } from '../logger';

const logger = createLogger({ name: 'BullBoard' });

/**
 * Bull Board Adapter
 * 
 * Queue monitoring ve management için web UI
 * 
 * Features:
 * - Real-time queue metrics
 * - Job inspection (data, logs, stack traces)
 * - Job retry/remove operations
 * - Job progress tracking
 * - Queue pause/resume
 */

let serverAdapter: ExpressAdapter | null = null;

/**
 * Bull Board'u initialize et
 * Tüm queue'ları Bull Board'a ekle
 */
export function initializeBullBoard(): ExpressAdapter {
  if (serverAdapter) {
    logger.warn('Bull Board already initialized');
    return serverAdapter;
  }

  try {
    const queueService = getQueueService();

    // Express adapter oluştur
    serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    // Tüm queue'ları BullMQAdapter ile ekle
    const queueAdapters = Object.values(QueueName).map((queueName) => {
      const queue = queueService.getQueue(queueName);
      return new BullMQAdapter(queue);
    });

    // Bull Board'u oluştur
    createBullBoard({
      queues: queueAdapters,
      serverAdapter,
    });

    logger.info('📊 Bull Board initialized successfully');
    logger.info(`   - Monitoring ${queueAdapters.length} queues`);
    logger.info(`   - Access UI at: /admin/queues`);

    return serverAdapter;
  } catch (error) {
    logger.error({ error }, '❌ Failed to initialize Bull Board');
    throw error;
  }
}

/**
 * Bull Board adapter'ını al
 * Initialize edilmemişse hata fırlat
 */
export function getBullBoardAdapter(): ExpressAdapter {
  if (!serverAdapter) {
    throw new Error('Bull Board not initialized. Call initializeBullBoard() first.');
  }
  return serverAdapter;
}

/**
 * Bull Board'u cleanup et (test için)
 */
export function cleanupBullBoard(): void {
  serverAdapter = null;
  logger.info('🧹 Bull Board cleaned up');
}
