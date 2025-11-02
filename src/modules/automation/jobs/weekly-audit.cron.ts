import { PrismaClient } from '@prisma/client';
import { getQueueService } from '../queue.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger({ name: 'WeeklyAuditCron' });
const prisma = new PrismaClient();

/**
 * Weekly Audit Report Cron Job
 * 
 * Her Pazartesi 09:00'da çalışır.
 * 
 * Haftalık özet raporu gönderir:
 * 1. Tamamlanan tasklar
 * 2. Geciken tasklar
 * 3. KPI durumları
 * 4. Yeni dokümanlar
 */
export async function weeklyAuditCron(): Promise<void> {
  try {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const queueService = getQueueService();

    logger.info('📊 Generating weekly audit report...');

    // 1. Bu hafta tamamlanan tasklar
    const completedTasks = await prisma.task.findMany({
      where: {
        status: 'COMPLETED',
        actualEnd: {
          gte: oneWeekAgo,
        },
      },
      select: {
        id: true,
        title: true,
        project: { select: { name: true } },
      },
    });

    // 2. Geciken tasklar
    const delayedTasks = await prisma.task.findMany({
      where: {
        status: {
          in: ['PLANNED', 'IN_PROGRESS', 'BLOCKED'],
        },
        plannedEnd: {
          lt: now,
        },
      },
      select: {
        id: true,
        title: true,
        plannedEnd: true,
        project: { select: { name: true } },
      },
    });

    // 3. BREACHED KPI'lar
    const breachedKpis = await prisma.kPIDefinition.findMany({
      where: {
        status: 'BREACHED',
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
    });

    // 4. Bu hafta eklenen dokümanlar
    const newDocuments = await prisma.document.findMany({
      where: {
        createdAt: {
          gte: oneWeekAgo,
        },
      },
      select: {
        id: true,
        title: true,
        docType: true,
        project: { select: { name: true } },
      },
    });

    // SYSADMIN ve PMO rolündeki kullanıcılara gönder
    const adminUsers = await prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              code: {
                in: ['SYSADMIN', 'PMO'],
              },
            },
          },
        },
      },
      select: {
        email: true,
        fullName: true,
      },
    });

    if (adminUsers.length > 0) {
      await queueService.addNotificationJob({
        userId: adminUsers[0].email, // Şimdilik ilk admin'e (multi-recipient Week 3'te)
        type: 'EMAIL',
        template: 'weekly-audit-report',
        payload: {
          weekStart: oneWeekAgo.toISOString().split('T')[0],
          weekEnd: now.toISOString().split('T')[0],
          completedTasksCount: completedTasks.length,
          delayedTasksCount: delayedTasks.length,
          breachedKpisCount: breachedKpis.length,
          newDocumentsCount: newDocuments.length,
          completedTasks: completedTasks.slice(0, 10), // İlk 10
          delayedTasks: delayedTasks.slice(0, 10),
          breachedKpis: breachedKpis.slice(0, 5),
        },
      });
    }

    logger.info({
      recipients: adminUsers.length,
      completedTasks: completedTasks.length,
      delayedTasks: delayedTasks.length,
      breachedKpis: breachedKpis.length,
      newDocuments: newDocuments.length,
    }, '✅ Weekly audit report generated');
  } catch (error) {
    logger.error({ error }, '❌ Weekly audit report failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
