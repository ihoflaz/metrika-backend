import { Worker, Job } from 'bullmq';
import { createHmac } from 'node:crypto';
import { PrismaClient, WebhookChannel } from '@prisma/client';
import { QueueName, redisConnection } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { EmailService } from '../../notifications/email.service';

const logger = createLogger({ name: 'NotificationWorker' });
const prisma = new PrismaClient();

interface NotificationJobData {
  userId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  type: 'EMAIL' | 'IN_APP' | 'WEBHOOK';
  template: string;
  payload: Record<string, unknown>;
  priority?: number;
  event?: string;
}

interface WebhookPayload {
  event: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: string;
}

class NotificationWorker {
  private worker: Worker<NotificationJobData>;
  private emailService: EmailService | null = null;

  constructor() {
    this.worker = new Worker<NotificationJobData>(
      QueueName.NOTIFICATION,
      async (job: Job<NotificationJobData>) => {
        logger.info({ jobId: job.id, type: job.data.type, userId: job.data.userId }, 'Processing notification job');

        try {
          switch (job.data.type) {
            case 'EMAIL':
              await this.sendEmail(job.data);
              break;
            case 'IN_APP':
              await this.createInAppNotification(job.data);
              break;
            case 'WEBHOOK':
              await this.dispatchWebhook(job.data);
              break;
            default:
              throw new Error(`Unknown notification type: ${job.data.type}`);
          }

          logger.info({ jobId: job.id, userId: job.data.userId }, 'Notification job completed');
        } catch (error) {
          logger.error({ jobId: job.id, error }, 'Notification job failed');
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 10,
      },
    );

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'Notification job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'Notification job failed');
    });

    logger.info('NotificationWorker started');
  }

  private async sendEmail(data: NotificationJobData): Promise<void> {
    try {
      if (!this.emailService) {
        const { loadAppConfig } = await import('../../../config/app-config');
        const config = loadAppConfig();
        this.emailService = new EmailService(config, logger);
        logger.info('EmailService initialized in notification worker');
      }

      let recipients: string[] = [];

      if (data.to && data.to.length > 0) {
        recipients = data.to;
      } else if (data.userId) {
        const user = await prisma.user.findUnique({
          where: { id: data.userId },
          select: { email: true, fullName: true },
        });

        if (!user) {
          logger.warn({ userId: data.userId }, 'User not found, skipping email');
          return;
        }

        recipients = [user.email];
        data.payload.userName ??= user.fullName;
        data.payload.userEmail ??= user.email;
      } else {
        logger.warn({ data }, 'Neither userId nor to[] provided, skipping email');
        return;
      }

      const result = await this.emailService.sendTemplateEmail({
        to: recipients,
        cc: data.cc,
        bcc: data.bcc,
        template: data.template,
        data: data.payload,
      });

      if (result.success) {
        logger.info({ messageId: result.messageId, recipients: result.recipients, template: data.template }, 'Email sent successfully');
      } else {
        logger.error({ recipients: result.recipients, template: data.template, error: result.error }, 'Email sending failed');
        throw new Error(result.error || 'Email sending failed');
      }
    } catch (error) {
      logger.error({ error, data }, 'Failed to send email notification');
      throw error;
    }
  }

  private async createInAppNotification(data: NotificationJobData): Promise<void> {
    if (!data.userId) {
      logger.warn({ template: data.template }, 'User id missing for in-app notification');
      return;
    }

    const title = typeof data.payload.title === 'string' ? data.payload.title : data.template;
    const message = typeof data.payload.message === 'string' ? data.payload.message : '';

    await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.template,
        title,
        message,
        data: (data.payload.data as Record<string, unknown> | undefined) ?? data.payload,
      },
    });

    logger.info({ userId: data.userId, template: data.template }, 'Stored in-app notification');
  }

  private async dispatchWebhook(data: NotificationJobData): Promise<void> {
    if (!data.event) {
      logger.warn({ template: data.template }, 'Webhook job missing event name');
      return;
    }

    const payload: WebhookPayload = {
      event: data.event,
      title: typeof data.payload.title === 'string' ? data.payload.title : data.template,
      message: typeof data.payload.message === 'string' ? data.payload.message : '',
      data: (data.payload.data as Record<string, unknown> | undefined) ?? data.payload,
      timestamp: new Date().toISOString(),
    };

    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { isActive: true, events: { has: data.event } },
    });

    if (subscriptions.length === 0) {
      logger.debug({ event: data.event }, 'No webhook subscribers found');
      return;
    }

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const body = this.buildWebhookBody(subscription.channel, payload);
        const serialized = JSON.stringify(body);
        const signature = createHmac('sha256', subscription.secret).update(serialized).digest('hex');

        try {
          const response = await fetch(subscription.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Metrika-Event': payload.event,
              'X-Metrika-Timestamp': payload.timestamp,
              'X-Metrika-Signature': signature,
            },
            body: serialized,
          });

          if (!response.ok) {
            throw new Error(`Webhook responded with status ${response.status}`);
          }

          await prisma.webhookSubscription.update({
            where: { id: subscription.id },
            data: {
              failureCount: 0,
              lastDeliveredAt: new Date(),
            },
          });

          logger.info({ subscriptionId: subscription.id, event: payload.event }, 'Webhook delivered');
        } catch (error) {
          logger.error({ subscriptionId: subscription.id, event: payload.event, error }, 'Webhook delivery failed');
          await prisma.webhookSubscription.update({
            where: { id: subscription.id },
            data: {
              failureCount: { increment: 1 },
              lastDeliveredAt: new Date(),
            },
          });
        }
      }),
    );
  }

  private buildWebhookBody(channel: WebhookChannel, payload: WebhookPayload) {
    if (channel === WebhookChannel.SLACK || channel === WebhookChannel.TEAMS) {
      return {
        text: `[${payload.event}] ${payload.title}\n${payload.message}`,
      };
    }

    return payload;
  }

  async close(): Promise<void> {
    await this.worker.close();
    await prisma.$disconnect();
    logger.info('NotificationWorker stopped');
  }
}

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
