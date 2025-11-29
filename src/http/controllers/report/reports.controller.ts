import type { Request, Response } from 'express';
import type { ReportService } from '../../../modules/reports/report.service';
import { excelExportService } from '../../../modules/reports/excel-export.service';
import { pdfExportService } from '../../../modules/reports/pdf-export.service';

export class ReportsController {
  constructor(private readonly reportService: ReportService) { }

  getPortfolioSummary = async (_req: Request, res: Response) => {
    const summary = await this.reportService.getPortfolioSummary();

    res.status(200).json({
      data: {
        type: 'portfolio-summary',
        id: 'current',
        attributes: summary,
      },
    });
  };

  getKPIDashboard = async (_req: Request, res: Response) => {
    const dashboard = await this.reportService.getKPIDashboard();

    res.status(200).json({
      data: {
        type: 'kpi-dashboard',
        id: 'current',
        attributes: dashboard,
      },
    });
  };

  getTaskMetrics = async (req: Request, res: Response) => {
    const { projectId } = req.query;

    const metrics = await this.reportService.getTaskMetrics(
      projectId ? String(projectId) : undefined,
    );

    res.status(200).json({
      data: {
        type: 'task-metrics',
        id: projectId || 'all',
        attributes: metrics,
      },
    });
  };

  // ===== EXCEL EXPORT ENDPOINTS =====

