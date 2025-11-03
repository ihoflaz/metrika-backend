import ExcelJS from 'exceljs';
import { logger } from '../../lib/logger';
import { format } from 'date-fns';

/**
 * Excel Export Service
 * Provides utilities for generating Excel files with professional formatting
 */
export class ExcelExportService {
  /**
   * Create a new workbook with default styling
   */
  private createWorkbook(): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Metrika PMO System';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.lastModifiedBy = 'Metrika System';
    return workbook;
  }

  /**
   * Apply header styling to a row
   */
  private applyHeaderStyle(row: ExcelJS.Row): void {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }, // Blue header
    };
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.height = 25;
  }

  /**
   * Apply alternating row colors for better readability
   */
  private applyAlternatingRows(worksheet: ExcelJS.Worksheet, startRow: number): void {
    for (let i = startRow; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      if (i % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }, // Light gray
        };
      }
    }
  }

  /**
   * Auto-fit columns based on content
   */
  private autoFitColumns(worksheet: ExcelJS.Worksheet): void {
    worksheet.columns.forEach((column) => {
      if (!column.values) return;
      
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value?.toString() || '';
        maxLength = Math.max(maxLength, cellValue.length);
      });
      
      column.width = Math.min(maxLength + 2, 50); // Max 50 chars
    });
  }

  /**
   * Add borders to a range of cells
   */
  private addBorders(worksheet: ExcelJS.Worksheet, startRow: number, endRow: number, colCount: number): void {
    const borderStyle: Partial<ExcelJS.Border> = {
      style: 'thin',
      color: { argb: 'FFD0D0D0' },
    };

    for (let row = startRow; row <= endRow; row++) {
      for (let col = 1; col <= colCount; col++) {
        const cell = worksheet.getRow(row).getCell(col);
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle,
        };
      }
    }
  }

  /**
   * Export Portfolio Summary to Excel
   * Includes: Summary stats, project list, risk matrix
   */
  async exportPortfolioSummary(data: {
    summary: {
      totalProjects: number;
      activeProjects: number;
      completedProjects: number;
      totalTasks: number;
      completedTasks: number;
      overdueTasks: number;
      totalBudget: number;
      spentBudget: number;
    };
    projects: Array<{
      code: string;
      name: string;
      status: string;
      progress: number;
      startDate: Date;
      endDate: Date;
      owner: string;
      tasksTotal: number;
      tasksCompleted: number;
      healthScore?: number;
    }>;
    risks?: Array<{
      projectCode: string;
      title: string;
      severity: string;
      probability: string;
      status: string;
      mitigation: string;
    }>;
  }): Promise<Buffer> {
    try {
      const workbook = this.createWorkbook();

      // ===== SHEET 1: Summary =====
      const summarySheet = workbook.addWorksheet('Portfolio Summary', {
        views: [{ showGridLines: false }],
      });

      // Title
      summarySheet.mergeCells('A1:D1');
      const titleCell = summarySheet.getCell('A1');
      titleCell.value = 'Portfolio Summary Report';
      titleCell.font = { size: 16, bold: true, color: { argb: 'FF4472C4' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      summarySheet.getRow(1).height = 35;

      // Date
      summarySheet.mergeCells('A2:D2');
      const dateCell = summarySheet.getCell('A2');
      dateCell.value = `Generated: ${format(new Date(), 'PPpp')}`;
      dateCell.alignment = { horizontal: 'center' };
      dateCell.font = { italic: true, color: { argb: 'FF666666' } };

      // Summary metrics (2 columns layout)
      let row = 4;
      const metrics = [
        ['Total Projects', data.summary.totalProjects, 'Active Projects', data.summary.activeProjects],
        ['Completed Projects', data.summary.completedProjects, 'Total Tasks', data.summary.totalTasks],
        ['Completed Tasks', data.summary.completedTasks, 'Overdue Tasks', data.summary.overdueTasks],
        ['Total Budget', `$${data.summary.totalBudget.toLocaleString()}`, 'Spent Budget', `$${data.summary.spentBudget.toLocaleString()}`],
      ];

      metrics.forEach((metric) => {
        const currentRow = summarySheet.getRow(row);
        currentRow.getCell(1).value = metric[0];
        currentRow.getCell(1).font = { bold: true };
        currentRow.getCell(2).value = metric[1];
        currentRow.getCell(2).alignment = { horizontal: 'right' };
        
        currentRow.getCell(3).value = metric[2];
        currentRow.getCell(3).font = { bold: true };
        currentRow.getCell(4).value = metric[3];
        currentRow.getCell(4).alignment = { horizontal: 'right' };
        
        row++;
      });

      summarySheet.columns = [
        { width: 20 },
        { width: 20 },
        { width: 20 },
        { width: 20 },
      ];

      // ===== SHEET 2: Projects =====
      const projectsSheet = workbook.addWorksheet('Projects');

      // Headers
      const headers = ['Code', 'Name', 'Status', 'Progress (%)', 'Start Date', 'End Date', 'Owner', 'Tasks (Completed/Total)', 'Health Score'];
      const headerRow = projectsSheet.addRow(headers);
      this.applyHeaderStyle(headerRow);

      // Data rows
      data.projects.forEach((project) => {
        const dataRow = projectsSheet.addRow([
          project.code,
          project.name,
          project.status,
          project.progress,
          format(project.startDate, 'yyyy-MM-dd'),
          format(project.endDate, 'yyyy-MM-dd'),
          project.owner,
          `${project.tasksCompleted}/${project.tasksTotal}`,
          project.healthScore || 'N/A',
        ]);

        // Progress bar conditional formatting
        const progressCell = dataRow.getCell(4);
        progressCell.numFmt = '0"%"';
        if (project.progress >= 75) {
          progressCell.font = { color: { argb: 'FF00B050' } }; // Green
        } else if (project.progress >= 50) {
          progressCell.font = { color: { argb: 'FFFFC000' } }; // Orange
        } else {
          progressCell.font = { color: { argb: 'FFFF0000' } }; // Red
        }

        // Status color
        const statusCell = dataRow.getCell(3);
        switch (project.status.toUpperCase()) {
          case 'ACTIVE':
          case 'IN_PROGRESS':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
          case 'PLANNING':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
          case 'COMPLETED':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
          case 'ON_HOLD':
          case 'CANCELLED':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
        }
      });

      this.applyAlternatingRows(projectsSheet, 2);
      this.autoFitColumns(projectsSheet);
      this.addBorders(projectsSheet, 1, projectsSheet.rowCount, headers.length);

      // ===== SHEET 3: Risks (if provided) =====
      if (data.risks && data.risks.length > 0) {
        const risksSheet = workbook.addWorksheet('Risks');

        const riskHeaders = ['Project', 'Risk Title', 'Severity', 'Probability', 'Status', 'Mitigation'];
        const riskHeaderRow = risksSheet.addRow(riskHeaders);
        this.applyHeaderStyle(riskHeaderRow);

        data.risks.forEach((risk) => {
          const riskRow = risksSheet.addRow([
            risk.projectCode,
            risk.title,
            risk.severity,
            risk.probability,
            risk.status,
            risk.mitigation,
          ]);

          // Severity color coding
          const severityCell = riskRow.getCell(3);
          switch (risk.severity.toUpperCase()) {
            case 'CRITICAL':
            case 'HIGH':
              severityCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
              severityCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
              break;
            case 'MEDIUM':
              severityCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
              severityCell.font = { color: { argb: 'FFFFFFFF' } };
              break;
            case 'LOW':
              severityCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
              severityCell.font = { color: { argb: 'FFFFFFFF' } };
              break;
          }
        });

        this.applyAlternatingRows(risksSheet, 2);
        this.autoFitColumns(risksSheet);
        this.addBorders(risksSheet, 1, risksSheet.rowCount, riskHeaders.length);
      }

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      logger.info('Portfolio summary Excel file generated successfully');
      return Buffer.from(buffer);
    } catch (error) {
      logger.error({ error }, 'Failed to generate portfolio summary Excel');
      throw new Error('Failed to generate Excel file');
    }
  }

  /**
   * Export KPI Dashboard to Excel
   */
  async exportKPIDashboard(data: {
    kpis: Array<{
      name: string;
      category: string;
      currentValue: number;
      targetValue: number;
      unit: string;
      status: string;
      trend: string;
      lastUpdated: Date;
    }>;
  }): Promise<Buffer> {
    try {
      const workbook = this.createWorkbook();
      const sheet = workbook.addWorksheet('KPI Dashboard');

      // Title
      sheet.mergeCells('A1:H1');
      const titleCell = sheet.getCell('A1');
      titleCell.value = 'KPI Dashboard';
      titleCell.font = { size: 16, bold: true, color: { argb: 'FF4472C4' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 35;

      // Headers
      const headers = ['KPI Name', 'Category', 'Current Value', 'Target Value', 'Unit', 'Status', 'Trend', 'Last Updated'];
      const headerRow = sheet.addRow(headers);
      this.applyHeaderStyle(headerRow);

      // Data rows
      data.kpis.forEach((kpi) => {
        const dataRow = sheet.addRow([
          kpi.name,
          kpi.category,
          kpi.currentValue,
          kpi.targetValue,
          kpi.unit,
          kpi.status,
          kpi.trend,
          format(kpi.lastUpdated, 'yyyy-MM-dd HH:mm'),
        ]);

        // Status conditional formatting
        const statusCell = dataRow.getCell(6);
        switch (kpi.status.toUpperCase()) {
          case 'ON_TRACK':
          case 'ACHIEVED':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
          case 'AT_RISK':
          case 'WARNING':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
          case 'OFF_TRACK':
          case 'CRITICAL':
            statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
            statusCell.font = { color: { argb: 'FFFFFFFF' } };
            break;
        }

        // Trend arrows
        const trendCell = dataRow.getCell(7);
        if (kpi.trend === 'UP') {
          trendCell.value = '↑ ' + kpi.trend;
          trendCell.font = { color: { argb: 'FF00B050' } };
        } else if (kpi.trend === 'DOWN') {
          trendCell.value = '↓ ' + kpi.trend;
          trendCell.font = { color: { argb: 'FFFF0000' } };
        } else {
          trendCell.value = '→ ' + kpi.trend;
          trendCell.font = { color: { argb: 'FF666666' } };
        }
      });

      this.applyAlternatingRows(sheet, 3);
      this.autoFitColumns(sheet);
      this.addBorders(sheet, 2, sheet.rowCount, headers.length);

      const buffer = await workbook.xlsx.writeBuffer();
      logger.info('KPI dashboard Excel file generated successfully');
      return Buffer.from(buffer);
    } catch (error) {
      logger.error({ error }, 'Failed to generate KPI dashboard Excel');
      throw new Error('Failed to generate Excel file');
    }
  }

  /**
   * Export Task Metrics to Excel
   */
  async exportTaskMetrics(data: {
    statusDistribution: Array<{ status: string; count: number; percentage: number }>;
    assigneePerformance: Array<{
      assignee: string;
      totalTasks: number;
      completedTasks: number;
      completionRate: number;
      averageCompletionTime: number;
    }>;
    overallStats: {
      totalTasks: number;
      completedTasks: number;
      inProgressTasks: number;
      overdueTasks: number;
      completionRate: number;
    };
  }): Promise<Buffer> {
    try {
      const workbook = this.createWorkbook();

      // ===== SHEET 1: Overall Stats =====
      const statsSheet = workbook.addWorksheet('Overall Statistics');

      statsSheet.mergeCells('A1:B1');
      const titleCell = statsSheet.getCell('A1');
      titleCell.value = 'Task Metrics Overview';
      titleCell.font = { size: 14, bold: true };
      titleCell.alignment = { horizontal: 'center' };

      const stats = [
        ['Total Tasks', data.overallStats.totalTasks],
        ['Completed Tasks', data.overallStats.completedTasks],
        ['In Progress Tasks', data.overallStats.inProgressTasks],
        ['Overdue Tasks', data.overallStats.overdueTasks],
        ['Completion Rate', `${data.overallStats.completionRate.toFixed(1)}%`],
      ];

      stats.forEach((stat, index) => {
        const row = statsSheet.getRow(index + 3);
        row.getCell(1).value = stat[0];
        row.getCell(1).font = { bold: true };
        row.getCell(2).value = stat[1];
        row.getCell(2).alignment = { horizontal: 'right' };
      });

      statsSheet.columns = [{ width: 25 }, { width: 20 }];

      // ===== SHEET 2: Status Distribution =====
      const distSheet = workbook.addWorksheet('Status Distribution');

      const distHeaders = ['Status', 'Count', 'Percentage'];
      const distHeaderRow = distSheet.addRow(distHeaders);
      this.applyHeaderStyle(distHeaderRow);

      data.statusDistribution.forEach((item) => {
        const row = distSheet.addRow([item.status, item.count, item.percentage]);
        row.getCell(3).numFmt = '0.0"%"';
      });

      this.autoFitColumns(distSheet);
      this.addBorders(distSheet, 1, distSheet.rowCount, distHeaders.length);

      // ===== SHEET 3: Assignee Performance =====
      const perfSheet = workbook.addWorksheet('Assignee Performance');

      const perfHeaders = ['Assignee', 'Total Tasks', 'Completed Tasks', 'Completion Rate', 'Avg Completion Time (days)'];
      const perfHeaderRow = perfSheet.addRow(perfHeaders);
      this.applyHeaderStyle(perfHeaderRow);

      data.assigneePerformance.forEach((item) => {
        const row = perfSheet.addRow([
          item.assignee,
          item.totalTasks,
          item.completedTasks,
          item.completionRate,
          item.averageCompletionTime.toFixed(1),
        ]);
        row.getCell(4).numFmt = '0.0"%"';
      });

      this.autoFitColumns(perfSheet);
      this.addBorders(perfSheet, 1, perfSheet.rowCount, perfHeaders.length);

      const buffer = await workbook.xlsx.writeBuffer();
      logger.info('Task metrics Excel file generated successfully');
      return Buffer.from(buffer);
    } catch (error) {
      logger.error({ error }, 'Failed to generate task metrics Excel');
      throw new Error('Failed to generate Excel file');
    }
  }

  /**
   * Export Single KPI with trend data to Excel
   */
  async exportSingleKPI(data: {
    kpi: {
      name: string;
      description: string;
      category: string;
      unit: string;
      targetValue: number;
      frequency: string;
    };
    seriesData: Array<{
      date: Date;
      actualValue: number;
      targetValue: number;
      deviation: number;
    }>;
  }): Promise<Buffer> {
    try {
      const workbook = this.createWorkbook();
      const sheet = workbook.addWorksheet('KPI Details');

      // Title
      sheet.mergeCells('A1:D1');
      const titleCell = sheet.getCell('A1');
      titleCell.value = data.kpi.name;
      titleCell.font = { size: 16, bold: true, color: { argb: 'FF4472C4' } };
      titleCell.alignment = { horizontal: 'center' };
      sheet.getRow(1).height = 30;

      // KPI Info
      let row = 3;
      const info = [
        ['Description', data.kpi.description],
        ['Category', data.kpi.category],
        ['Unit', data.kpi.unit],
        ['Target Value', data.kpi.targetValue],
        ['Frequency', data.kpi.frequency],
      ];

      info.forEach((item) => {
        const currentRow = sheet.getRow(row);
        currentRow.getCell(1).value = item[0];
        currentRow.getCell(1).font = { bold: true };
        currentRow.getCell(2).value = item[1];
        row++;
      });

      // Trend data
      row += 2;
      const trendHeaders = ['Date', 'Actual Value', 'Target Value', 'Deviation (%)'];
      const trendHeaderRow = sheet.getRow(row);
      trendHeaderRow.values = trendHeaders;
      this.applyHeaderStyle(trendHeaderRow);

      data.seriesData.forEach((series) => {
        row++;
        const dataRow = sheet.getRow(row);
        dataRow.values = [
          format(series.date, 'yyyy-MM-dd'),
          series.actualValue,
          series.targetValue,
          series.deviation,
        ];

        // Deviation color coding
        const deviationCell = dataRow.getCell(4);
        deviationCell.numFmt = '0.0"%"';
        if (series.deviation > 10) {
          deviationCell.font = { color: { argb: 'FFFF0000' }, bold: true };
        } else if (series.deviation > 5) {
          deviationCell.font = { color: { argb: 'FFFFC000' } };
        } else {
          deviationCell.font = { color: { argb: 'FF00B050' } };
        }
      });

      this.autoFitColumns(sheet);

      const buffer = await workbook.xlsx.writeBuffer();
      logger.info('Single KPI Excel file generated successfully');
      return Buffer.from(buffer);
    } catch (error) {
      logger.error({ error }, 'Failed to generate single KPI Excel');
      throw new Error('Failed to generate Excel file');
    }
  }
}

export const excelExportService = new ExcelExportService();
