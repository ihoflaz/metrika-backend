import * as cron from 'node-cron';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'CronService' });

/**
 * CronService - Zamanlanmış görevleri yönetir
 * 
 * 4 adet cron job:
 * 1. Task delay check - Her 30 dakikada
 * 2. KPI breach check - Her 6 saatte
 * 3. Document reminder - Her 15 dakikada
 * 4. Weekly audit - Her Pazartesi 09:00
 */
export class CronService {
  private tasks: cron.ScheduledTask[] = [];
  private isRunning = false;

  /**
   * Tüm cron job'ları başlat
   */
  start() {
    if (this.isRunning) {
      logger.warn('CronService already running');
      return;
    }

    logger.info('🕐 Starting cron jobs...');

    // 1. Task delay check - Her 30 dakikada bir
    this.tasks.push(
      cron.schedule('*/30 * * * *', async () => {
        logger.info('⏰ Running: Task delay check');
        try {
          const { taskDelayCheckCron } = await import('./jobs/task-delay-check.cron');
          await taskDelayCheckCron();
        } catch (error) {
          logger.error({ error }, 'Task delay check cron failed');
        }
      })
    );

    // 2. KPI breach check - Her 6 saatte bir
    this.tasks.push(
      cron.schedule('0 */6 * * *', async () => {
        logger.info('⏰ Running: KPI breach check');
        try {
          const { kpiBreachCheckCron } = await import('./jobs/kpi-breach-check.cron.js');
          await kpiBreachCheckCron();
        } catch (error) {
          logger.error({ error }, 'KPI breach check cron failed');
        }
      })
    );

    // 3. Document approval reminder - Her 15 dakikada bir
    this.tasks.push(
      cron.schedule('*/15 * * * *', async () => {
        logger.info('⏰ Running: Document approval reminder');
        try {
          const { documentReminderCron } = await import('./jobs/document-reminder.cron.js');
          await documentReminderCron();
        } catch (error) {
          logger.error({ error }, 'Document reminder cron failed');
        }
      })
    );

    // 4. Weekly audit report - Her Pazartesi 09:00
    this.tasks.push(
      cron.schedule('0 9 * * 1', async () => {
        logger.info('⏰ Running: Weekly audit report');
        try {
          const { weeklyAuditCron } = await import('./jobs/weekly-audit.cron.js');
          await weeklyAuditCron();
        } catch (error) {
          logger.error({ error }, 'Weekly audit cron failed');
        }
      })
    );

    this.isRunning = true;
    logger.info(`✅ Started ${this.tasks.length} cron jobs`);
  }

  /**
   * Tüm cron job'ları durdur
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('CronService not running');
      return;
    }

    logger.info('🛑 Stopping all cron jobs...');
    this.tasks.forEach((task) => task.stop());
    this.tasks = [];
    this.isRunning = false;
    logger.info('✅ All cron jobs stopped');
  }

  /**
   * Cron job durumunu döndür
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      jobCount: this.tasks.length,
      jobs: [
        { name: 'task-delay-check', schedule: '*/30 * * * *', description: 'Every 30 minutes' },
        { name: 'kpi-breach-check', schedule: '0 */6 * * *', description: 'Every 6 hours' },
        { name: 'document-reminder', schedule: '*/15 * * * *', description: 'Every 15 minutes' },
        { name: 'weekly-audit', schedule: '0 9 * * 1', description: 'Every Monday at 09:00' },
      ],
    };
  }
}

// Singleton instance
let cronServiceInstance: CronService | null = null;

export function getCronService(): CronService {
  if (!cronServiceInstance) {
    cronServiceInstance = new CronService();
  }
  return cronServiceInstance;
}
