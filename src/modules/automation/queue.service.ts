import { Queue, QueueEvents } from 'bullmq';
import { QueueName, redisConnection, defaultJobOptions } from '../../config/queue.config';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'QueueService' });

/**
 * QueueService - BullMQ Queue yönetimi
 * 
 * Her queue için add metodu ve metrics toplanır
 */
export class QueueService {
  private queues: Map<QueueName, Queue>;
  private queueEvents: Map<QueueName, QueueEvents>;

  constructor() {
    this.queues = new Map();
    this.queueEvents = new Map();
    this.initializeQueues();
  }

  /**
   * Tüm queue'ları initialize et
   */
  private initializeQueues(): void {
    Object.values(QueueName).forEach((queueName) => {
      const queue = new Queue(queueName, {
        connection: redisConnection,
        defaultJobOptions,
      });

      const queueEvents = new QueueEvents(queueName, {
        connection: redisConnection,
      });

      // Event listeners
      queueEvents.on('completed', ({ jobId }) => {
        logger.info({ queueName, jobId }, '✅ Job completed');
      });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        logger.error({ queueName, jobId, failedReason }, '❌ Job failed');
      });

      this.queues.set(queueName, queue);
      this.queueEvents.set(queueName, queueEvents);
    });

    logger.info('📦 QueueService initialized with queues: ' + Object.values(QueueName).join(', '));
  }

  /**
   * Belirli bir queue instance'ını al
   */
  getQueue(queueName: QueueName): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }
    return queue;
  }

  /**
   * Task Automation Queue'ya job ekle
   */
  async addTaskAutomationJob(data: {
    taskId: string;
    action: 'CHECK_DELAY' | 'AUTO_COMPLETE' | 'SEND_REMINDER';
    metadata?: Record<string, unknown>;
  }) {
    const queue = this.queues.get(QueueName.TASK_AUTOMATION);
    if (!queue) throw new Error('Task automation queue not found');

    const job = await queue.add(data.action, data, {
      jobId: `task-${data.taskId}-${data.action}-${Date.now()}`,
    });

    logger.debug({ jobId: job.id, taskId: data.taskId, action: data.action }, '📝 Task automation job added');
    return job;
  }

  /**
   * KPI Automation Queue'ya job ekle
   */
  async addKpiAutomationJob(data: {
    kpiId: string;
    projectId: string;
    action: 'CHECK_BREACH' | 'CALCULATE_SCORE' | 'TRIGGER_ACTION';
    metadata?: Record<string, unknown>;
  }) {
    const queue = this.queues.get(QueueName.KPI_AUTOMATION);
    if (!queue) throw new Error('KPI automation queue not found');

    const job = await queue.add(data.action, data, {
      jobId: `kpi-${data.kpiId}-${data.action}-${Date.now()}`,
    });

    logger.debug({ jobId: job.id, kpiId: data.kpiId, action: data.action }, '📊 KPI automation job added');
    return job;
  }

  /**
   * Document Automation Queue'ya job ekle
   */
  async addDocumentAutomationJob(data: {
    documentId: string;
    action: 'APPROVAL_REMINDER' | 'VERSION_CLEANUP' | 'VIRUS_SCAN';
    metadata?: Record<string, unknown>;
  }) {
    const queue = this.queues.get(QueueName.DOCUMENT_AUTOMATION);
    if (!queue) throw new Error('Document automation queue not found');

    const job = await queue.add(data.action, data, {
      jobId: `doc-${data.documentId}-${data.action}-${Date.now()}`,
    });

    logger.debug({ jobId: job.id, documentId: data.documentId, action: data.action }, '📄 Document automation job added');
    return job;
  }

  /**
   * Notification Queue'ya job ekle
   */
  async addNotificationJob(data: {
    userId?: string; // Optional - direct email kullanılabilir
    to?: string[]; // Direct email addresses
    cc?: string[];
    bcc?: string[];
    type: 'EMAIL' | 'IN_APP';
    template: string;
    payload: Record<string, unknown>;
    priority?: number;
  }) {
    const queue = this.queues.get(QueueName.NOTIFICATION);
    if (!queue) throw new Error('Notification queue not found');

    const job = await queue.add(data.type, data, {
      priority: data.priority || 5, // 1-10 arası (1 = en yüksek)
      jobId: `notif-${data.userId || 'multi'}-${data.type}-${Date.now()}`,
    });

    logger.debug({ 
      jobId: job.id, 
      userId: data.userId, 
      to: data.to,
      type: data.type,
      template: data.template,
    }, '🔔 Notification job added');
    
    return job;
  }

  /**
   * Template email gönder (helper method)
   */
  async sendTemplateEmail(options: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    template: string;
    data: Record<string, unknown>;
    priority?: number;
  }) {
    return await this.addNotificationJob({
      to: options.to,
      cc: options.cc,
      bcc: options.bcc,
      type: 'EMAIL',
      template: options.template,
      payload: options.data,
      priority: options.priority,
    });
  }

  /**
   * Queue metrics - Monitoring için
   */
  async getQueueMetrics(queueName: QueueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Tüm queue'ların metrics'i
   */
  async getAllMetrics() {
    const metrics = await Promise.all(
      Object.values(QueueName).map((queueName) => this.getQueueMetrics(queueName))
    );

    return metrics;
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    logger.info('🛑 Closing all queues...');

    // Önce queue events'leri kapat
    await Promise.all(
      Array.from(this.queueEvents.values()).map((queueEvents) => queueEvents.close())
    );

    // Sonra queue'ları kapat
    await Promise.all(
      Array.from(this.queues.values()).map((queue) => queue.close())
    );

    logger.info('✅ All queues closed');
  }
}

// Singleton instance
let queueServiceInstance: QueueService | null = null;

export function getQueueService(): QueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new QueueService();
  }
  return queueServiceInstance;
}
