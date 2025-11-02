import { Worker, Job } from 'bullmq';
import { QueueName, redisConnection } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { PrismaClient } from '@prisma/client';
import { EmailService } from '../../notifications/email.service';

const logger = createLogger({ name: 'NotificationWorker' });
const prisma = new PrismaClient();

interface NotificationJobData {
  userId?: string; // Optional - to[] array kullanılabilir
  to?: string[]; // Direct email addresses
  cc?: string[];
  bcc?: string[];
  type: 'EMAIL' | 'IN_APP';
  template: string;
  payload: Record<string, unknown>;
  priority?: number;
}

/**
 * Notification Worker
 * 
 * İşlevler:
 * 1. EMAIL: Email notification gönder (nodemailer + templates)
 * 2. IN_APP: In-app notification oluştur (database'e kaydet)
 * 
 * UPDATED (Day 7): Email sending fully implemented with template support
 */
class NotificationWorker {
  private worker: Worker;
  private emailService: EmailService | null = null;

  constructor() {
    this.worker = new Worker<NotificationJobData>(
      QueueName.NOTIFICATION,
      async (job: Job<NotificationJobData>) => {
        logger.info({ jobId: job.id, type: job.data.type, userId: job.data.userId }, '🔔 Processing notification job');

        try {
          switch (job.data.type) {
            case 'EMAIL':
              await this.sendEmail(job.data);
              break;
            case 'IN_APP':
              await this.createInAppNotification(job.data);
              break;
            default:
              throw new Error(`Unknown notification type: ${job.data.type}`);
          }

          logger.info({ jobId: job.id, userId: job.data.userId }, '✅ Notification job completed');
        } catch (error) {
          logger.error({ jobId: job.id, error }, '❌ Notification job failed');
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 10, // Yüksek concurrency - notification'lar hızlı gitmeli
      }
    );

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'Notification job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'Notification job failed');
    });

    logger.info('🚀 NotificationWorker started');
  }

  /**
   * EMAIL: Email notification gönder (FULLY IMPLEMENTED - Day 7)
   */
  private async sendEmail(data: NotificationJobData): Promise<void> {
    try {
      // EmailService'i lazy load (ilk çağrıda)
      if (!this.emailService) {
        // Direkt import et ve oluştur
        const { loadAppConfig } = await import('../../../config/app-config');
        const config = loadAppConfig();
        this.emailService = new EmailService(config, logger);
        logger.info('EmailService initialized in notification worker');
      }

      // Alıcıları belirle
      let recipients: string[] = [];

      if (data.to && data.to.length > 0) {
        // Direct email addresses
        recipients = data.to;
      } else if (data.userId) {
        // userId'den email al
        const user = await prisma.user.findUnique({
          where: { id: data.userId },
          select: { email: true, fullName: true },
        });

        if (!user) {
          logger.warn({ userId: data.userId }, 'User not found, skipping email');
          return;
        }

        recipients = [user.email];

        // Payload'a user bilgisini ekle (template'te kullanılabilir)
        if (!data.payload.userName) {
          data.payload.userName = user.fullName;
        }
        if (!data.payload.userEmail) {
          data.payload.userEmail = user.email;
        }
      } else {
        logger.warn({ data }, 'Neither userId nor to[] provided, skipping email');
        return;
      }

      // Email gönder (template ile)
      const result = await this.emailService!.sendTemplateEmail({
        to: recipients,
        cc: data.cc,
        bcc: data.bcc,
        template: data.template,
        data: data.payload,
      });

      if (result.success) {
        logger.info(
          { 
            messageId: result.messageId,
            recipients: result.recipients,
            template: data.template,
          },
          '📧 Email sent successfully'
        );
      } else {
        logger.error(
          {
            error: result.error,
            recipients: result.recipients,
            template: data.template,
          },
          '❌ Email sending failed'
        );
        // Retry için exception at
        throw new Error(result.error || 'Email sending failed');
      }
    } catch (error) {
      logger.error({ error, data }, 'Failed to send email notification');
      throw error;
    }
  }

  /**
   * IN_APP: In-app notification oluştur
   */
  private async createInAppNotification(data: NotificationJobData): Promise<void> {
    logger.info(
      { 
        userId: data.userId, 
        template: data.template 
      },
      '🔔 In-app notification placeholder (will be implemented in Week 3)'
    );

    // TODO (Week 3): In-app notification tablosu oluştur
    // await prisma.inAppNotification.create({
    //   data: {
    //     userId: data.userId,
    //     type: data.template,
    //     title: renderTitle(data.template, data.payload),
    //     message: renderMessage(data.template, data.payload),
    //     isRead: false,
    //     payload: data.payload,
    //   }
    // });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await prisma.$disconnect();
    logger.info('🛑 NotificationWorker stopped');
  }
}

// Singleton instance
let workerInstance: NotificationWorker | null = null;

export function startNotificationWorker(): NotificationWorker {
  if (!workerInstance) {
    workerInstance = new NotificationWorker();
  }
  return workerInstance;
}

export async function stopNotificationWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
