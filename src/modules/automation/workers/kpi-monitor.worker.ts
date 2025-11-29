import { Worker, Job } from 'bullmq';
import { QueueName, redisConnection } from '../../../config/queue.config';
import { createLogger } from '../../../lib/logger';
import { PrismaClient, KPIStatus } from '@prisma/client';
import { notificationService } from '../../notifications/notification.service';
import { randomUUID } from 'crypto';

const logger = createLogger({ name: 'KpiMonitorWorker' });
const prisma = new PrismaClient();

interface KpiAutomationJobData {
  kpiId: string;
  projectId: string;
  action: 'CHECK_BREACH' | 'CALCULATE_SCORE' | 'TRIGGER_ACTION';
  metadata?: Record<string, unknown>;
}

/**
 * KPI Monitor Worker
 * 
 * İşlevler:
 * 1. CHECK_BREACH: KPI breach kontrolü (current > threshold)
 * 2. CALCULATE_SCORE: Proje health score hesapla
 * 3. TRIGGER_ACTION: Breach durumunda corrective action oluştur
 */
class KpiMonitorWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker<KpiAutomationJobData>(
      QueueName.KPI_AUTOMATION,
      async (job: Job<KpiAutomationJobData>) => {
        logger.info({ jobId: job.id, action: job.data.action }, '📊 Processing KPI automation job');

        try {
          switch (job.data.action) {
            case 'CHECK_BREACH':
              await this.checkBreach(job.data.kpiId);
              break;
            case 'CALCULATE_SCORE':
              await this.calculateScore(job.data.projectId);
              break;
            case 'TRIGGER_ACTION':
              await this.triggerAction(job.data.kpiId);
              break;
            default:
              throw new Error(`Unknown action: ${job.data.action}`);
          }

          logger.info({ jobId: job.id, kpiId: job.data.kpiId }, '✅ KPI automation job completed');
        } catch (error) {
          logger.error({ jobId: job.id, error }, '❌ KPI automation job failed');
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 3, // 3 job parallel işle
      }
    );

    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'KPI automation job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'KPI automation job failed');
    });

    logger.info('🚀 KpiMonitorWorker started');
  }

  /**
   * CHECK_BREACH: KPI breach kontrolü
   */
  private async checkBreach(kpiId: string): Promise<void> {
    const kpi = await prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1, // Son değer
        },
      },
    });

    if (!kpi) {
      logger.warn({ kpiId }, 'KPI not found');
      return;
    }

    // Sadece ACTIVE, MONITORING, veya BREACHED status'ündeki KPI'ları kontrol et
    if (
      kpi.status !== KPIStatus.ACTIVE && 
      kpi.status !== KPIStatus.MONITORING &&
      kpi.status !== KPIStatus.BREACHED
    ) {
      return;
    }

    const latestSeries = kpi.series[0];
    if (!latestSeries) {
      return; // Henüz veri yok
    }

    const actualValue = parseFloat(latestSeries.actualValue.toString());
    const targetValue = parseFloat(kpi.targetValue.toString());
    const thresholdCritical = kpi.thresholdCritical ? parseFloat(kpi.thresholdCritical.toString()) : null;

    // Critical threshold breach kontrolü (value below critical threshold)
    if (thresholdCritical && actualValue < thresholdCritical) {
      const deviation = ((actualValue - thresholdCritical) / thresholdCritical) * 100;

      logger.warn(
        { kpiId, kpiName: kpi.name, actualValue, thresholdCritical, deviation },
        `⚠️ KPI critical threshold breached! Actual: ${actualValue}, Critical: ${thresholdCritical}`
      );

      // KPI steward'a email bildirim gönder (ownerId yerine stewardId)
      if (kpi.stewardId) {
        const steward = await prisma.user.findUnique({
          where: { id: kpi.stewardId },
        });

        if (steward) {
          await notificationService.send({
            type: 'kpi-breach',
            kpiId: kpi.id,
            kpiName: kpi.name,
            currentValue: actualValue,
            targetValue,
            thresholdValue: thresholdCritical,
            deviation,
            severity: 'critical',
            ownerName: steward.fullName,
            ownerEmail: steward.email,
            kpiUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/kpis/${kpi.id}`,
          });
        }
      }

      // Corrective action job'ı ekle (FR-44 için)
      // await queueService.addKpiAutomationJob({
      //   kpiId: kpi.id,
      //   projectId: kpi.projectId,
      //   action: 'TRIGGER_ACTION',
      // });
    } else if (actualValue < targetValue) {
      logger.info(
        { kpiId, kpiName: kpi.name, actualValue, targetValue },
        `⚠️ KPI target missed! Actual: ${actualValue}, Target: ${targetValue}`
      );
    } else {
      logger.debug(
        { kpiId, kpiName: kpi.name },
        '✅ KPI within target'
      );
    }
  }

  /**
   * CALCULATE_SCORE: Proje health score hesapla
   * 
   * Health Score Formula:
   * - On-time tasks: 50%
   * - Completion rate: 50%
   */
  private async calculateScore(projectId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: true,
      },
    });

    if (!project) {
      logger.warn({ projectId }, 'Project not found');
      return;
    }

    const totalTasks = project.tasks.length;
    if (totalTasks === 0) {
      logger.info({ projectId }, 'No tasks to calculate score');
      return;
    }

    // 1. On-time tasks (50%)
    const now = new Date();
    const onTimeTasks = project.tasks.filter((task) => {
      if (!task.plannedEnd) return true;
      if (task.actualEnd) return task.actualEnd <= task.plannedEnd;
      return now <= task.plannedEnd;
    }).length;
    const taskScore = (onTimeTasks / totalTasks) * 50;

    // 2. Completion rate (50%)
    const completedTasks = project.tasks.filter((task) => task.actualEnd).length;
    const completionScore = (completedTasks / totalTasks) * 50;

    const healthScore = Math.round(taskScore + completionScore);

    logger.info(
      { projectId, projectName: project.name, healthScore, totalTasks, onTimeTasks, completedTasks },
      `📊 Project health score calculated: ${healthScore}/100`
    );

    // Project.healthScore field'ına kaydet
    await prisma.project.update({
      where: { id: projectId },
      data: { healthScore }
    });
  }

  /**
   * TRIGGER_ACTION: Breach durumunda corrective action oluştur (FR-44)
   */
  private async triggerAction(kpiId: string): Promise<void> {
    const kpi = await prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        steward: true,
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1,
        },
      },
    });

    if (!kpi) {
      logger.warn({ kpiId }, 'KPI not found');
      return;
    }

    // Linked project yoksa task oluşturamazsın
    if (!kpi.linkedProjectIds || kpi.linkedProjectIds.length === 0) {
      logger.warn({ kpiId, kpiName: kpi.name }, 'No linked projects for corrective action task');
      return;
    }

    const projectId = kpi.linkedProjectIds[0]; // İlk linked project
    const latestSeries = kpi.series[0];
    
    if (!latestSeries) {
      logger.warn({ kpiId }, 'No KPI series data for corrective action');
      return;
    }

    const actualValue = parseFloat(latestSeries.actualValue.toString());
    const targetValue = parseFloat(kpi.targetValue.toString());
    const thresholdCritical = kpi.thresholdCritical 
      ? parseFloat(kpi.thresholdCritical.toString()) 
      : null;
    const deviation = thresholdCritical 
      ? ((actualValue - thresholdCritical) / thresholdCritical * 100).toFixed(2)
      : 'N/A';

    // Due date: 7 gün sonra
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    // Task description
    const description = `
**AUTOMATIC CORRECTIVE ACTION TASK**

This task was automatically created due to a critical KPI threshold breach.

**KPI Details:**
- **KPI Name:** ${kpi.name}
- **KPI Code:** ${kpi.code}
- **Category:** ${kpi.category}
- **Unit:** ${kpi.unit}

**Performance Metrics:**
- **Current Value:** ${actualValue} ${kpi.unit}
- **Target Value:** ${targetValue} ${kpi.unit}
- **Critical Threshold:** ${thresholdCritical || 'N/A'} ${kpi.unit}
- **Deviation:** ${deviation}%
- **Status:** CRITICAL BREACH ⚠️

**Required Actions:**
1. Investigate the root cause of the KPI breach
2. Develop and document a corrective action plan
3. Implement the corrective actions
4. Monitor KPI values to ensure improvement
5. Update this task with progress and findings

**Due Date:** ${dueDate.toISOString().split('T')[0]} (7 days from breach detection)

**Note:** This is a high-priority task. Please address it promptly to bring the KPI back within acceptable thresholds.
    `.trim();

    // Corrective action task oluştur
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        title: `[KPI BREACH] ${kpi.name} - Corrective Action Required`,
        description,
        status: 'PLANNED',
        priority: 'CRITICAL',
        projectId,
        ownerId: kpi.stewardId,
        reporterId: kpi.stewardId,
        plannedEnd: dueDate,
      },
    });

    logger.info(
      { 
        kpiId, 
        kpiName: kpi.name, 
        taskId: task.id,
        projectId,
        stewardId: kpi.stewardId,
        dueDate,
      },
      '✅ Corrective action task created for KPI breach (FR-44)'
    );

    // Task sahibine bildirim gönder
    await notificationService.send({
      type: 'task-assigned',
      taskId: task.id,
      taskTitle: task.title,
      projectName: '', // Project name yüklenecek
      assignedToName: kpi.steward.fullName,
      assignedToEmail: kpi.steward.email,
      assignedByName: 'System (Auto-generated)',
      taskUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/projects/${projectId}/tasks/${task.id}`,
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await prisma.$disconnect();
    logger.info('🛑 KpiMonitorWorker stopped');
  }
}

// Singleton instance
let workerInstance: KpiMonitorWorker | null = null;

export function startKpiMonitorWorker(): KpiMonitorWorker {
  if (!workerInstance) {
    workerInstance = new KpiMonitorWorker();
  }
  return workerInstance;
}

export async function stopKpiMonitorWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
