import { PrismaClient } from '@prisma/client';
import type { Logger } from '../../lib/logger';
import { ExcelExportService } from './excel-export.service';
import { PDFExportService } from './pdf-export.service';
import { portfolioSummaryTemplate } from './templates/portfolio-summary.template';
import { ExportResult, ExportType, ExportFormat } from './export.types';

/**
 * Portfolio Export Service
 * 
 * Specialized service for exporting portfolio-level summaries
 * Provides high-level overview of all projects accessible by a user
 */
export class PortfolioExportService {
  private excelService: ExcelExportService;
  private pdfService: PDFExportService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger
  ) {
    this.excelService = new ExcelExportService(logger);
    this.pdfService = new PDFExportService(logger);
  }

  /**
   * Export Portfolio Summary to Excel
   * 
   * Generates comprehensive Excel report with:
   * - Overall statistics (projects, tasks, completion rates)
   * - Budget overview (planned, spent, remaining)
   * - KPI performance summary
   * - Detailed project listing
   * 
   * @param userId - User ID for permission filtering
   * @returns Export result with Excel buffer
   */
  async exportPortfolioSummary(userId: string): Promise<ExportResult> {
    try {
      this.logger.info({ userId }, '[PortfolioExportService] Exporting portfolio summary');

      // Fetch all projects accessible by user with related data
      const projects = await this.prisma.project.findMany({
        where: {
          OR: [
            { sponsorId: userId },
            { pmoOwnerId: userId },
            { members: { some: { userId } } },
          ],
        },
        include: {
          sponsor: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          pmoOwner: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          tasks: {
            select: {
              id: true,
              status: true,
              priority: true,
            },
          },
        },
      });

      // Fetch KPIs linked to these projects
      const projectIds = projects.map((p) => p.id);
      const kpis = projectIds.length > 0
        ? await this.prisma.kPIDefinition.findMany({
            where: {
              linkedProjectIds: {
                hasSome: projectIds,
              },
            },
            select: {
              id: true,
              name: true,
              targetValue: true,
              status: true,
              series: {
                select: {
                  actualValue: true,
                  periodEnd: true,
                },
                orderBy: {
                  periodEnd: 'desc',
                },
                take: 1,
              },
            },
          })
        : [];

      // Calculate portfolio statistics
      const stats = this.calculatePortfolioStats(projects, kpis);

      // Create Excel workbook
      const workbook = this.excelService.createWorkbook({
        creator: 'Metrika PMO System',
        created: new Date(),
        properties: {
          title: 'Portfolio Summary Report',
          subject: 'Project Portfolio Overview',
          keywords: 'portfolio, projects, summary, KPI',
          category: 'Reports',
          description: 'Comprehensive overview of project portfolio including statistics, budget, and KPI performance',
        },
      });

      // Add Summary Sheet
      this.addSummarySheet(workbook, stats);

      // Add Projects Detail Sheet
      this.addProjectsDetailSheet(workbook, projects);

      // Generate export result
      const result = await this.excelService.createExportResult(
        workbook,
        ExportType.PORTFOLIO_SUMMARY,
        `portfolio-summary-${new Date().toISOString().split('T')[0]}`
      );

      this.logger.info(
        { userId, fileSize: result.size },
        '[PortfolioExportService] Portfolio summary exported successfully'
      );

      return result;
    } catch (error) {
      this.logger.error(
        { error, userId },
        '[PortfolioExportService] Failed to export portfolio summary'
      );

      return {
        success: false,
        format: 'excel' as any,
        type: ExportType.PORTFOLIO_SUMMARY,
        fileName: 'portfolio-summary-error.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Export Portfolio Summary to PDF
   * 
   * Generates a professional PDF report with:
   * - Portfolio statistics (projects, tasks, KPIs)
   * - Budget overview with utilization metrics
   * - Project listing with progress indicators
   * 
   * @param userId - User ID for permission filtering
   * @returns Export result with PDF buffer
   */
  async exportPortfolioSummaryPDF(userId: string): Promise<ExportResult> {
    try {
      this.logger.info({ userId }, '[PortfolioExportService] Exporting portfolio summary PDF');

      // Fetch all projects accessible by user with related data
      const projects = await this.prisma.project.findMany({
        where: {
          OR: [
            { sponsorId: userId },
            { pmoOwnerId: userId },
            { members: { some: { userId } } },
          ],
        },
        include: {
          sponsor: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          pmoOwner: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          tasks: {
            select: {
              id: true,
              status: true,
              priority: true,
            },
          },
        },
      });

      // Fetch KPIs linked to these projects
      const projectIds = projects.map((p) => p.id);
      const kpis = projectIds.length > 0
        ? await this.prisma.kPIDefinition.findMany({
            where: {
              linkedProjectIds: {
                hasSome: projectIds,
              },
            },
            select: {
              id: true,
              name: true,
              targetValue: true,
              status: true,
              series: {
                select: {
                  actualValue: true,
                  periodEnd: true,
                },
                orderBy: {
                  periodEnd: 'desc',
                },
                take: 1,
              },
            },
          })
        : [];

      // Calculate portfolio statistics
      const stats = this.calculatePortfolioStats(projects, kpis);

      // Get current user info for metadata
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, email: true },
      });

      // Prepare data for PDF template
      const portfolioData = {
        totalProjects: stats.totalProjects,
        activeProjects: stats.activeProjects,
        completedProjects: stats.completedProjects,
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks,
        taskCompletionRate: Math.round(stats.taskCompletionRate * 10) / 10,
        totalBudget: Number(stats.totalPlannedBudget),
        spentBudget: Number(stats.totalSpentBudget),
        budgetUtilization: Math.round(stats.budgetUtilizationRate * 10) / 10,
        totalKPIs: stats.totalKpis,
        activeKPIs: stats.onTrackKpis + stats.atRiskKpis,
        kpiPerformanceRate: stats.totalKpis > 0 
          ? Math.round((stats.onTrackKpis / stats.totalKpis) * 1000) / 10 
          : 0,
        projects: projects.map((project) => ({
          code: project.code || 'N/A',
          name: project.name,
          status: project.status,
          taskCount: project.tasks.length,
          completedTaskCount: project.tasks.filter((t: any) => t.status === 'COMPLETED').length,
          budget: project.budgetPlanned ? Number(project.budgetPlanned) : undefined,
        })),
        generatedAt: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        generatedBy: currentUser?.fullName || 'System',
      };

      // Generate HTML from template
      const htmlContent = portfolioSummaryTemplate(portfolioData);

      // Generate PDF
      const pdfBuffer = await this.pdfService.generatePDFFromHTML(htmlContent, {
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px',
        },
      });

      const fileName = `portfolio-summary-${new Date().toISOString().split('T')[0]}.pdf`;

      this.logger.info(
        { userId, fileSize: pdfBuffer.length },
        '[PortfolioExportService] Portfolio summary PDF exported successfully'
      );

      return {
        success: true,
        format: ExportFormat.PDF,
        type: ExportType.PORTFOLIO_SUMMARY,
        buffer: pdfBuffer,
        fileName,
        mimeType: 'application/pdf',
        size: pdfBuffer.length,
      };
    } catch (error) {
      this.logger.error(
        { error, userId },
        '[PortfolioExportService] Failed to export portfolio summary PDF'
      );
      return {
        success: false,
        format: ExportFormat.PDF,
        type: ExportType.PORTFOLIO_SUMMARY,
        fileName: 'portfolio-summary-error.pdf',
        mimeType: 'application/pdf',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Add Portfolio Summary sheet with statistics
   */
  private addSummarySheet(workbook: any, stats: PortfolioStats): void {
    const worksheet = workbook.addWorksheet('Portfolio Summary');

    // Title row
    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'PROJECT PORTFOLIO SUMMARY';
    titleCell.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 35;

    // Generation date
    worksheet.addRow([]);
    const dateRow = worksheet.addRow(['Generated:', new Date().toLocaleString()]);
    dateRow.getCell(1).font = { bold: true };
    dateRow.getCell(2).font = { italic: true };

    // Overall Statistics Section
    this.excelService.addSummarySection(worksheet, 'OVERALL STATISTICS', [
      { label: 'Total Projects', value: stats.totalProjects },
      { label: 'Active Projects', value: stats.activeProjects },
      { label: 'Completed Projects', value: stats.completedProjects },
      { label: 'Cancelled Projects', value: stats.cancelledProjects },
      { label: 'Total Tasks', value: stats.totalTasks },
      { label: 'Completed Tasks', value: stats.completedTasks },
      { label: 'Task Completion Rate', value: stats.taskCompletionRate, format: '0.0"%"' },
    ]);

    // Budget Section
    this.excelService.addSummarySection(worksheet, 'BUDGET OVERVIEW', [
      { label: 'Total Planned Budget', value: stats.totalPlannedBudget, format: '$#,##0.00' },
      { label: 'Total Spent Budget', value: stats.totalSpentBudget, format: '$#,##0.00' },
      { label: 'Total Remaining Budget', value: stats.totalRemainingBudget, format: '$#,##0.00' },
      { label: 'Budget Utilization Rate', value: stats.budgetUtilizationRate, format: '0.0"%"' },
    ]);

    // KPI Performance Section
    this.excelService.addSummarySection(worksheet, 'KPI PERFORMANCE', [
      { label: 'Total KPIs', value: stats.totalKpis },
      { label: 'On Track KPIs', value: stats.onTrackKpis },
      { label: 'At Risk KPIs', value: stats.atRiskKpis },
      { label: 'Critical KPIs', value: stats.criticalKpis },
      { label: 'Breached KPIs', value: stats.breachedKpis },
    ]);

    // Column widths
    worksheet.getColumn(1).width = 30;
    worksheet.getColumn(2).width = 20;
  }

  /**
   * Add Projects Detail sheet with full project listing
   */
  private addProjectsDetailSheet(workbook: any, projects: any[]): void {
    const projectsData = projects.map((project) => ({
      code: project.code || 'N/A',
      name: project.name,
      status: project.status,
      sponsor: project.sponsor.fullName,
      pmoOwner: project.pmoOwner?.fullName || 'N/A',
      startDate: project.startDate || null,
      endDate: project.endDate || null,
      budget: project.budgetPlanned ? Number(project.budgetPlanned) : 0,
      tasks: project.tasks.length,
      completedTasks: project.tasks.filter((t: any) => t.status === 'COMPLETED').length,
    }));

    this.excelService.addWorksheet(workbook, {
      name: 'Projects Detail',
      data: projectsData,
      columns: [
        { header: 'Project Code', key: 'code', width: 15 },
        { header: 'Project Name', key: 'name', width: 30 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Sponsor', key: 'sponsor', width: 25 },
        { header: 'PMO Owner', key: 'pmoOwner', width: 25 },
        { header: 'Start Date', key: 'startDate', width: 15, format: 'dd/mm/yyyy' },
        { header: 'End Date', key: 'endDate', width: 15, format: 'dd/mm/yyyy' },
        { header: 'Budget', key: 'budget', width: 15, format: '$#,##0.00' },
        { header: 'Total Tasks', key: 'tasks', width: 12 },
        { header: 'Completed', key: 'completedTasks', width: 12 },
      ],
      autoFilter: true,
      freezePane: { row: 1, col: 0 },
      styling: {
        evenRowStyle: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F5F5' },
          },
        },
      },
    });
  }

  /**
   * Calculate portfolio statistics from projects
   */
  private calculatePortfolioStats(projects: any[], kpis: any[]): PortfolioStats {
    const stats: PortfolioStats = {
      totalProjects: projects.length,
      activeProjects: 0,
      completedProjects: 0,
      cancelledProjects: 0,
      totalTasks: 0,
      completedTasks: 0,
      taskCompletionRate: 0,
      totalPlannedBudget: 0,
      totalSpentBudget: 0,
      totalRemainingBudget: 0,
      budgetUtilizationRate: 0,
      totalKpis: kpis.length,
      onTrackKpis: 0,
      atRiskKpis: 0,
      criticalKpis: 0,
      breachedKpis: 0,
    };

    projects.forEach((project) => {
      // Project status counts
      if (project.status === 'ACTIVE') stats.activeProjects++;
      if (project.status === 'COMPLETED') stats.completedProjects++;
      if (project.status === 'CANCELLED') stats.cancelledProjects++;

      // Task statistics
      stats.totalTasks += project.tasks.length;
      stats.completedTasks += project.tasks.filter((t: any) => t.status === 'COMPLETED').length;

      // Budget statistics
      if (project.budgetPlanned) {
        stats.totalPlannedBudget += Number(project.budgetPlanned);
      }
      // Note: spentBudget would come from actual expense tracking (future feature)
    });

    // KPI statistics
    kpis.forEach((kpi: any) => {
      if (kpi.status === 'ACTIVE' || kpi.status === 'MONITORING') {
        // Get latest actual value from series
        const currentValue = kpi.series[0]?.actualValue || 0;
        
        // Check if on track (within 10% of target)
        const variance = Math.abs(Number(currentValue) - Number(kpi.targetValue));
        const variancePercent = Number(kpi.targetValue) > 0 
          ? (variance / Number(kpi.targetValue)) * 100 
          : 0;

        if (variancePercent <= 10) {
          stats.onTrackKpis++;
        } else if (variancePercent <= 25) {
          stats.atRiskKpis++;
        } else {
          stats.criticalKpis++;
        }
      }
      if (kpi.status === 'BREACHED') {
        stats.breachedKpis++;
      }
    });

    // Calculate rates
    stats.taskCompletionRate = stats.totalTasks > 0
      ? (stats.completedTasks / stats.totalTasks) * 100
      : 0;

    stats.totalRemainingBudget = stats.totalPlannedBudget - stats.totalSpentBudget;
    stats.budgetUtilizationRate = stats.totalPlannedBudget > 0
      ? (stats.totalSpentBudget / stats.totalPlannedBudget) * 100
      : 0;

    return stats;
  }
}

/**
 * Portfolio statistics interface
 */
interface PortfolioStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  cancelledProjects: number;
  totalTasks: number;
  completedTasks: number;
  taskCompletionRate: number;
  totalPlannedBudget: number;
  totalSpentBudget: number;
  totalRemainingBudget: number;
  budgetUtilizationRate: number;
  totalKpis: number;
  onTrackKpis: number;
  atRiskKpis: number;
  criticalKpis: number;
  breachedKpis: number;
}
