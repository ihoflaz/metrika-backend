/**
 * Cron Job Schedulers
 * 
 * Manages periodic jobs for task monitoring, KPI calculations,
 * document approvals, and automated reports.
 */

import * as cron from 'node-cron';
import { getQueueService } from '../../modules/automation/queue.service';
import { logger } from '../logger';

// Store cron tasks for cleanup
const cronTasks: cron.ScheduledTask[] = [];

/**
 * Start all scheduled cron jobs
 */
export function startSchedulers(): void {
  const queueService = getQueueService();

  // Task Monitoring - Every 15 minutes
  // Check for overdue tasks and send reminders
  const taskMonitorJob = cron.schedule('*/15 * * * *', async () => {
    logger.info('⏰ Running scheduled task monitoring');
    try {
      await queueService.addTaskAutomationJob({
        action: 'CHECK_OVERDUE',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue task monitoring job');
    }
  });
  cronTasks.push(taskMonitorJob);
  logger.info('✅ Task monitoring scheduler started (every 15 minutes)');

  // Task Delay Check - Every 30 minutes
  // Check for tasks approaching deadline
  const taskDelayJob = cron.schedule('*/30 * * * *', async () => {
    logger.info('⏰ Running scheduled task delay check');
    try {
      await queueService.addTaskAutomationJob({
        action: 'CHECK_DELAY',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue task delay check job');
    }
  });
  cronTasks.push(taskDelayJob);
  logger.info('✅ Task delay scheduler started (every 30 minutes)');

  // KPI Monitoring - Every hour
  // Calculate project health metrics
  const kpiMonitorJob = cron.schedule('0 * * * *', async () => {
    logger.info('⏰ Running scheduled KPI monitoring');
    try {
      await queueService.addKpiAutomationJob({
        action: 'CALCULATE_ALL',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue KPI monitoring job');
    }
  });
  cronTasks.push(kpiMonitorJob);
  logger.info('✅ KPI monitoring scheduler started (every hour)');

  // KPI Breach Check - Every 6 hours
  // Check for KPI threshold breaches
  const kpiBreachJob = cron.schedule('0 */6 * * *', async () => {
    logger.info('⏰ Running scheduled KPI breach check');
    try {
      await queueService.addKpiAutomationJob({
        action: 'CHECK_KPI_BREACH',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue KPI breach check job');
    }
  });
  cronTasks.push(kpiBreachJob);
  logger.info('✅ KPI breach check scheduler started (every 6 hours)');

  // Document Approval Check - Daily at 9 AM
  // Send reminders for pending approvals
  const documentApprovalJob = cron.schedule('0 9 * * *', async () => {
    logger.info('⏰ Running scheduled document approval check');
    try {
      await queueService.addDocumentAutomationJob({
        action: 'PROCESS_PENDING_APPROVALS',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue document approval job');
    }
  });
  cronTasks.push(documentApprovalJob);
  logger.info('✅ Document approval scheduler started (daily at 9 AM)');

  // Daily Summary - Every day at 8 AM
  // Send daily summary emails to project managers
  const dailySummaryJob = cron.schedule('0 8 * * *', async () => {
    logger.info('⏰ Running scheduled daily summary');
    try {
      await queueService.addNotificationJob({
        action: 'SEND_TEMPLATE_EMAIL',
        template: 'daily-summary',
        data: {
          reportDate: new Date().toISOString().split('T')[0],
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue daily summary job');
    }
  });
  cronTasks.push(dailySummaryJob);
  logger.info('✅ Daily summary scheduler started (daily at 8 AM)');

  // Weekly Report - Every Monday at 9 AM
  // Send weekly progress reports
  const weeklyReportJob = cron.schedule('0 9 * * 1', async () => {
    logger.info('⏰ Running scheduled weekly report');
    try {
      await queueService.addNotificationJob({
        action: 'SEND_TEMPLATE_EMAIL',
        template: 'weekly-report',
        data: {
          weekStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          weekEnd: new Date().toISOString().split('T')[0],
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue weekly report job');
    }
  });
  cronTasks.push(weeklyReportJob);
  logger.info('✅ Weekly report scheduler started (Monday at 9 AM)');

  // Monthly Analytics - First day of month at 10 AM
  // Send monthly analytics and insights
  const monthlyAnalyticsJob = cron.schedule('0 10 1 * *', async () => {
    logger.info('⏰ Running scheduled monthly analytics');
    try {
      await queueService.addNotificationJob({
        action: 'SEND_TEMPLATE_EMAIL',
        template: 'monthly-analytics',
        data: {
          month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to enqueue monthly analytics job');
    }
  });
  cronTasks.push(monthlyAnalyticsJob);
  logger.info('✅ Monthly analytics scheduler started (1st day at 10 AM)');

  logger.info('🚀 All cron schedulers started successfully');
}

/**
 * Stop all scheduled cron jobs
 */
export function stopSchedulers(): void {
  logger.info('🛑 Stopping all cron schedulers');

  cronTasks.forEach((task) => {
    task.stop();
  });

  cronTasks.length = 0; // Clear array

  logger.info('✅ All cron schedulers stopped');
}

/**
 * Get status of all cron jobs
 */
export function getSchedulerStatus(): Array<{ name: string; isRunning: boolean; index: number }> {
  return [
    { name: 'Task Monitoring (*/15 * * * *)', isRunning: cronTasks.length > 0, index: 0 },
    { name: 'Task Delay Check (*/30 * * * *)', isRunning: cronTasks.length > 1, index: 1 },
    { name: 'KPI Monitoring (0 * * * *)', isRunning: cronTasks.length > 2, index: 2 },
    { name: 'KPI Breach Check (0 */6 * * *)', isRunning: cronTasks.length > 3, index: 3 },
    { name: 'Document Approval (0 9 * * *)', isRunning: cronTasks.length > 4, index: 4 },
    { name: 'Daily Summary (0 8 * * *)', isRunning: cronTasks.length > 5, index: 5 },
    { name: 'Weekly Report (0 9 * * 1)', isRunning: cronTasks.length > 6, index: 6 },
    { name: 'Monthly Analytics (0 10 1 * *)', isRunning: cronTasks.length > 7, index: 7 },
  ];
}
