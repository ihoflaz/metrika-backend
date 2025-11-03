import { PrismaClient, KPIStatus, TaskStatus, TaskPriority } from '@prisma/client';
import { logger } from '../../lib/logger';
import { uuidv7 } from 'uuidv7';

interface BreachInfo {
  kpiId: string;
  kpiCode: string;
  kpiName: string;
  currentValue: number;
  targetValue: number;
  thresholdWarning: number | null;
  thresholdCritical: number | null;
  breachType: 'WARNING' | 'CRITICAL';
  deviation: number;
  stewardId: string;
  linkedProjectIds: string[];
}

interface CorrectiveTaskResult {
  taskId: string | null;
  kpiId: string;
  breachType: 'WARNING' | 'CRITICAL';
  created: boolean;
  reason?: string;
}

export class KPIBreachService {
  private prisma: PrismaClient;
  private logger = logger.child({ service: 'KPIBreachService' });

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Check all active KPIs for threshold breaches
   * Returns list of breached KPIs with details
   */
  async checkAllKPIBreaches(): Promise<BreachInfo[]> {
    this.logger.info('[KPIBreachService] Checking all active KPIs for breaches');

    // Get all active KPIs with latest series data
    const kpis = await this.prisma.kPIDefinition.findMany({
      where: {
        status: KPIStatus.ACTIVE,
      },
      include: {
        series: {
          orderBy: {
            periodEnd: 'desc',
          },
          take: 1,
        },
        steward: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });

    const breachedKPIs: BreachInfo[] = [];

    for (const kpi of kpis) {
      if (kpi.series.length === 0) {
        this.logger.debug({ kpiId: kpi.id, kpiCode: kpi.code }, 'No series data, skipping');
        continue;
      }

      const latestSeries = kpi.series[0];
      const currentValue = Number(latestSeries.actualValue);
      const targetValue = Number(kpi.targetValue);
      const thresholdWarning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
      const thresholdCritical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

      // Calculate deviation percentage
      const deviation = ((currentValue - targetValue) / targetValue) * 100;

      // Check for critical breach first
      if (thresholdCritical !== null && Math.abs(currentValue - targetValue) >= Math.abs(thresholdCritical - targetValue)) {
        this.logger.warn(
          {
            kpiId: kpi.id,
            kpiCode: kpi.code,
            currentValue,
            targetValue,
            thresholdCritical,
            deviation,
          },
          'CRITICAL breach detected'
        );

        breachedKPIs.push({
          kpiId: kpi.id,
          kpiCode: kpi.code,
          kpiName: kpi.name,
          currentValue,
          targetValue,
          thresholdWarning,
          thresholdCritical,
          breachType: 'CRITICAL',
          deviation,
          stewardId: kpi.stewardId,
          linkedProjectIds: kpi.linkedProjectIds,
        });
      }
      // Check for warning breach
      else if (thresholdWarning !== null && Math.abs(currentValue - targetValue) >= Math.abs(thresholdWarning - targetValue)) {
        this.logger.warn(
          {
            kpiId: kpi.id,
            kpiCode: kpi.code,
            currentValue,
            targetValue,
            thresholdWarning,
            deviation,
          },
          'WARNING breach detected'
        );

        breachedKPIs.push({
          kpiId: kpi.id,
          kpiCode: kpi.code,
          kpiName: kpi.name,
          currentValue,
          targetValue,
          thresholdWarning,
          thresholdCritical,
          breachType: 'WARNING',
          deviation,
          stewardId: kpi.stewardId,
          linkedProjectIds: kpi.linkedProjectIds,
        });
      }
    }

    this.logger.info(
      { totalKPIs: kpis.length, breachedCount: breachedKPIs.length },
      '[KPIBreachService] Breach check complete'
    );

    return breachedKPIs;
  }

  /**
   * Create corrective action task for a breached KPI
   * Prevents duplicates by checking for existing active corrective tasks
   */
  async createCorrectiveTask(breach: BreachInfo): Promise<CorrectiveTaskResult> {
    this.logger.info(
      { kpiId: breach.kpiId, kpiCode: breach.kpiCode, breachType: breach.breachType },
      '[KPIBreachService] Creating corrective action task'
    );

    // Check for existing active corrective tasks for this KPI
    const existingTask = await this.prisma.task.findFirst({
      where: {
        linkedKpiIds: {
          has: breach.kpiId,
        },
        title: {
          startsWith: 'Corrective Action:',
        },
        status: {
          in: [TaskStatus.PLANNED, TaskStatus.IN_PROGRESS],
        },
      },
    });

    if (existingTask) {
      this.logger.info(
        { kpiId: breach.kpiId, existingTaskId: existingTask.id },
        '[KPIBreachService] Corrective task already exists, skipping duplicate'
      );

      return {
        taskId: existingTask.id,
        kpiId: breach.kpiId,
        breachType: breach.breachType,
        created: false,
        reason: 'Duplicate - Active corrective task already exists',
      };
    }

    // Determine priority based on breach type
    const priority = breach.breachType === 'CRITICAL' ? TaskPriority.HIGH : TaskPriority.NORMAL;

    // Select a project to link the task to (prefer first linked project)
    const projectId = breach.linkedProjectIds.length > 0 ? breach.linkedProjectIds[0] : null;

    // If no project is linked, we cannot create a task (Task requires projectId)
    if (!projectId) {
      this.logger.warn(
        { kpiId: breach.kpiId, kpiCode: breach.kpiCode },
        '[KPIBreachService] Cannot create corrective task - KPI has no linked projects'
      );

      return {
        taskId: null,
        kpiId: breach.kpiId,
        breachType: breach.breachType,
        created: false,
        reason: 'Cannot create task - KPI has no linked projects',
      };
    }

    // Create task description with breach details
    const description = `Automatic corrective action task created for KPI breach.

**KPI Details:**
- Code: ${breach.kpiCode}
- Name: ${breach.kpiName}
- Current Value: ${breach.currentValue.toFixed(2)}
- Target Value: ${breach.targetValue.toFixed(2)}
- Deviation: ${breach.deviation.toFixed(1)}%
- Breach Type: ${breach.breachType}

**Action Required:**
Please investigate the cause of this KPI breach and implement corrective measures to bring the KPI back to acceptable levels.`;

    // Generate unique task code
    const taskCode = `CORRECTIVE-${breach.kpiCode}-${Date.now().toString(36).toUpperCase()}`;

    // Create the corrective task
    const task = await this.prisma.task.create({
      data: {
        id: uuidv7(),
        code: taskCode,
        title: `Corrective Action: ${breach.kpiName}`,
        description,
        status: TaskStatus.PLANNED,
        priority,
        ownerId: breach.stewardId,
        reporterId: breach.stewardId, // System creates it, but assign to steward
        projectId: projectId as string, // Will be defined from linkedProjectIds
        linkedKpiIds: [breach.kpiId],
        effortPlannedHours: 8, // 1 day default
        plannedStart: new Date(),
        plannedEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      },
    });

    this.logger.info(
      { taskId: task.id, kpiId: breach.kpiId, priority, projectId },
      '[KPIBreachService] Corrective task created successfully'
    );

    // Update KPI status to BREACHED
    await this.prisma.kPIDefinition.update({
      where: { id: breach.kpiId },
      data: { status: KPIStatus.BREACHED },
    });

    this.logger.info({ kpiId: breach.kpiId }, '[KPIBreachService] KPI status updated to BREACHED');

    return {
      taskId: task.id,
      kpiId: breach.kpiId,
      breachType: breach.breachType,
      created: true,
    };
  }

  /**
   * Process all breached KPIs and create corrective tasks
   * Returns summary of created tasks
   */
  async processBreaches(): Promise<{
    totalBreaches: number;
    tasksCreated: number;
    tasksDuplicate: number;
    results: CorrectiveTaskResult[];
  }> {
    this.logger.info('[KPIBreachService] Starting breach processing');

    const breaches = await this.checkAllKPIBreaches();

    if (breaches.length === 0) {
      this.logger.info('[KPIBreachService] No breaches detected');
      return {
        totalBreaches: 0,
        tasksCreated: 0,
        tasksDuplicate: 0,
        results: [],
      };
    }

    const results: CorrectiveTaskResult[] = [];

    for (const breach of breaches) {
      try {
        const result = await this.createCorrectiveTask(breach);
        results.push(result);
      } catch (error) {
        this.logger.error(
          { error, kpiId: breach.kpiId, kpiCode: breach.kpiCode },
          '[KPIBreachService] Failed to create corrective task'
        );
      }
    }

    const tasksCreated = results.filter((r) => r.created).length;
    const tasksDuplicate = results.filter((r) => !r.created).length;

    this.logger.info(
      {
        totalBreaches: breaches.length,
        tasksCreated,
        tasksDuplicate,
      },
      '[KPIBreachService] Breach processing complete'
    );

    return {
      totalBreaches: breaches.length,
      tasksCreated,
      tasksDuplicate,
      results,
    };
  }

  /**
   * Get list of currently breached KPIs
   */
  async getBreachedKPIs(): Promise<BreachInfo[]> {
    return this.checkAllKPIBreaches();
  }

  /**
   * Check if a specific KPI is breached
   */
  async checkKPIBreach(kpiId: string): Promise<BreachInfo | null> {
    this.logger.debug({ kpiId }, '[KPIBreachService] Checking specific KPI for breach');

    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        series: {
          orderBy: {
            periodEnd: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!kpi) {
      this.logger.warn({ kpiId }, '[KPIBreachService] KPI not found');
      return null;
    }

    // Allow checking both ACTIVE and BREACHED KPIs
    if (kpi.status !== KPIStatus.ACTIVE && kpi.status !== KPIStatus.BREACHED) {
      this.logger.debug({ kpiId, status: kpi.status }, '[KPIBreachService] KPI is not active or breached');
      return null;
    }

    if (kpi.series.length === 0) {
      this.logger.debug({ kpiId }, '[KPIBreachService] No series data available');
      return null;
    }

    const latestSeries = kpi.series[0];
    const currentValue = Number(latestSeries.actualValue);
    const targetValue = Number(kpi.targetValue);
    const thresholdWarning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
    const thresholdCritical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

    const deviation = ((currentValue - targetValue) / targetValue) * 100;

    // Check for critical breach
    if (thresholdCritical !== null && Math.abs(currentValue - targetValue) >= Math.abs(thresholdCritical - targetValue)) {
      return {
        kpiId: kpi.id,
        kpiCode: kpi.code,
        kpiName: kpi.name,
        currentValue,
        targetValue,
        thresholdWarning,
        thresholdCritical,
        breachType: 'CRITICAL',
        deviation,
        stewardId: kpi.stewardId,
        linkedProjectIds: kpi.linkedProjectIds,
      };
    }

    // Check for warning breach
    if (thresholdWarning !== null && Math.abs(currentValue - targetValue) >= Math.abs(thresholdWarning - targetValue)) {
      return {
        kpiId: kpi.id,
        kpiCode: kpi.code,
        kpiName: kpi.name,
        currentValue,
        targetValue,
        thresholdWarning,
        thresholdCritical,
        breachType: 'WARNING',
        deviation,
        stewardId: kpi.stewardId,
        linkedProjectIds: kpi.linkedProjectIds,
      };
    }

    return null;
  }

  /**
   * Manually trigger corrective action for a specific KPI
   */
  async triggerCorrectiveAction(kpiId: string): Promise<CorrectiveTaskResult | null> {
    this.logger.info({ kpiId }, '[KPIBreachService] Manual corrective action triggered');

    const breach = await this.checkKPIBreach(kpiId);

    if (!breach) {
      this.logger.info({ kpiId }, '[KPIBreachService] No breach detected for this KPI');
      return null;
    }

    return this.createCorrectiveTask(breach);
  }
}

// Singleton instance
let kpiBreachServiceInstance: KPIBreachService | null = null;

export function getKPIBreachService(): KPIBreachService {
  if (!kpiBreachServiceInstance) {
    kpiBreachServiceInstance = new KPIBreachService();
  }
  return kpiBreachServiceInstance;
}
