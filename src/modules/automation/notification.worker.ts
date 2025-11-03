/**
 * Notification Worker
 * 
 * Processes email notifications from the queue.
 * Handles single emails, bulk emails, and batch processing.
 */

import { Worker, Job } from 'bullmq';
import { redisConnection, QueueName } from '../../config/queue.config';
import { logger } from '../../lib/logger';
import { EmailService } from '../notifications/email.service';
import { AppConfig } from '../../config/app-config';

interface NotificationJobData {
  action: 'SEND_EMAIL' | 'SEND_BULK_EMAILS' | 'SEND_TEMPLATE_EMAIL';
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  template?: string;
  data?: Record<string, any>;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
  }>;
  priority?: number;
}

export class NotificationWorker {
  private worker: Worker<NotificationJobData>;
  private emailService: EmailService;

  constructor(config: AppConfig) {
    this.emailService = new EmailService(config, logger);

    this.worker = new Worker<NotificationJobData>(
      QueueName.NOTIFICATION,
      async (job) => this.processJob(job),
      {
        connection: redisConnection,
        concurrency: 10, // Process 10 emails concurrently
      }
    );

    this.setupEventHandlers();
    logger.info('📧 Notification Worker started');
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info(
        { 
          jobId: job.id, 
          action: job.data.action, 
          to: Array.isArray(job.data.to) ? job.data.to.length : 1 
        }, 
        '✅ Notification job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      logger.error(
        { 
          jobId: job?.id, 
          action: job?.data.action, 
          to: job?.data.to,
          error: err.message 
        },
        '❌ Notification job failed'
      );
    });
  }

  private async processJob(job: Job<NotificationJobData>): Promise<void> {
    const { action } = job.data;

    try {
      switch (action) {
        case 'SEND_EMAIL':
          await this.sendEmail(job.data);
          break;

        case 'SEND_TEMPLATE_EMAIL':
          await this.sendTemplateEmail(job.data);
          break;

        case 'SEND_BULK_EMAILS':
          await this.sendBulkEmails(job.data);
          break;

        default:
          logger.warn({ action }, 'Unknown notification action');
      }
    } catch (error) {
      logger.error({ error, jobData: job.data }, 'Error processing notification job');
      throw error; // Re-throw to trigger BullMQ retry mechanism
    }
  }

  /**
   * Send a single email
   */
  private async sendEmail(data: NotificationJobData): Promise<void> {
    const { to, cc, bcc, subject, html, text, attachments } = data;

    if (!subject) {
      throw new Error('Email subject is required');
    }

    if (!html && !text) {
      throw new Error('Email content (html or text) is required');
    }

    const recipients = Array.isArray(to) ? to : [to];

    await this.emailService.sendEmail({
      to: recipients,
      cc,
      bcc,
      subject: subject!,
      html,
      text: text || '',
      attachments,
    });

    logger.info({ to: recipients, subject }, '📧 Email sent successfully');
  }

  /**
   * Send email using a template
   */
  private async sendTemplateEmail(data: NotificationJobData): Promise<void> {
    const { to, cc, bcc, template, data: templateData, attachments } = data;

    if (!template) {
      throw new Error('Template name is required');
    }

    const recipients = Array.isArray(to) ? to : [to];

    await this.emailService.sendTemplateEmail({
      to: recipients,
      cc,
      bcc,
      template,
      data: templateData || {},
      attachments,
    });

    logger.info({ to: recipients, template }, '📧 Template email sent successfully');
  }

  /**
   * Send bulk emails (batch processing)
   * Processes multiple emails with rate limiting
   */
  private async sendBulkEmails(data: NotificationJobData): Promise<void> {
    const { to, template, data: templateData } = data;

    if (!Array.isArray(to)) {
      throw new Error('Bulk emails require an array of recipients');
    }

    if (!template) {
      throw new Error('Template is required for bulk emails');
    }

    logger.info({ recipientCount: to.length, template }, '📧 Starting bulk email send');

    const batchSize = 50; // Send in batches of 50
    const batches = [];

    for (let i = 0; i < to.length; i += batchSize) {
      batches.push(to.slice(i, i + batchSize));
    }

    let successCount = 0;
    let failureCount = 0;

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (recipient) => {
          try {
            await this.emailService.sendTemplateEmail({
              to: [recipient],
              template,
              data: {
                ...templateData,
                recipientEmail: recipient,
              },
            });
            return { success: true, recipient };
          } catch (error) {
            logger.error(
              { recipient, error: (error as Error).message },
              '❌ Failed to send bulk email to recipient'
            );
            return { success: false, recipient, error };
          }
        })
      );

      // Count successes and failures
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failureCount++;
        }
      });

      // Rate limiting: wait 100ms between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(
      { 
        total: to.length, 
        success: successCount, 
        failed: failureCount,
        template 
      },
      '✅ Bulk email send completed'
    );

    if (failureCount > 0) {
      logger.warn({ failureCount }, '⚠️ Some bulk emails failed to send');
    }
  }

  /**
   * Close worker and cleanup
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('📧 Notification Worker stopped');
  }
}

// Singleton instance
let workerInstance: NotificationWorker | null = null;

export function getNotificationWorker(config: AppConfig): NotificationWorker {
  if (!workerInstance) {
    workerInstance = new NotificationWorker(config);
  }
  return workerInstance;
}
