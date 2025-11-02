import { PrismaClient } from '@prisma/client';
import { getQueueService } from '../queue.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'TaskDelayCheckCron' });
const prisma = new PrismaClient();

/**
 * Task Delay Check Cron Job
 * 
 * Her 30 dakikada çalışır.
 * 
 * Kontroller:
 * 1. Başlangıç gecikmesi: plannedStart geçmiş ama status=PLANNED
 * 2. Bitiş gecikmesi: plannedEnd geçmiş ama status!=COMPLETED
 */
export async function taskDelayCheckCron(): Promise<void> {
  try {
    const now = new Date();
    const queueService = getQueueService();

    // 1. Başlangıç gecikmesi - 24 saat önce başlamalıydı
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const startDelayedTasks = await prisma.task.findMany({
      where: {
        status: 'PLANNED',
        plannedStart: {
          lte: twentyFourHoursAgo,
        },
      },
      select: {
        id: true,
        title: true,
        plannedStart: true,
      },
    });

    logger.info(`Found ${startDelayedTasks.length} start-delayed tasks`);

    for (const task of startDelayedTasks) {
      const delayHours = Math.floor(
        (now.getTime() - task.plannedStart!.getTime()) / (1000 * 60 * 60)
      );

      await queueService.addTaskAutomationJob({
        taskId: task.id,
        action: 'CHECK_DELAY',
        metadata: {
          delayType: 'start',
          delayHours,
          reason: 'task_not_started',
        },
      });
    }

    // 2. Bitiş gecikmesi - plannedEnd geçmiş
    const endDelayedTasks = await prisma.task.findMany({
      where: {
        status: {
          in: ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'ON_HOLD'],
        },
        plannedEnd: {
          lt: now,
        },
      },
      select: {
        id: true,
        title: true,
        plannedEnd: true,
      },
    });

    logger.info(`Found ${endDelayedTasks.length} end-delayed tasks`);

    for (const task of endDelayedTasks) {
      const delayHours = Math.floor(
        (now.getTime() - task.plannedEnd!.getTime()) / (1000 * 60 * 60)
      );

      await queueService.addTaskAutomationJob({
        taskId: task.id,
        action: 'CHECK_DELAY',
        metadata: {
          delayType: 'end',
          delayHours,
          reason: 'task_not_completed',
        },
      });
    }

    logger.info({
      startDelayed: startDelayedTasks.length,
      endDelayed: endDelayedTasks.length,
    }, '✅ Task delay check completed');
  } catch (error) {
    logger.error({ error }, '❌ Task delay check failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
