import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../../lib/logger';

export interface PortfolioSummary {
  totalProjects: number;
  statusDistribution: {
    planning: number;
    active: number;
    onHold: number;
    closed: number;
    cancelled: number;
  };
  budgetSummary: {
    totalPlanned: number;
    averagePlanned: number;
    projectsWithBudget: number;
  };
  healthMetrics: {
    onTrack: number;
    atRisk: number;
    delayed: number;
  };
  timeline: {
    notStarted: number;
    ongoing: number;
    completed: number;
  };
}

export interface KPIDashboard {
  totalKPIs: number;
  statusDistribution: {
    proposed: number;
    underReview: number;
    active: number;
    monitoring: number;
    breached: number;
    retired: number;
  };
  categoryDistribution: Record<string, number>;
  thresholdSummary: {
    normal: number;
    warning: number;
    critical: number;
    noData: number;
  };
  recentBreaches: Array<{
    kpiId: string;
    kpiName: string;
    level: 'WARNING' | 'CRITICAL';
    deviation: number;
    timestamp: Date;
  }>;
}

export interface TaskMetrics {
  totalTasks: number;
  statusDistribution: {
    draft: number;
    planned: number;
    inProgress: number;
    blocked: number;
    onHold: number;
    completed: number;
    cancelled: number;
  };
  priorityDistribution: {
    low: number;
    normal: number;
    high: number;
    critical: number;
  };
  completionMetrics: {
    completionRate: number;
    averageProgress: number;
    tasksOnTime: number;
    tasksDelayed: number;
  };
  effortMetrics: {
    totalPlannedHours: number;
    totalLoggedHours: number;
    utilizationRate: number;
  };
}

export class ReportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async getPortfolioSummary(): Promise<PortfolioSummary> {
    this.logger.info('Generating portfolio summary report');

    // Get all projects with basic aggregations
    const projects = await this.prisma.project.findMany({
      select: {
        id: true,
        status: true,
        budgetPlanned: true,
        startDate: true,
        endDate: true,
        actualStart: true,
        actualEnd: true,
        tasks: {
          select: {
            status: true,
            plannedEnd: true,
            actualEnd: true,
          },
        },
      },
    });

    const totalProjects = projects.length;

    // Status distribution
    const statusDistribution = {
      planning: 0,
      active: 0,
      onHold: 0,
      closed: 0,
      cancelled: 0,
    };

    projects.forEach((project) => {
      if (project.status === 'PLANNING') statusDistribution.planning++;
      else if (project.status === 'ACTIVE') statusDistribution.active++;
      else if (project.status === 'ON_HOLD') statusDistribution.onHold++;
      else if (project.status === 'CLOSED') statusDistribution.closed++;
      else if (project.status === 'CANCELLED') statusDistribution.cancelled++;
    });

    // Budget summary
    const projectsWithBudget = projects.filter((p) => p.budgetPlanned !== null);
    const totalPlanned = projectsWithBudget.reduce(
      (sum, p) => sum + Number(p.budgetPlanned || 0),
      0,
    );
    const averagePlanned = projectsWithBudget.length > 0 ? totalPlanned / projectsWithBudget.length : 0;

    // Health metrics (simple heuristic based on task completion)
    let onTrack = 0;
    let atRisk = 0;
    let delayed = 0;

    projects.forEach((project) => {
      if (project.status === 'CLOSED' || project.status === 'CANCELLED') {
        onTrack++; // Completed projects are "on track"
        return;
      }

      const tasks = project.tasks;
      if (tasks.length === 0) {
        onTrack++; // No tasks = assume on track
        return;
      }

      const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
      const delayedTasks = tasks.filter(
        (t) =>
          (t.status === 'PLANNED' || t.status === 'IN_PROGRESS') &&
          t.plannedEnd &&
          new Date(t.plannedEnd) < new Date(),
      ).length;

      const completionRate = completedTasks / tasks.length;
      const delayRate = delayedTasks / tasks.length;

      if (delayRate > 0.3) {
        delayed++;
      } else if (delayRate > 0.1 || completionRate < 0.5) {
        atRisk++;
      } else {
        onTrack++;
      }
    });

    // Timeline
    const now = new Date();
    let notStarted = 0;
    let ongoing = 0;
    let completed = 0;

    projects.forEach((project) => {
      if (project.status === 'CLOSED' || project.status === 'CANCELLED') {
        completed++;
      } else if (!project.actualStart) {
        notStarted++;
      } else {
        ongoing++;
      }
    });

