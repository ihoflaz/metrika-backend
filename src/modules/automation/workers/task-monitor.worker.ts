import { Worker, Job } from 'bullmq';
import { QueueName, redisConnection } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { PrismaClient, TaskStatus } from '@prisma/client';
import { notificationService } from '../../notifications/notification.service';

const logger = createLogger({ name: 'TaskMonitorWorker' });
const prisma = new PrismaClient();

interface TaskAutomationJobData {
  taskId: string;
  action: 'CHECK_DELAY' | 'AUTO_COMPLETE' | 'SEND_REMINDER';
  metadata?: Record<string, unknown>;
}

/**
 * Task Monitor Worker
 * 
 * İşlevler:
 * 1. CHECK_DELAY: Geciken taskları tespit et, bildirim gönder
 * 2. AUTO_COMPLETE: Tüm child tasklar tamamlandıysa parent'ı otomatik tamamla
 * 3. SEND_REMINDER: Task deadline'a yaklaşıyorsa hatırlatma gönder
 */
class TaskMonitorWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker<TaskAutomationJobData>(
      QueueName.TASK_AUTOMATION,
      async (job: Job<TaskAutomationJobData>) => {
        logger.info({ jobId: job.id, action: job.data.action }, '📝 Processing task automation job');

        try {
          switch (job.data.action) {
            case 'CHECK_DELAY':
              await this.checkDelay(job.data.taskId);
              break;
            case 'AUTO_COMPLETE':
              await this.autoComplete(job.data.taskId);
              break;
            case 'SEND_REMINDER':
              await this.sendReminder(job.data.taskId);
              break;
            default:
              throw new Error(`Unknown action: ${job.data.action}`);
          }

          logger.info({ jobId: job.id, taskId: job.data.taskId }, '✅ Task automation job completed');
        } catch (error) {
          logger.error({ jobId: job.id, error }, '❌ Task automation job failed');
          throw error; // BullMQ retry yapacak
        }
      },
      {
        connection: redisConnection,
        concurrency: 5, // 5 job parallel işle
      }
    );

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'Task automation job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'Task automation job failed');
    });

    logger.info('🚀 TaskMonitorWorker started');
  }

  /**
   * CHECK_DELAY: Geciken taskları kontrol et
   */
  private async checkDelay(taskId: string): Promise<void> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        owner: true,
        project: true,
      },
    });

    if (!task) {
      logger.warn({ taskId }, 'Task not found');
      return;
    }

    // Sadece aktif taskları kontrol et
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return;
    }

    const now = new Date();
    const plannedEnd = task.plannedEnd;

    if (!plannedEnd) {
      return; // Tarih yoksa kontrol etme
    }

    // Gecikmiş mi?
    if (now > plannedEnd) {
      const delayDays = Math.floor((now.getTime() - plannedEnd.getTime()) / (1000 * 60 * 60 * 24));

      logger.warn(
        { taskId, taskTitle: task.title, delayDays },
        `⚠️ Task delayed by ${delayDays} days`
      );

      // Email bildirim gönder
      await notificationService.send({
        type: 'task-delayed',
        taskId: task.id,
        taskTitle: task.title,
        projectName: task.project.name,
        ownerName: task.owner.fullName,
        ownerEmail: task.owner.email,
        delayDays,
        taskUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${task.projectId}/tasks/${task.id}`,
      });
    }
  }

  /**
   * AUTO_COMPLETE: Parent task'ı otomatik tamamla
   */
  private async autoComplete(taskId: string): Promise<void> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        children: true,
      },
    });

    if (!task) {
      logger.warn({ taskId }, 'Task not found');
      return;
    }

    // Sadece IN_PROGRESS tasklar için çalış
    if (task.status !== TaskStatus.IN_PROGRESS) {
      return;
    }

    // Child task var mı?
    if (task.children.length === 0) {
      return;
    }

    // Tüm child'lar tamamlanmış mı?
    const allCompleted = task.children.every((child) => child.status === TaskStatus.COMPLETED);

    if (allCompleted) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          actualEnd: new Date(),
          progressPct: 100,
        },
      });

      logger.info(
        { taskId, taskTitle: task.title },
        '🎉 Parent task auto-completed (all children done)'
      );

      // Email bildirim gönder
      const taskWithOwner = await prisma.task.findUnique({
        where: { id: taskId },
        include: { owner: true, project: true },
      });

      if (taskWithOwner?.owner) {
        await notificationService.send({
          type: 'task-completed',
          taskId: taskWithOwner.id,
          taskTitle: taskWithOwner.title,
          projectName: taskWithOwner.project.name,
          completedByName: 'System (Auto-completed)',
          completedByEmail: taskWithOwner.owner.email,
          taskUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${taskWithOwner.projectId}/tasks/${taskWithOwner.id}`,
        });
      }
    }
  }

  /**
   * SEND_REMINDER: Deadline yaklaşan tasklar için hatırlatma
   */
  private async sendReminder(taskId: string): Promise<void> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        owner: true,
      },
    });

    if (!task || !task.plannedEnd) {
      return;
    }

    // Sadece aktif tasklar
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return;
    }

    const now = new Date();
    const daysUntilDeadline = Math.floor(
      (task.plannedEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 3 gün veya daha az kaldıysa hatırlat
    if (daysUntilDeadline >= 0 && daysUntilDeadline <= 3) {
      logger.info(
        { taskId, taskTitle: task.title, daysUntilDeadline },
        `🔔 Sending reminder: ${daysUntilDeadline} days until deadline`
      );

      // Escalation level'a göre bildirim gönder
      const escalationLevel = daysUntilDeadline === 0 ? 'critical' : 'warning';
      
      // Task owner'a bildirim
      await notificationService.send({
        type: 'task-delayed',
        taskId: task.id,
        taskTitle: task.title,
        projectName: '', // TODO: Project name ekle
        ownerName: task.owner.fullName,
        ownerEmail: task.owner.email,
        delayDays: -daysUntilDeadline, // Negatif değer = henüz gecikmemiş ama yaklaşıyor
        taskUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${task.projectId}/tasks/${task.id}`,
      });
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await prisma.$disconnect();
    logger.info('🛑 TaskMonitorWorker stopped');
  }
}

// Singleton instance
let workerInstance: TaskMonitorWorker | null = null;

export function startTaskMonitorWorker(): TaskMonitorWorker {
  if (!workerInstance) {
    workerInstance = new TaskMonitorWorker();
  }
  return workerInstance;
}

export async function stopTaskMonitorWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
