/**
 * Alert Service Integration Examples
 * 
 * This file demonstrates how to integrate AlertService with:
 * 1. Queue workers (BullMQ)
 * 2. Error handlers
 * 3. Health checks
 * 4. Custom monitoring
 */

import { AlertService, AlertCategory, AlertLevel, createAlertService } from '../lib/alert.service';
import { Queue, Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { EmailService } from '../modules/notifications/email.service';

/**
 * Example 1: Queue Worker with Alerts
 */
export function setupQueueAlerts(queue: Queue, alertService: AlertService) {
  // Alert on failed jobs threshold
  queue.on('failed', async (job, err) => {
    const failedCount = await queue.getFailedCount();

    if (failedCount > 10) {
      await alertService.critical(
        AlertCategory.QUEUE_HEALTH,
        'Queue Health Critical',
        `Queue "${queue.name}" has ${failedCount} failed jobs`,
        {
          queueName: queue.name,
          failedCount,
          latestError: err.message,
          jobId: job?.id,
          jobName: job?.name,
        }
      );
    } else if (failedCount > 5) {
      await alertService.warning(
        AlertCategory.QUEUE_HEALTH,
        'Queue Health Warning',
        `Queue "${queue.name}" has ${failedCount} failed jobs`,
        {
          queueName: queue.name,
          failedCount,
          latestError: err.message,
        }
      );
    }
  });

  // Alert on queue pause
  queue.on('paused', async () => {
    await alertService.warning(
      AlertCategory.QUEUE_HEALTH,
      'Queue Paused',
      `Queue "${queue.name}" has been paused`,
      {
        queueName: queue.name,
        timestamp: new Date().toISOString(),
      }
    );
  });

  // Alert if queue paused for too long
  setInterval(async () => {
    const isPaused = await queue.isPaused();
    if (isPaused) {
      await alertService.critical(
        AlertCategory.QUEUE_HEALTH,
        'Queue Paused Too Long',
        `Queue "${queue.name}" has been paused for over 5 minutes`,
        {
          queueName: queue.name,
          pausedDuration: '5+ minutes',
        }
      );
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

/**
 * Example 2: Worker Error Handler with Alerts
 */
export function createWorkerWithAlerts(
  queueName: string,
  processor: any,
  alertService: AlertService
): Worker {
  const worker = new Worker(queueName, processor, {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  });

  // Alert on worker errors
  worker.on('error', async (error) => {
    await alertService.critical(
      AlertCategory.SYSTEM_HEALTH,
      'Worker Error',
      `Worker for queue "${queueName}" encountered an error`,
      {
        queueName,
        error: error.message,
        stack: error.stack,
      }
    );
  });

  // Alert on worker stall
  worker.on('stalled', async (jobId) => {
    await alertService.warning(
      AlertCategory.QUEUE_HEALTH,
      'Job Stalled',
      `Job ${jobId} in queue "${queueName}" has stalled`,
      {
        queueName,
        jobId,
      }
    );
  });

  return worker;
}

/**
 * Example 3: Redis Connection Monitoring
 */
export function monitorRedisConnection(alertService: AlertService) {
  const Redis = require('ioredis');
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });

  redis.on('error', async (error: Error) => {
    await alertService.critical(
      AlertCategory.SYSTEM_HEALTH,
      'Redis Connection Error',
      'Redis connection has failed',
      {
        error: error.message,
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      }
    );
  });

  redis.on('reconnecting', async () => {
    await alertService.warning(
      AlertCategory.SYSTEM_HEALTH,
      'Redis Reconnecting',
      'Redis connection lost, attempting to reconnect',
      {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      }
    );
  });

  redis.on('connect', async () => {
    await alertService.info(
      AlertCategory.SYSTEM_HEALTH,
      'Redis Connected',
      'Redis connection established successfully',
      {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      }
    );
  });

  return redis;
}

/**
 * Example 4: Email Delivery Monitoring
 */
export function monitorEmailDelivery(
  emailService: EmailService,
  alertService: AlertService
) {
  let sentCount = 0;
  let failedCount = 0;

  // Wrap original send method
  const originalSend = emailService.send.bind(emailService);
  emailService.send = async (options: any) => {
    try {
      const result = await originalSend(options);
      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
      }
      return result;
    } catch (error) {
      failedCount++;
      throw error;
    }
  };

  // Check failure rate every 5 minutes
  setInterval(async () => {
    if (sentCount + failedCount > 0) {
      const failureRate = (failedCount / (sentCount + failedCount)) * 100;

      if (failureRate > 10) {
        await alertService.critical(
          AlertCategory.EMAIL_DELIVERY,
          'High Email Failure Rate',
          `Email failure rate is ${failureRate.toFixed(1)}%`,
          {
            sent: sentCount,
            failed: failedCount,
            failureRate: `${failureRate.toFixed(1)}%`,
          }
        );
      } else if (failureRate > 5) {
        await alertService.warning(
          AlertCategory.EMAIL_DELIVERY,
          'Elevated Email Failure Rate',
          `Email failure rate is ${failureRate.toFixed(1)}%`,
          {
            sent: sentCount,
            failed: failedCount,
            failureRate: `${failureRate.toFixed(1)}%`,
          }
        );
      }

      // Reset counters
      sentCount = 0;
      failedCount = 0;
    }
  }, 5 * 60 * 1000);
}

/**
 * Example 5: System Health Check
 */
export async function runHealthCheck(alertService: AlertService) {
  try {
    // Check database
    const { prisma } = await import('../db/prisma-client');
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    await redis.ping();
    redis.disconnect();

    // Check disk space (example)
    const diskUsage = require('diskusage');
    const info = await diskUsage.check('/');
    const usagePercent = ((info.total - info.available) / info.total) * 100;

    if (usagePercent > 90) {
      await alertService.critical(
        AlertCategory.SYSTEM_HEALTH,
        'Critical Disk Space',
        `Disk usage is at ${usagePercent.toFixed(1)}%`,
        {
          total: info.total,
          available: info.available,
          used: info.total - info.available,
          usagePercent: `${usagePercent.toFixed(1)}%`,
        }
      );
    } else if (usagePercent > 80) {
      await alertService.warning(
        AlertCategory.SYSTEM_HEALTH,
        'High Disk Usage',
        `Disk usage is at ${usagePercent.toFixed(1)}%`,
        {
          total: info.total,
          available: info.available,
          usagePercent: `${usagePercent.toFixed(1)}%`,
        }
      );
    }
  } catch (error: any) {
    await alertService.critical(
      AlertCategory.SYSTEM_HEALTH,
      'Health Check Failed',
      'System health check encountered an error',
      {
        error: error.message,
        stack: error.stack,
      }
    );
  }
}

/**
 * Example 6: Security Alert
 */
export async function alertSecurityEvent(
  alertService: AlertService,
  event: {
    type: 'failed_login' | 'brute_force' | 'privilege_escalation' | 'unauthorized_access';
    userId?: string;
    ipAddress?: string;
    resource?: string;
    details?: any;
  }
) {
  await alertService.critical(
    AlertCategory.SECURITY,
    `Security Event: ${event.type}`,
    `Security event detected: ${event.type}`,
    {
      eventType: event.type,
      userId: event.userId,
      ipAddress: event.ipAddress,
      resource: event.resource,
      details: event.details,
      timestamp: new Date().toISOString(),
    }
  );
}

/**
 * Example 7: Performance Monitoring
 */
export function monitorPerformance(alertService: AlertService) {
  // Track memory usage
  setInterval(async () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const usagePercent = (heapUsedMB / heapTotalMB) * 100;

    if (usagePercent > 90) {
      await alertService.critical(
        AlertCategory.PERFORMANCE,
        'Critical Memory Usage',
        `Heap memory usage is at ${usagePercent.toFixed(1)}%`,
        {
          heapUsed: `${heapUsedMB.toFixed(2)} MB`,
          heapTotal: `${heapTotalMB.toFixed(2)} MB`,
          usagePercent: `${usagePercent.toFixed(1)}%`,
        }
      );
    } else if (usagePercent > 80) {
      await alertService.warning(
        AlertCategory.PERFORMANCE,
        'High Memory Usage',
        `Heap memory usage is at ${usagePercent.toFixed(1)}%`,
        {
          heapUsed: `${heapUsedMB.toFixed(2)} MB`,
          heapTotal: `${heapTotalMB.toFixed(2)} MB`,
          usagePercent: `${usagePercent.toFixed(1)}%`,
        }
      );
    }
  }, 60 * 1000); // Check every minute
}

/**
 * Example 8: Bootstrap All Monitoring
 */
export async function bootstrapMonitoring(
  emailService: EmailService,
  queues: { [name: string]: Queue }
) {
  // Create alert service
  const alertService = createAlertService(emailService, logger);

  // Setup queue monitoring
  for (const [name, queue] of Object.entries(queues)) {
    setupQueueAlerts(queue, alertService);
    logger.info({ queueName: name }, 'Queue monitoring enabled');
  }

  // Setup Redis monitoring
  monitorRedisConnection(alertService);

  // Setup email delivery monitoring
  monitorEmailDelivery(emailService, alertService);

  // Setup performance monitoring
  monitorPerformance(alertService);

  // Run health check every 5 minutes
  setInterval(() => runHealthCheck(alertService), 5 * 60 * 1000);
  // Run initial health check
  await runHealthCheck(alertService);

  logger.info('✅ Monitoring and alerting system initialized');

  return alertService;
}
