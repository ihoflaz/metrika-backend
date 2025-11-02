import { Request, Response, NextFunction } from 'express';
import { getQueueService } from '../../../modules/automation/queue.service';
import { QueueName } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { Job } from 'bullmq';

const logger = createLogger({ name: 'QueueMetricsController' });

/**
 * Get metrics for all queues
 * Returns job counts, processing rates, and health status
 */
export async function getQueueMetrics(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const queueService = getQueueService(); // Lazy initialization
    const metrics = await Promise.all(
      Object.values(QueueName).map(async (queueName) => {
        const queue = queueService.getQueue(queueName);
        
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const total = waiting + active + completed + failed + delayed;
        const successRate = total > 0 ? ((completed / total) * 100).toFixed(2) : '0.00';
        const failureRate = total > 0 ? ((failed / total) * 100).toFixed(2) : '0.00';

        // Health status
        let health: 'healthy' | 'warning' | 'critical' = 'healthy';
        if (failed > 10 || parseFloat(failureRate) > 20) {
          health = 'critical';
        } else if (failed > 5 || parseFloat(failureRate) > 10) {
          health = 'warning';
        }

        return {
          queueName,
          counts: {
            waiting,
            active,
            completed,
            failed,
            delayed,
            total,
          },
          rates: {
            successRate: `${successRate}%`,
            failureRate: `${failureRate}%`,
          },
          health,
        };
      })
    );

    const overallHealth = metrics.some((m) => m.health === 'critical')
      ? 'critical'
      : metrics.some((m) => m.health === 'warning')
      ? 'warning'
      : 'healthy';

    res.json({
      timestamp: new Date().toISOString(),
      overallHealth,
      queues: metrics,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch queue metrics');
    next(error);
  }
}

/**
 * Get detailed status for a specific queue
 */
export async function getQueueStatus(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { queueName } = req.params;

    if (!Object.values(QueueName).includes(queueName as QueueName)) {
      return res.status(400).json({
        error: 'Invalid queue name',
        validQueues: Object.values(QueueName),
      });
    }

    const queueService = getQueueService(); // Lazy initialization
    const queue = queueService.getQueue(queueName as QueueName);

    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused(),
    ]);

    // Get recent failed jobs
    const failedJobs = await queue.getFailed(0, 10);
    const recentFailures = failedJobs.map((job: Job) => ({
      id: job.id,
      name: job.name,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }));

    // Get recent completed jobs
    const completedJobs = await queue.getCompleted(0, 10);
    const recentCompletions = completedJobs.map((job: Job) => ({
      id: job.id,
      name: job.name,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    }));

    res.json({
      queueName,
      status: paused ? 'paused' : 'active',
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
      recentFailures,
      recentCompletions,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch queue status');
    next(error);
  }
}

/**
 * Retry all failed jobs in a queue
 */
export async function retryFailedJobs(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { queueName } = req.params;

    if (!Object.values(QueueName).includes(queueName as QueueName)) {
      return res.status(400).json({
        error: 'Invalid queue name',
        validQueues: Object.values(QueueName),
      });
    }

    const queueService = getQueueService(); // Lazy initialization
    const queue = queueService.getQueue(queueName as QueueName);
    const failedJobs = await queue.getFailed();

    let retriedCount = 0;
    for (const job of failedJobs) {
      await job.retry();
      retriedCount++;
    }

    logger.info({ queueName, retriedCount }, 'Retried failed jobs');

    res.json({
      message: `Retried ${retriedCount} failed jobs in ${queueName}`,
      retriedCount,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to retry jobs');
    next(error);
  }
}

/**
 * Clean completed/failed jobs older than X hours
 */
export async function cleanOldJobs(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { queueName } = req.params;
    const { olderThanHours = 24, status = 'completed' } = req.query;

    if (!Object.values(QueueName).includes(queueName as QueueName)) {
      return res.status(400).json({
        error: 'Invalid queue name',
        validQueues: Object.values(QueueName),
      });
    }

    const queueService = getQueueService(); // Lazy initialization
    const queue = queueService.getQueue(queueName as QueueName);
    const grace = Number(olderThanHours) * 60 * 60 * 1000; // Convert to ms

    const jobs: string[] = [];
    if (status === 'completed') {
      const completedJobs = await queue.getCompleted(0, -1);
      jobs.push(...completedJobs.map(j => j.id!).filter(Boolean));
    } else if (status === 'failed') {
      const failedJobs = await queue.getFailed(0, -1);
      jobs.push(...failedJobs.map(j => j.id!).filter(Boolean));
    }

    // Remove old jobs
    const removedCount = jobs.length;
    await Promise.all(jobs.map(jobId => queue.remove(jobId)));

    logger.info({ queueName, removedCount, olderThanHours }, 'Cleaned old jobs');

    res.json({
      message: `Cleaned ${removedCount} ${status} jobs older than ${olderThanHours} hours`,
      removedCount,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to clean jobs');
    next(error);
  }
}

/**
 * Pause/Resume a queue
 */
export async function toggleQueuePause(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { queueName } = req.params;
    const { action } = req.body; // 'pause' or 'resume'

    if (!Object.values(QueueName).includes(queueName as QueueName)) {
      return res.status(400).json({
        error: 'Invalid queue name',
        validQueues: Object.values(QueueName),
      });
    }

    const queueService = getQueueService(); // Lazy initialization
    const queue = queueService.getQueue(queueName as QueueName);

    if (action === 'pause') {
      await queue.pause();
      logger.info({ queueName }, 'Queue paused');
    } else if (action === 'resume') {
      await queue.resume();
      logger.info({ queueName }, 'Queue resumed');
    } else {
      return res.status(400).json({
        error: 'Invalid action',
        validActions: ['pause', 'resume'],
      });
    }

    const isPaused = await queue.isPaused();

    res.json({
      queueName,
      status: isPaused ? 'paused' : 'active',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to toggle queue pause');
    next(error);
  }
}