    return {
      totalProjects,
      statusDistribution,
      budgetSummary: {
        totalPlanned,
        averagePlanned,
        projectsWithBudget: projectsWithBudget.length,
      },
      healthMetrics: {
        onTrack,
        atRisk,
        delayed,
      },
      timeline: {
        notStarted,
        ongoing,
        completed,
      },
    };
  }

  async getKPIDashboard(): Promise<KPIDashboard> {
    this.logger.info('Generating KPI dashboard');

    // Get all KPIs with latest data
    const kpis = await this.prisma.kPIDefinition.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        targetValue: true,
        thresholdWarning: true,
        thresholdCritical: true,
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1,
          select: {
            actualValue: true,
            periodEnd: true,
          },
        },
      },
    });

    const totalKPIs = kpis.length;

    // Status distribution
    const statusDistribution = {
      proposed: 0,
      underReview: 0,
      active: 0,
      monitoring: 0,
      breached: 0,
      retired: 0,
    };

    kpis.forEach((kpi) => {
      if (kpi.status === 'PROPOSED') statusDistribution.proposed++;
      else if (kpi.status === 'UNDER_REVIEW') statusDistribution.underReview++;
      else if (kpi.status === 'ACTIVE') statusDistribution.active++;
      else if (kpi.status === 'MONITORING') statusDistribution.monitoring++;
      else if (kpi.status === 'BREACHED') statusDistribution.breached++;
      else if (kpi.status === 'RETIRED') statusDistribution.retired++;
    });

    // Category distribution
    const categoryDistribution: Record<string, number> = {};
    kpis.forEach((kpi) => {
      categoryDistribution[kpi.category] = (categoryDistribution[kpi.category] || 0) + 1;
    });

    // Threshold summary and recent breaches
    const thresholdSummary = {
      normal: 0,
      warning: 0,
      critical: 0,
      noData: 0,
    };

    const recentBreaches: Array<{
      kpiId: string;
      kpiName: string;
      level: 'WARNING' | 'CRITICAL';
      deviation: number;
      timestamp: Date;
    }> = [];

    kpis.forEach((kpi) => {
      if (kpi.series.length === 0) {
        thresholdSummary.noData++;
        return;
      }

      const latestData = kpi.series[0];
      const actualValue = Number(latestData.actualValue);
      const target = Number(kpi.targetValue);
      const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
      const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

      const warningThreshold = warning !== null ? target * (1 + warning / 100) : null;
      const criticalThreshold = critical !== null ? target * (1 + critical / 100) : null;

      const deviation = ((actualValue - target) / target) * 100;

      if (criticalThreshold !== null && actualValue >= criticalThreshold) {
        thresholdSummary.critical++;
        recentBreaches.push({
          kpiId: kpi.id,
          kpiName: kpi.name,
          level: 'CRITICAL',
          deviation,
          timestamp: latestData.periodEnd,
        });
      } else if (warningThreshold !== null && actualValue >= warningThreshold) {
        thresholdSummary.warning++;
        recentBreaches.push({
          kpiId: kpi.id,
          kpiName: kpi.name,
          level: 'WARNING',
          deviation,
          timestamp: latestData.periodEnd,
        });
      } else {
        thresholdSummary.normal++;
      }
    });

    // Sort breaches by deviation (worst first) and take top 10
    recentBreaches.sort((a, b) => b.deviation - a.deviation);
    const topBreaches = recentBreaches.slice(0, 10);

    return {
      totalKPIs,
      statusDistribution,
      categoryDistribution,
      thresholdSummary,
      recentBreaches: topBreaches,
    };
  }

  async getTaskMetrics(projectId?: string): Promise<TaskMetrics> {
    if (projectId) {
      this.logger.info({ projectId }, 'Generating task metrics for project');
    } else {
      this.logger.info('Generating task metrics for all projects');
    }

    const whereClause = projectId ? { projectId } : {};

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      select: {
        id: true,
        status: true,
        priority: true,
        progressPct: true,
        effortPlannedHours: true,
        effortLoggedHours: true,
        plannedEnd: true,
        actualEnd: true,
      },
    });

    const totalTasks = tasks.length;

    // Status distribution
    const statusDistribution = {
      draft: 0,
      planned: 0,
      inProgress: 0,
      blocked: 0,
      onHold: 0,
      completed: 0,
      cancelled: 0,
    };

    tasks.forEach((task) => {
      if (task.status === 'DRAFT') statusDistribution.draft++;
      else if (task.status === 'PLANNED') statusDistribution.planned++;
      else if (task.status === 'IN_PROGRESS') statusDistribution.inProgress++;
      else if (task.status === 'BLOCKED') statusDistribution.blocked++;
      else if (task.status === 'ON_HOLD') statusDistribution.onHold++;
      else if (task.status === 'COMPLETED') statusDistribution.completed++;
      else if (task.status === 'CANCELLED') statusDistribution.cancelled++;
    });

    // Priority distribution
    const priorityDistribution = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };

    tasks.forEach((task) => {
      if (task.priority === 'LOW') priorityDistribution.low++;
      else if (task.priority === 'NORMAL') priorityDistribution.normal++;
      else if (task.priority === 'HIGH') priorityDistribution.high++;
      else if (task.priority === 'CRITICAL') priorityDistribution.critical++;
    });

    // Completion metrics
    const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const totalProgress = tasks.reduce((sum, t) => sum + (t.progressPct || 0), 0);
    const averageProgress = totalTasks > 0 ? totalProgress / totalTasks : 0;

    const now = new Date();
    let tasksOnTime = 0;
    let tasksDelayed = 0;

    tasks.forEach((task) => {
      if (task.status === 'COMPLETED') {
        if (task.actualEnd && task.plannedEnd) {
          if (new Date(task.actualEnd) <= new Date(task.plannedEnd)) {
            tasksOnTime++;
          } else {
            tasksDelayed++;
          }
        } else {
          tasksOnTime++; // Assume on time if no dates
        }
      } else if (task.plannedEnd && new Date(task.plannedEnd) < now) {
        tasksDelayed++;
      } else {
        tasksOnTime++;
      }
    });

    // Effort metrics
    const totalPlannedHours = tasks.reduce((sum, t) => sum + Number(t.effortPlannedHours || 0), 0);
    const totalLoggedHours = tasks.reduce((sum, t) => sum + Number(t.effortLoggedHours || 0), 0);
    const utilizationRate =
      totalPlannedHours > 0 ? (totalLoggedHours / totalPlannedHours) * 100 : 0;

    return {
      totalTasks,
      statusDistribution,
      priorityDistribution,
      completionMetrics: {
        completionRate,
        averageProgress,
        tasksOnTime,
        tasksDelayed,
      },
      effortMetrics: {
        totalPlannedHours,
        totalLoggedHours,
        utilizationRate,
      },
    };
  }
}
