import { Queue, Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { KPIStatus } from '@prisma/client';
import type { EmailService } from '../notifications/email.service';
import type { TaskService } from '../tasks/task.service';

interface KPIMonitoringJobData {
  kpiId: string;
}

interface KPIWithLatestData {
  id: string;
  code: string;
  name: string;
  category: string;
  targetValue: Prisma.Decimal;
  unit: string;
  thresholdWarning: Prisma.Decimal | null;
  thresholdCritical: Prisma.Decimal | null;
  linkedProjectIds: string[] | null;
  series: Array<{
    id: string;
    actualValue: Prisma.Decimal;
    periodStart: Date;
    periodEnd: Date;
    collectedAt: Date;
    valueSource: string;
    verificationStatus: string;
  }>;
  steward: { id: string; email: string; fullName: string };
}

interface ThresholdCheckResult {
  kpiId: string;
  code: string;
  name: string;
  currentValue: number | null;
  targetValue: number;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  exceedsWarning: boolean;
  exceedsCritical: boolean;
  deviation: number | null;
}

export class KPIMonitoringQueueService {
  private queue: Queue<KPIMonitoringJobData>;
  private worker: Worker<KPIMonitoringJobData>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly emailService: EmailService,
    private readonly taskService: TaskService,
    private readonly logger: Logger,
    redisConnection: { host: string; port: number },
  ) {
    this.queue = new Queue<KPIMonitoringJobData>('kpi-monitoring', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 minute base delay
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs for auditing
          age: 86400, // Remove after 24 hours
        },
        removeOnFail: {
          count: 500, // Keep last 500 failed jobs
        },
      },
    });

    this.worker = new Worker<KPIMonitoringJobData>(
      'kpi-monitoring',
      async (job: Job<KPIMonitoringJobData>) => {
        await this.processKPIMonitoring(job);
      },
      {
        connection: redisConnection,
        concurrency: 10, // Process up to 10 KPIs simultaneously
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.info({ jobId: job.id, kpiId: job.data.kpiId }, 'KPI monitoring job completed');
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        { jobId: job?.id, kpiId: job?.data.kpiId, error: err.message },
        'KPI monitoring job failed',
      );
    });
  }

  /**
   * Schedule recurring KPI monitoring job (every 6 hours at :15)
   * Cron pattern runs at 00:15, 06:15, 12:15, 18:15 daily
   */
  async scheduleRecurringMonitoring(): Promise<void> {
    // Add repeatable job for all active KPIs
    await this.queue.add(
      'monitor-all-kpis',
      { kpiId: 'ALL' }, // Special marker to check all KPIs
      {
        repeat: {
          pattern: '15 */6 * * *', // Every 6 hours at :15 minutes
        },
        jobId: 'kpi-monitoring-recurring',
      },
    );

    this.logger.info('Scheduled recurring KPI monitoring (every 6 hours)');
  }

  /**
   * Manually trigger monitoring for a specific KPI
   */
  async monitorKPI(kpiId: string): Promise<void> {
    await this.queue.add('monitor-single-kpi', { kpiId });
    this.logger.info({ kpiId }, 'Queued single KPI monitoring');
  }

  /**
   * Process KPI monitoring job
   */
  private async processKPIMonitoring(job: Job<KPIMonitoringJobData>): Promise<void> {
    const { kpiId } = job.data;

    if (kpiId === 'ALL') {
      // Check all active/monitoring KPIs
      await this.monitorAllActiveKPIs();
    } else {
      // Check single KPI
      await this.checkKPIThresholds(kpiId);
    }
  }

  /**
   * Monitor all ACTIVE and MONITORING KPIs
   */
  private async monitorAllActiveKPIs(): Promise<void> {
    const activeKPIs = await this.prisma.kPIDefinition.findMany({
      where: {
        status: {
          in: [KPIStatus.ACTIVE, KPIStatus.MONITORING],
        },
      },
      select: {
        id: true,
      },
    });

    this.logger.info({ count: activeKPIs.length }, 'Monitoring active KPIs');

    for (const kpi of activeKPIs) {
      try {
        await this.checkKPIThresholds(kpi.id);
      } catch (error) {
        this.logger.error({ kpiId: kpi.id, error }, 'Failed to check KPI thresholds');
      }
    }
  }

  /**
   * Check thresholds for a single KPI and take action if needed
   */
  private async checkKPIThresholds(kpiId: string): Promise<void> {
    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        steward: {
          select: { id: true, email: true, fullName: true },
        },
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1,
        },
      },
    });

    if (!kpi) {
      this.logger.warn({ kpiId }, 'KPI not found');
      return;
    }

    const result = this.evaluateThresholds(kpi);

    // Take action based on threshold breach
    if (result.exceedsCritical) {
      await this.handleCriticalBreach(kpi, result);
    } else if (result.exceedsWarning) {
      await this.handleWarningBreach(kpi, result);
    }
  }

  /**
   * Evaluate threshold breach for a KPI
   */
  private evaluateThresholds(kpi: KPIWithLatestData): ThresholdCheckResult {
    const latestData = kpi.series[0];
    const currentValue = latestData ? Number(latestData.actualValue) : null;
    const targetValue = Number(kpi.targetValue);

    let deviation: number | null = null;
    if (currentValue !== null) {
      deviation = ((currentValue - targetValue) / targetValue) * 100;
    }

    const warningThreshold = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
    const criticalThreshold = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

    const exceedsWarning = warningThreshold !== null && deviation !== null && Math.abs(deviation) >= warningThreshold;
    const exceedsCritical = criticalThreshold !== null && deviation !== null && Math.abs(deviation) >= criticalThreshold;

    return {
      kpiId: kpi.id,
      code: kpi.code,
      name: kpi.name,
      currentValue,
      targetValue,
      warningThreshold,
      criticalThreshold,
      exceedsWarning,
      exceedsCritical,
      deviation,
    };
  }

  /**
   * Handle warning threshold breach - send email notification
   */
  private async handleWarningBreach(
    kpi: KPIWithLatestData,
    result: ThresholdCheckResult,
  ): Promise<void> {
    this.logger.warn(
      { kpiId: kpi.id, code: kpi.code, deviation: result.deviation },
      'KPI warning threshold breached',
    );

    // Send email to steward
    const emailHtml = this.generateWarningEmail(kpi, result);
    await this.emailService.sendEmail({
      to: [kpi.steward.email],
      subject: `⚠️ KPI Warning: ${kpi.name} (${kpi.code})`,
      text: `KPI Warning: ${kpi.name} has exceeded its warning threshold`,
      html: emailHtml,
    });

    this.logger.info({ kpiId: kpi.id, email: kpi.steward.email }, 'Warning email sent to steward');
  }

  /**
   * Handle critical threshold breach - send email + update status + create corrective task
   */
  private async handleCriticalBreach(
    kpi: KPIWithLatestData,
    result: ThresholdCheckResult,
  ): Promise<void> {
    this.logger.error(
      { kpiId: kpi.id, code: kpi.code, deviation: result.deviation },
      'KPI critical threshold breached',
    );

    // Update KPI status to BREACHED
    await this.prisma.kPIDefinition.update({
      where: { id: kpi.id },
      data: { status: KPIStatus.BREACHED },
    });

    // Send critical email to steward
    const emailHtml = this.generateCriticalEmail(kpi, result);
    await this.emailService.sendEmail({
      to: [kpi.steward.email],
      subject: `🚨 CRITICAL: KPI Breach - ${kpi.name} (${kpi.code})`,
      text: `CRITICAL: KPI ${kpi.name} has exceeded its critical threshold`,
      html: emailHtml,
    });

    // Create corrective action task
    await this.createCorrectiveTask(kpi, result);

    this.logger.info(
      { kpiId: kpi.id, email: kpi.steward.email },
      'Critical breach handled: status updated, email sent, corrective task created',
    );
  }

  /**
   * Create a corrective action task for critical KPI breach
   */
  private async createCorrectiveTask(
    kpi: KPIWithLatestData,
    result: ThresholdCheckResult,
  ): Promise<void> {
    // Check if KPI is linked to any projects
    if (!kpi.linkedProjectIds || kpi.linkedProjectIds.length === 0) {
      this.logger.warn({ kpiId: kpi.id }, 'KPI not linked to any project, skipping task creation');
      return;
    }

    const projectId = kpi.linkedProjectIds[0]; // Use first linked project

    await this.taskService.createTask({
      title: `Corrective Action: ${kpi.name} Critical Breach`,
      description: `**KPI Critical Threshold Breached**\n\n` +
        `- **KPI**: ${kpi.name} (${kpi.code})\n` +
        `- **Current Value**: ${result.currentValue} ${kpi.unit}\n` +
        `- **Target Value**: ${result.targetValue} ${kpi.unit}\n` +
        `- **Deviation**: ${result.deviation?.toFixed(2)}%\n` +
        `- **Critical Threshold**: ${result.criticalThreshold}%\n\n` +
        `**Action Required**: Investigate root cause and implement corrective measures.`,
      priority: 'CRITICAL',
      projectId,
      ownerId: kpi.steward.id,
      effortPlannedHours: 8,
      metadata: { 
        type: 'kpi-breach', 
        kpiId: kpi.id,
        kpiCode: kpi.code,
      },
    });

    this.logger.info({ kpiId: kpi.id, projectId }, 'Corrective action task created');
  }

  /**
   * Generate modern HTML email for warning threshold breach
   */
  private generateWarningEmail(kpi: KPIWithLatestData, result: ThresholdCheckResult): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #fff; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 30px 20px; }
    .kpi-info { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .metric:last-child { border-bottom: none; }
    .metric-label { font-weight: 500; color: #6b7280; }
    .metric-value { font-weight: 600; color: #111827; }
    .warning { color: #f59e0b; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
    .button { display: inline-block; background: #f59e0b; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ KPI Warning Threshold Breached</h1>
    </div>
    <div class="content">
      <p>Hello <strong>${kpi.steward.fullName}</strong>,</p>
      <p>The KPI <strong>${kpi.name}</strong> has exceeded its warning threshold and requires your attention.</p>
      
      <div class="kpi-info">
        <h3 style="margin-top: 0; color: #f59e0b;">KPI Details</h3>
        <div class="metric">
          <span class="metric-label">Code:</span>
          <span class="metric-value">${kpi.code}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Category:</span>
          <span class="metric-value">${kpi.category}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Current Value:</span>
          <span class="metric-value warning">${result.currentValue} ${kpi.unit}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Target Value:</span>
          <span class="metric-value">${result.targetValue} ${kpi.unit}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Deviation:</span>
          <span class="metric-value warning">${result.deviation?.toFixed(2)}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Warning Threshold:</span>
          <span class="metric-value">${result.warningThreshold}%</span>
        </div>
      </div>

      <p><strong>Recommended Action:</strong> Review the KPI performance and identify potential issues before they escalate to critical levels.</p>
    </div>
    <div class="footer">
      <p>Metrika Project Management System</p>
      <p>This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Generate modern HTML email for critical threshold breach
   */
  private generateCriticalEmail(kpi: KPIWithLatestData, result: ThresholdCheckResult): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: #fff; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 30px 20px; }
    .kpi-info { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .metric:last-child { border-bottom: none; }
    .metric-label { font-weight: 500; color: #6b7280; }
    .metric-value { font-weight: 600; color: #111827; }
    .critical { color: #dc2626; font-weight: 700; }
    .alert-box { background: #fef2f2; border: 2px solid #dc2626; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 CRITICAL: KPI Threshold Breached</h1>
    </div>
    <div class="content">
      <p>Hello <strong>${kpi.steward.fullName}</strong>,</p>
      
      <div class="alert-box">
        <h3 style="margin-top: 0; color: #dc2626;">⚠️ Immediate Action Required</h3>
        <p style="margin-bottom: 0;">The KPI <strong>${kpi.name}</strong> has exceeded its <strong>CRITICAL</strong> threshold. The KPI status has been updated to <strong>BREACHED</strong> and a corrective action task has been created.</p>
      </div>
      
      <div class="kpi-info">
        <h3 style="margin-top: 0; color: #dc2626;">KPI Details</h3>
        <div class="metric">
          <span class="metric-label">Code:</span>
          <span class="metric-value">${kpi.code}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Category:</span>
          <span class="metric-value">${kpi.category}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Current Value:</span>
          <span class="metric-value critical">${result.currentValue} ${kpi.unit}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Target Value:</span>
          <span class="metric-value">${result.targetValue} ${kpi.unit}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Deviation:</span>
          <span class="metric-value critical">${result.deviation?.toFixed(2)}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Critical Threshold:</span>
          <span class="metric-value">${result.criticalThreshold}%</span>
        </div>
      </div>

      <h3>Next Steps:</h3>
      <ol>
        <li>Review the corrective action task assigned to you</li>
        <li>Investigate the root cause of the performance deviation</li>
        <li>Implement corrective measures within 7 days</li>
        <li>Update the KPI status once resolved</li>
      </ol>
    </div>
    <div class="footer">
      <p>Metrika Project Management System</p>
      <p>This is an automated critical notification. Please take immediate action.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Graceful shutdown - close queue and worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.logger.info('KPI monitoring queue and worker closed');
  }
}
