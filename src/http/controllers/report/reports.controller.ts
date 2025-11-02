import type { Request, Response } from 'express';
import type { ReportService } from '../../../modules/reports/report.service';

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
}