  exportPortfolioSummary = async (_req: Request, res: Response) => {
    const summary = await this.reportService.getPortfolioSummary();

    // Get all projects for detailed export
    const projects = await (this.reportService as any).prisma.project.findMany({
      include: {
        sponsor: { select: { fullName: true } },
        pmoOwner: { select: { fullName: true } },
        tasks: { select: { status: true, plannedEnd: true, effortLoggedHours: true } },
      },
    });

    const buildProjectOverview = (p: any) => {
      const totalTasks = p.tasks.length;
      const completedTasks = p.tasks.filter((t: any) => t.status === 'COMPLETED').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const ownerName = p.pmoOwner?.fullName ?? p.sponsor?.fullName ?? 'Unassigned';

      // Health score from DB or calculate if missing
      const healthScore = p.healthScore ? Number(p.healthScore) : 0;

      return {
        code: p.code,
        name: p.name,
        status: p.status,
        progress,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        owner: ownerName,
        tasksTotal: totalTasks,
        tasksCompleted: completedTasks,
        healthScore,
      };
    };

    // Calculate aggregate stats
    const allTasks = projects.flatMap((p: any) => p.tasks);
    const overdueTasksCount = allTasks.filter((t: any) => {
      if (t.status === 'COMPLETED' || !t.plannedEnd) return false;
      return new Date() > new Date(t.plannedEnd);
    }).length;

    // Calculate spent budget (using effortLoggedHours as proxy for now, assuming 1h = 1 unit of budget if not specified)
    const totalSpentBudget = projects.reduce((sum: number, p: any) => {
      const projectSpent = p.tasks.reduce((tSum: number, t: any) => tSum + (Number(t.effortLoggedHours) || 0), 0);
      return sum + projectSpent;
    }, 0);

    // Transform data for Excel export
    const excelData = {
      summary: {
        totalProjects: summary.totalProjects,
        activeProjects: summary.statusDistribution.active,
        completedProjects: summary.statusDistribution.closed,
        totalTasks: projects.reduce((sum: number, p: any) => sum + p.tasks.length, 0),
        completedTasks: projects.reduce(
          (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'COMPLETED').length,
          0,
        ),
        overdueTasks: overdueTasksCount,
        totalBudget: summary.budgetSummary.totalPlanned,
        spentBudget: totalSpentBudget,
      },
      projects: projects.map(buildProjectOverview),
      risks: [],
    };

    const buffer = await excelExportService.exportPortfolioSummary(excelData);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="portfolio-summary-${Date.now()}.xlsx"`);
    res.send(buffer);
  };

  exportKPIDashboard = async (_req: Request, res: Response) => {
    const dashboard = await this.reportService.getKPIDashboard();

    // Get all active KPIs with latest data
    const kpis = await (this.reportService as any).prisma.kPIDefinition.findMany({
      where: { status: 'ACTIVE' },
      include: {
        series: {
          orderBy: { periodStart: 'desc' },
          take: 1,
        },
      },
    });

    // Transform data for Excel export
    const excelData = {
      kpis: kpis.map((kpi: any) => ({
        name: kpi.name,
        category: kpi.category,
        currentValue: kpi.series[0]?.actualValue || 0,
        targetValue: Number(kpi.targetValue),
        unit: kpi.unit,
        status: kpi.status,
        trend: kpi.series.length > 1 ? 'STABLE' : 'N/A',
        lastUpdated: kpi.series[0]?.collectedAt || new Date(),
      })),
    };

    const buffer = await excelExportService.exportKPIDashboard(excelData);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="kpi-dashboard-${Date.now()}.xlsx"`);
    res.send(buffer);
  };

  exportTaskMetrics = async (req: Request, res: Response) => {
    const { projectId } = req.query;

    const metrics = await this.reportService.getTaskMetrics(
      projectId ? String(projectId) : undefined,
    );

    // Transform data for Excel export
    const statusDist = metrics.statusDistribution;
    const total = metrics.totalTasks;

    // Calculate assignee performance
    const tasks = await (this.reportService as any).prisma.task.findMany({
      where: projectId ? { projectId } : {},
      include: { owner: true },
    });

    const assigneeStats = new Map<string, { name: string; total: number; completed: number }>();
    let overdueCount = 0;
    const now = new Date();

    tasks.forEach((t: any) => {
      // Overdue check
      if (t.status !== 'COMPLETED' && t.plannedEnd && new Date(t.plannedEnd) < now) {
        overdueCount++;
      }

      // Assignee stats
      const ownerId = t.ownerId;
      if (!assigneeStats.has(ownerId)) {
        assigneeStats.set(ownerId, { name: t.owner.fullName, total: 0, completed: 0 });
      }
      const stats = assigneeStats.get(ownerId)!;
      stats.total++;
      if (t.status === 'COMPLETED') {
        stats.completed++;
      }
    });

    const assigneePerformance = Array.from(assigneeStats.values()).map(s => ({
      assignee: s.name,
      totalTasks: s.total,
      completedTasks: s.completed,
      completionRate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
      averageCompletionTime: 0, // Not calculated yet
    }));

    const excelData = {
      statusDistribution: [
        { status: 'DRAFT', count: statusDist.draft, percentage: total > 0 ? (statusDist.draft / total) * 100 : 0 },
        { status: 'PLANNED', count: statusDist.planned, percentage: total > 0 ? (statusDist.planned / total) * 100 : 0 },
        { status: 'IN_PROGRESS', count: statusDist.inProgress, percentage: total > 0 ? (statusDist.inProgress / total) * 100 : 0 },
        { status: 'BLOCKED', count: statusDist.blocked, percentage: total > 0 ? (statusDist.blocked / total) * 100 : 0 },
        { status: 'ON_HOLD', count: statusDist.onHold, percentage: total > 0 ? (statusDist.onHold / total) * 100 : 0 },
        { status: 'COMPLETED', count: statusDist.completed, percentage: total > 0 ? (statusDist.completed / total) * 100 : 0 },
        { status: 'CANCELLED', count: statusDist.cancelled, percentage: total > 0 ? (statusDist.cancelled / total) * 100 : 0 },
      ],
      assigneePerformance,
      overallStats: {
        totalTasks: metrics.totalTasks,
        completedTasks: statusDist.completed,
        inProgressTasks: statusDist.inProgress,
        overdueTasks: overdueCount,
        completionRate: metrics.completionMetrics.completionRate,
      },
    };

    const buffer = await excelExportService.exportTaskMetrics(excelData);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="task-metrics-${Date.now()}.xlsx"`);
    res.send(buffer);
  };

  // ===== PDF EXPORT ENDPOINTS =====

  exportPortfolioSummaryPDF = async (_req: Request, res: Response) => {
    const summary = await this.reportService.getPortfolioSummary();

    // Get all projects for detailed export
    const projects = await (this.reportService as any).prisma.project.findMany({
      include: {
        sponsor: { select: { fullName: true } },
        pmoOwner: { select: { fullName: true } },
        tasks: { select: { status: true, plannedEnd: true, effortLoggedHours: true } },
      },
    });

    // Calculate aggregate stats for PDF
    const allTasks = projects.flatMap((p: any) => p.tasks);
    const overdueTasksCount = allTasks.filter((t: any) => {
      if (t.status === 'COMPLETED' || !t.plannedEnd) return false;
      return new Date() > new Date(t.plannedEnd);
    }).length;

    const totalSpentBudget = projects.reduce((sum: number, p: any) => {
      const projectSpent = p.tasks.reduce((tSum: number, t: any) => tSum + (Number(t.effortLoggedHours) || 0), 0);
      return sum + projectSpent;
    }, 0);

    // Transform data for PDF export
    const pdfData = {
      summary: {
        totalProjects: summary.totalProjects,
        activeProjects: summary.statusDistribution.active,
        completedProjects: summary.statusDistribution.closed,
        totalTasks: projects.reduce((sum: number, p: any) => sum + p.tasks.length, 0),
        completedTasks: projects.reduce(
          (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'COMPLETED').length,
          0,
        ),
        overdueTasks: overdueTasksCount,
        totalBudget: summary.budgetSummary.totalPlanned,
        spentBudget: totalSpentBudget,
      },
      projects: projects.map((p: any) => {
        const totalTasks = p.tasks.length;
        const completedTasks = p.tasks.filter((t: any) => t.status === 'COMPLETED').length;
        const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const ownerName = p.pmoOwner?.fullName ?? p.sponsor?.fullName ?? 'Unassigned';

        return {
          code: p.code,
          name: p.name,
          status: p.status,
          progress,
          startDate: p.startDate ? new Date(p.startDate) : null,
          endDate: p.endDate ? new Date(p.endDate) : null,
          owner: ownerName,
          tasksTotal: totalTasks,
          tasksCompleted: completedTasks,
        };
      }),
    };

    const buffer = await pdfExportService.exportPortfolioSummary(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="portfolio-summary-${Date.now()}.pdf"`);
    res.send(buffer);
  };

  exportKPIDashboardPDF = async (_req: Request, res: Response) => {
    // Get all active KPIs with latest data
    const kpis = await (this.reportService as any).prisma.kPIDefinition.findMany({
      where: { status: 'ACTIVE' },
      include: {
        series: {
          orderBy: { periodStart: 'desc' },
          take: 1,
        },
      },
    });

    // Transform data for PDF export
    const pdfData = {
      kpis: kpis.map((kpi: any) => ({
        name: kpi.name,
        category: kpi.category,
        currentValue: kpi.series[0]?.actualValue || 0,
        targetValue: Number(kpi.targetValue),
        unit: kpi.unit,
        status: kpi.status,
        trend: 'STABLE',
        lastUpdated: kpi.series[0]?.collectedAt || new Date(),
      })),
    };

    const buffer = await pdfExportService.exportKPIDashboard(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kpi-dashboard-${Date.now()}.pdf"`);
    res.send(buffer);
  };
}
