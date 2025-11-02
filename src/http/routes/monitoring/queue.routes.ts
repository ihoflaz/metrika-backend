import { Router } from 'express';
import {
  getQueueMetrics,
  getQueueStatus,
  retryFailedJobs,
  cleanOldJobs,
  toggleQueuePause,
} from '../../controllers/monitoring/queue-metrics.controller';

export function createMonitoringRouter(): Router {
  const router = Router();

  /**
   * @route   GET /api/v1/monitoring/queues
   * @desc    Get metrics for all queues
   * @access  Private (SYSADMIN only)
   */
  router.get('/', getQueueMetrics);

  /**
   * @route   GET /api/v1/monitoring/queues/:queueName
   * @desc    Get detailed status for a specific queue
   * @access  Private (SYSADMIN only)
   */
  router.get('/:queueName', getQueueStatus);

  /**
   * @route   POST /api/v1/monitoring/queues/:queueName/retry
   * @desc    Retry all failed jobs in a queue
   * @access  Private (SYSADMIN only)
   */
  router.post('/:queueName/retry', retryFailedJobs);

  /**
   * @route   DELETE /api/v1/monitoring/queues/:queueName/clean
   * @desc    Clean old completed/failed jobs
   * @access  Private (SYSADMIN only)
   * @query   olderThanHours (default: 24), status (completed|failed)
   */
  router.delete('/:queueName/clean', cleanOldJobs);

  /**
   * @route   PATCH /api/v1/monitoring/queues/:queueName/pause
   * @desc    Pause or resume a queue
   * @access  Private (SYSADMIN only)
   * @body    { action: 'pause' | 'resume' }
   */
  router.patch('/:queueName/pause', toggleQueuePause);

  return router;
}

export default createMonitoringRouter;
