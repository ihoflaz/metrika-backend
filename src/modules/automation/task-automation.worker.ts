import { Worker, Job } from 'bullmq';
import { PrismaClient, TaskStatus } from '@prisma/client';
import { QueueName, redisConnection } from '../../config/queue.config';
import { createLogger } from '../../lib/logger';
import { getQueueService } from './queue.service';

const logger = createLogger({ name: 'TaskAutomationWorker' });

/**
 * Task Automation Worker
 * 
 * Handles:
 * - Overdue task detection
 * - Task status auto-updates
 * - Task reminder emails
 */
export class TaskAutomationWorker {
  private worker: Worker;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    
    this.worker = new Worker(
      QueueName.TASK_AUTOMATION,
      async (job: Job) => {
        return await this.processJob(job);
      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    );

    this.setupEventHandlers();
    logger.info('🤖 Task Automation Worker started');
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, action: job.name }, '✅ Task automation job completed');
    });

    this.worker.on('failed', (job, error) => {
      logger.error({ 
        jobId: job?.id, 
        action: job?.name, 
        error: error.message 
      }, '❌ Task automation job failed');
    });
  }

  private async processJob(job: Job): Promise<void> {
    const { action } = job.data;

    switch (action) {
      case 'CHECK_DELAY':
        await this.checkDelayedTasks();
        break;
      case 'CHECK_OVERDUE':
        await this.checkOverdueTasks();
        break;
      case 'SEND_REMINDER':
        await this.sendTaskReminder(job.data);
        break;
      case 'AUTO_UPDATE_STATUS':
        await this.autoUpdateTaskStatus(job.data);
        break;
      default:
        logger.warn({ action }, 'Unknown task automation action');
    }
  }

  /**
   * Check for overdue tasks and send notifications
   */
  private async checkOverdueTasks(): Promise<void> {
    const now = new Date();

    // Find tasks that are overdue (planned end passed and not completed)
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        plannedEnd: {
          lt: now,
        },
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
        },
        // Avoid sending multiple notifications
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
      include: {
        owner: {
          select: { email: true, fullName: true },
        },
        project: {
          include: {
            sponsor: {
              select: { email: true, fullName: true },
            },
          },
        },
      },
      take: 100, // Process in batches
    });

    logger.info({ count: overdueTasks.length }, '🔍 Found overdue tasks');

    const queueService = getQueueService();

    // Send notifications for overdue tasks
    for (const task of overdueTasks) {
      if (task.owner?.email) {
        await queueService.sendTemplateEmail({
          to: [task.owner.email],
          cc: task.project.sponsor?.email ? [task.project.sponsor.email] : undefined,
          template: 'task-overdue',
          data: {
            taskTitle: task.title,
            taskCode: (task as any).code || task.id,
            projectName: task.project.name,
            plannedEnd: task.plannedEnd,
            daysOverdue: task.plannedEnd ? Math.floor((now.getTime() - task.plannedEnd.getTime()) / (1000 * 60 * 60 * 24)) : 0,
            ownerName: task.owner.fullName,
          },
          priority: 2, // High priority
        });
      }

      // Update task to mark notification sent
      await this.prisma.task.update({
        where: { id: task.id },
        data: { 
          lastReminderSentAt: new Date(),
        },
      });
    }

    logger.info({ processed: overdueTasks.length }, '✅ Overdue task check completed');
  }

  /**
   * Check for tasks approaching deadline and send reminders
   */
  private async checkDelayedTasks(): Promise<void> {
    const now = new Date();
    const reminderWindow = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours ahead

    const upcomingTasks = await this.prisma.task.findMany({
      where: {
        plannedEnd: {
          gte: now,
          lte: reminderWindow,
        },
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
        },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
      include: {
        owner: {
          select: { email: true, fullName: true },
        },
        project: {
          select: { name: true },
        },
      },
      take: 100,
    });

    logger.info({ count: upcomingTasks.length }, '⏰ Found tasks with upcoming deadlines');

    const queueService = getQueueService();

    for (const task of upcomingTasks) {
      if (task.owner?.email && task.plannedEnd) {
        await queueService.sendTemplateEmail({
          to: [task.owner.email],
          template: 'task-reminder',
          data: {
            taskTitle: task.title,
            taskCode: (task as any).code || task.id,
            projectName: task.project.name,
            plannedEnd: task.plannedEnd,
            hoursRemaining: Math.floor((task.plannedEnd.getTime() - now.getTime()) / (1000 * 60 * 60)),
            ownerName: task.owner.fullName,
          },
          priority: 3,
        });

        // Update last reminder sent time
        await this.prisma.task.update({
          where: { id: task.id },
          data: { lastReminderSentAt: new Date() },
        });
      }
    }

    logger.info({ processed: upcomingTasks.length }, '✅ Deadline reminder check completed');
  }

  /**
   * Send reminder for specific task
   */
  private async sendTaskReminder(data: { taskId: string }): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: data.taskId },
      include: {
        owner: {
          select: { email: true, fullName: true },
        },
        project: {
          select: { name: true },
        },
      },
    });

    if (!task) {
      logger.warn({ taskId: data.taskId }, 'Task not found for reminder');
      return;
    }

    if (!task.owner?.email) {
      logger.warn({ taskId: data.taskId }, 'No owner email for task reminder');
      return;
    }

    const queueService = getQueueService();
    await queueService.sendTemplateEmail({
      to: [task.owner.email],
      template: 'task-reminder',
      data: {
        taskTitle: task.title,
        taskCode: (task as any).code || task.id,
        projectName: task.project.name,
        plannedEnd: task.plannedEnd,
        ownerName: task.owner.fullName,
      },
      priority: 3,
    });

    // Update last reminder sent time
    await this.prisma.task.update({
      where: { id: task.id },
      data: { lastReminderSentAt: new Date() },
    });

    logger.info({ taskId: task.id }, '📧 Task reminder sent');
  }

  /**
   * Auto-update task status based on conditions
   */
  private async autoUpdateTaskStatus(data: { taskId: string; newStatus: TaskStatus }): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: data.taskId },
    });

    if (!task) {
      logger.warn({ taskId: data.taskId }, 'Task not found for auto-update');
      return;
    }

    await this.prisma.task.update({
      where: { id: data.taskId },
      data: {
        status: data.newStatus,
        updatedAt: new Date(),
      },
    });

    logger.info({ taskId: data.taskId, oldStatus: task.status, newStatus: data.newStatus }, '🔄 Task status auto-updated');
  }

  /**
   * Stop the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('🛑 Task Automation Worker stopped');
  }
}
