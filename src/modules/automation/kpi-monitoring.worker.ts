import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { QueueName, redisConnection } from '../../config/queue.config';
import { createLogger } from '../../lib/logger';
import { getQueueService } from './queue.service';
import { getKPIBreachService } from '../kpi/kpi-breach.service';

const logger = createLogger({ name: 'KPIMonitoringWorker' });

/**
 * KPI Monitoring Worker
 * 
 * Handles:
 * - Project health monitoring
 * - Task completion metrics
 * - KPI threshold breach detection
 * - Automated alerts
 */
export class KPIMonitoringWorker {
  private worker: Worker;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    
    this.worker = new Worker(
      QueueName.KPI_AUTOMATION,
      async (job: Job) => {
        return await this.processJob(job);
      },
      {
        connection: redisConnection,
        concurrency: 3,
      }
    );

    this.setupEventHandlers();
    logger.info('📊 KPI Monitoring Worker started');
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, action: job.name }, '✅ KPI monitoring job completed');
    });

    this.worker.on('failed', (job, error) => {
      logger.error({ 
        jobId: job?.id, 
        action: job?.name, 
        error: error.message 
      }, '❌ KPI monitoring job failed');
    });
  }

  private async processJob(job: Job): Promise<void> {
    const { action } = job.data;

    switch (action) {
      case 'CALCULATE_ALL':
        await this.calculateAllMetrics();
        break;
      case 'CALCULATE_PROJECT_HEALTH':
        await this.calculateProjectHealth(job.data.projectId);
        break;
      case 'CHECK_KPI_BREACH':
        // Use KPI Breach Service to process all breaches
        logger.info('[KPIMonitoringWorker] Processing KPI breaches via KPI Breach Service');
        const kpiBreachService = getKPIBreachService();
        const summary = await kpiBreachService.processBreaches();
        logger.info(
          {
            totalBreaches: summary.totalBreaches,
            tasksCreated: summary.tasksCreated,
            tasksDuplicate: summary.tasksDuplicate,
          },
          '[KPIMonitoringWorker] KPI breach processing complete'
        );
        break;
      default:
        logger.warn({ action }, 'Unknown KPI monitoring action');
    }
  }

  /**
   * Calculate metrics for all active projects
   */
  private async calculateAllMetrics(): Promise<void> {
    const activeProjects = await this.prisma.project.findMany({
      where: {
        status: {
          in: ['ACTIVE', 'PLANNING'],
        },
      },
      select: { id: true },
    });

    logger.info({ count: activeProjects.length }, '🔍 Calculating metrics for active projects');

    for (const project of activeProjects) {
      try {
        await this.calculateProjectHealth(project.id);
        await this.checkKPIBreaches(project.id);
      } catch (error) {
        logger.error({ projectId: project.id, error }, '❌ Failed to calculate metrics for project');
      }
    }

    logger.info({ processed: activeProjects.length }, '✅ Metrics calculation completed');
  }

  /**
   * Calculate project health metrics
   */
  private async calculateProjectHealth(projectId: string): Promise<void> {
    const [project, tasks] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          sponsor: {
            select: { email: true, fullName: true },
          },
        },
      }),
      this.prisma.task.findMany({
        where: { projectId },
        select: {
          status: true,
          plannedEnd: true,
          actualEnd: true,
        },
      }),
    ]);

    if (!project) {
      logger.warn({ projectId }, 'Project not found');
      return;
    }

    const totalTasks = tasks.length;
    if (totalTasks === 0) {
      logger.debug({ projectId }, 'No tasks to calculate health');
      return;
    }

    // Calculate metrics
    const completedTasks = tasks.filter(t => t.status === 'COMPLETED').length;
    const overdueTasks = tasks.filter(t => 
      t.plannedEnd && 
      t.plannedEnd < new Date() && 
      t.status !== 'COMPLETED' &&
      t.status !== 'CANCELLED'
    ).length;
    const blockedTasks = tasks.filter(t => t.status === 'BLOCKED').length;

    // Calculate completion rate
    const completionRate = (completedTasks / totalTasks) * 100;
    
    // Calculate on-time rate for completed tasks
    const completedWithDates = tasks.filter(
      t => t.status === 'COMPLETED' && t.actualEnd && t.plannedEnd
    );
    const onTimeTasks = completedWithDates.filter(
      t => t.actualEnd! <= t.plannedEnd!
    ).length;
    const onTimeRate = completedWithDates.length > 0 
      ? (onTimeTasks / completedWithDates.length) * 100 
      : 100;

    // Calculate health score (0-100)
    const overdueRate = (overdueTasks / totalTasks);
    const blockedRate = (blockedTasks / totalTasks);
    const healthScore = Math.round(
      (completionRate * 0.4) + // 40% weight on completion
      (onTimeRate * 0.4) + // 40% weight on on-time delivery
      ((1 - blockedRate) * 100 * 0.2) // 20% weight on not blocked
    );

    logger.info({ 
      projectId,
      projectName: project.name,
      healthScore,
      completionRate: `${completionRate.toFixed(1)}%`,
      onTimeRate: `${onTimeRate.toFixed(1)}%`,
      overdueTasks,
      blockedTasks,
      totalTasks,
      completedTasks,
    }, '📈 Project health calculated');
  }

  /**
   * Check for KPI breaches in project-linked KPIs
   */
  private async checkKPIBreaches(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        sponsor: {
          select: { email: true, fullName: true },
        },
      },
    });

    if (!project) {
      logger.warn({ projectId }, 'Project not found');
      return;
    }

    // Find KPIs linked to this project
    const kpis = await this.prisma.kPIDefinition.findMany({
      where: {
        linkedProjectIds: {
          has: projectId,
        },
        status: 'ACTIVE',
      },
      include: {
        series: {
          orderBy: {
            collectedAt: 'desc',
          },
          take: 1, // Get latest value
        },
      },
    });

    if (kpis.length === 0) {
      logger.debug({ projectId }, 'No KPIs linked to project');
      return;
    }

    const breaches: Array<{
      kpiName: string;
      currentValue: number;
      targetValue: number;
      severity: 'WARNING' | 'CRITICAL';
    }> = [];

    // Check each KPI for breaches
    for (const kpi of kpis) {
      if (kpi.series.length === 0) continue;

      const latestValue = Number(kpi.series[0].actualValue);
      const target = Number(kpi.targetValue);
      const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
      const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

      // Check critical threshold
      if (critical !== null && latestValue < critical) {
        breaches.push({
          kpiName: kpi.name,
          currentValue: latestValue,
          targetValue: target,
          severity: 'CRITICAL',
        });
      }
      // Check warning threshold
      else if (warning !== null && latestValue < warning) {
        breaches.push({
          kpiName: kpi.name,
          currentValue: latestValue,
          targetValue: target,
          severity: 'WARNING',
        });
      }
    }

    if (breaches.length > 0) {
      logger.warn({ projectId, breachCount: breaches.length }, '⚠️ KPI breaches detected');

      // Send alert email to sponsor (project manager role can be inferred from members)
      const queueService = getQueueService();
      const recipients = project.sponsor?.email ? [project.sponsor.email] : [];

      if (recipients.length > 0) {
        await queueService.sendTemplateEmail({
          to: recipients,
          template: 'kpi-breach',
          data: {
            projectName: project.name,
            projectCode: project.code || project.id,
            breaches: breaches.map(b => ({
              name: b.kpiName,
              current: b.currentValue.toFixed(2),
              target: b.targetValue.toFixed(2),
              severity: b.severity,
            })),
          },
          priority: 1, // Critical priority
        });

        logger.info({ projectId, recipients, breachCount: breaches.length }, '📧 KPI breach alert sent');
      }
    } else {
      logger.debug({ projectId }, 'No KPI breaches detected');
    }
  }

  /**
   * Stop the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('🛑 KPI Monitoring Worker stopped');
  }
}
