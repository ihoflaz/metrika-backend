import type { Request, Response } from 'express';
import type { ReportService } from '../../../modules/reports/report.service';
import { excelExportService } from '../../../modules/reports/excel-export.service';
import { pdfExportService } from '../../../modules/reports/pdf-export.service';

export class ReportsController {
  constructor(private readonly reportService: ReportService) {}

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
        owner: { select: { fullName: true } },
        tasks: { select: { status: true } },
      },
    });

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
        overdueTasks: 0, // TODO: Calculate from tasks
        totalBudget: summary.budgetSummary.totalPlanned,
        spentBudget: 0, // TODO: Calculate from actuals
      },
      projects: projects.map((p: any) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        progress: p.progress || 0,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        owner: p.owner?.fullName || 'Unassigned',
        tasksTotal: p.tasks.length,
        tasksCompleted: p.tasks.filter((t: any) => t.status === 'COMPLETED').length,
        healthScore: 0, // TODO: Calculate health score
      })),
      risks: [], // TODO: Fetch risks if needed
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

    const excelData = {
      statusDistribution: [
        { status: 'DRAFT', count: statusDist.draft, percentage: (statusDist.draft / total) * 100 },
        { status: 'PLANNED', count: statusDist.planned, percentage: (statusDist.planned / total) * 100 },
        { status: 'IN_PROGRESS', count: statusDist.inProgress, percentage: (statusDist.inProgress / total) * 100 },
        { status: 'BLOCKED', count: statusDist.blocked, percentage: (statusDist.blocked / total) * 100 },
        { status: 'ON_HOLD', count: statusDist.onHold, percentage: (statusDist.onHold / total) * 100 },
        { status: 'COMPLETED', count: statusDist.completed, percentage: (statusDist.completed / total) * 100 },
        { status: 'CANCELLED', count: statusDist.cancelled, percentage: (statusDist.cancelled / total) * 100 },
      ],
      assigneePerformance: [], // TODO: Calculate assignee performance
      overallStats: {
        totalTasks: metrics.totalTasks,
        completedTasks: statusDist.completed,
        inProgressTasks: statusDist.inProgress,
        overdueTasks: 0, // TODO: Calculate overdue
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
        owner: { select: { fullName: true } },
        tasks: { select: { status: true } },
      },
    });

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
        overdueTasks: 0,
        totalBudget: summary.budgetSummary.totalPlanned,
        spentBudget: 0,
      },
      projects: projects.map((p: any) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        progress: p.progress || 0,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        owner: p.owner?.fullName || 'Unassigned',
        tasksTotal: p.tasks.length,
        tasksCompleted: p.tasks.filter((t: any) => t.status === 'COMPLETED').length,
      })),
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
