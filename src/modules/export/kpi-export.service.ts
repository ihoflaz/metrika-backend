import { PrismaClient } from '@prisma/client';
import type { Logger } from '../../lib/logger';
import ExcelJS from 'exceljs';
import { ExportResult, ExportFormat, ExportType } from './export.types';
import { KPIDefinition, KPISeries, KPICategory, KPIStatus } from '@prisma/client';
import { PDFExportService } from './pdf-export.service';
import { kpiDashboardTemplate } from './templates/kpi-dashboard.template';

interface KPIWithSeries extends KPIDefinition {
  series: KPISeries[];
  steward: { id: string; fullName: string; email: string };
  approver: { id: string; fullName: string; email: string } | null;
}

interface KPIDashboardStats {
  totalKPIs: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  onTrack: number;
  atRisk: number;
  critical: number;
  breached: number;
}

export class KPIExportService {
  private pdfService: PDFExportService;

  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {
    this.pdfService = new PDFExportService(logger);
  }

  /**
   * Export KPI Dashboard - aggregate view of all KPIs
   */
  async exportKPIDashboard(userId: string): Promise<ExportResult> {
    try {
      this.logger.info({ userId }, '[KPIExportService] Exporting KPI dashboard');

      // Fetch all KPIs with latest series data
      const kpis = await this.prisma.kPIDefinition.findMany({
        where: {
          OR: [
            { stewardId: userId },
            { approverId: userId },
            { status: 'ACTIVE' }, // All users can see active KPIs
          ],
        },
        include: {
          steward: {
            select: { id: true, fullName: true, email: true },
          },
          approver: {
            select: { id: true, fullName: true, email: true },
          },
          series: {
            orderBy: { periodEnd: 'desc' },
            take: 5, // Last 5 data points for trend
          },
        },
      });

      const stats = this.calculateDashboardStats(kpis);

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Metrika PMO';
      workbook.created = new Date();

      // Add sheets
      this.addDashboardSummarySheet(workbook, stats);
      this.addKPIListSheet(workbook, kpis);
      this.addCategoryBreakdownSheet(workbook, kpis);

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `kpi-dashboard-${new Date().toISOString().split('T')[0]}.xlsx`;

      this.logger.info(
        { userId, fileSize: buffer.byteLength },
        '[KPIExportService] KPI dashboard exported successfully'
      );

      return {
        success: true,
        format: ExportFormat.EXCEL,
        type: ExportType.KPI_DASHBOARD,
        buffer: buffer as unknown as Buffer,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.byteLength,
      };
    } catch (error) {
      this.logger.error({ error, userId }, '[KPIExportService] Failed to export KPI dashboard');
      return {
        success: false,
        format: ExportFormat.EXCEL,
        type: ExportType.KPI_DASHBOARD,
        fileName: '',
        mimeType: '',
        size: 0,
        error: error instanceof Error ? error.message : 'Failed to export KPI dashboard',
      };
    }
  }

  /**
   * Export KPI Dashboard to PDF
   * 
   * Generates a professional PDF report with:
   * - Summary cards (Total, Active, Performing, Breached)
   * - KPI details table with deviation and trend indicators
   * - Status-based color coding
   * 
   * @param userId - User ID for permission filtering
   * @returns Export result with PDF buffer
   */
  async exportKPIDashboardPDF(userId: string): Promise<ExportResult> {
    try {
      this.logger.info({ userId }, '[KPIExportService] Exporting KPI dashboard PDF');

      // Fetch all KPIs with latest series data
      const kpis = await this.prisma.kPIDefinition.findMany({
        where: {
          OR: [
            { stewardId: userId },
            { approverId: userId },
            { status: 'ACTIVE' }, // All users can see active KPIs
          ],
        },
        include: {
          steward: {
            select: { id: true, fullName: true, email: true },
          },
          approver: {
            select: { id: true, fullName: true, email: true },
          },
          series: {
            orderBy: { periodEnd: 'desc' },
            take: 5, // Last 5 data points for trend
          },
        },
      });

      // Get current user info for metadata
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, email: true },
      });

      // Calculate dashboard statistics
      const stats = this.calculateDashboardStats(kpis);

      // Prepare KPI data with deviation and trend
      const kpiDetails = kpis.map((kpi) => {
        const latestSeries = kpi.series[0];
        const currentValue = latestSeries ? Number(latestSeries.actualValue) : 0;
        const targetValue = Number(kpi.targetValue);
        const threshold = Number(kpi.thresholdWarning || kpi.targetValue);

        // Calculate deviation percentage
        const deviation = targetValue !== 0 
          ? ((currentValue - targetValue) / targetValue) * 100 
          : 0;

        // Determine trend (compare with previous period)
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (kpi.series.length >= 2) {
          const prevValue = Number(kpi.series[1].actualValue);
          if (currentValue > prevValue * 1.05) trend = 'up';
          else if (currentValue < prevValue * 0.95) trend = 'down';
        }

        return {
          code: kpi.code,
          name: kpi.name,
          category: kpi.category as string,
          status: kpi.status as string,
          currentValue: Number(currentValue.toFixed(2)),
          targetValue: Number(targetValue.toFixed(2)),
          threshold: Number(threshold.toFixed(2)),
          deviation: Number(deviation.toFixed(1)),
          trend,
        };
      });

      // Prepare data for PDF template
      const dashboardData = {
        totalKPIs: stats.totalKPIs,
        activeKPIs: stats.byStatus.ACTIVE || 0,
        performingKPIs: stats.onTrack,
        breachedKPIs: stats.breached,
        performanceRate: stats.totalKPIs > 0 
          ? Math.round((stats.onTrack / stats.totalKPIs) * 1000) / 10 
          : 0,
        kpis: kpiDetails,
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
      const htmlContent = kpiDashboardTemplate(dashboardData);

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

      const fileName = `kpi-dashboard-${new Date().toISOString().split('T')[0]}.pdf`;

      this.logger.info(
        { userId, fileSize: pdfBuffer.length },
        '[KPIExportService] KPI dashboard PDF exported successfully'
      );

      return {
        success: true,
        format: ExportFormat.PDF,
        type: ExportType.KPI_DASHBOARD,
        buffer: pdfBuffer,
        fileName,
        mimeType: 'application/pdf',
        size: pdfBuffer.length,
      };
    } catch (error) {
      this.logger.error(
        { error, userId },
        '[KPIExportService] Failed to export KPI dashboard PDF'
      );
      return {
        success: false,
        format: ExportFormat.PDF,
        type: ExportType.KPI_DASHBOARD,
        fileName: 'kpi-dashboard-error.pdf',
        mimeType: 'application/pdf',
        size: 0,
        error: error instanceof Error ? error.message : 'Failed to export KPI dashboard PDF',
      };
    }
  }

  /**
   * Export Single KPI - detailed report with historical data
   */
  async exportSingleKPI(kpiId: string, userId: string): Promise<ExportResult> {
    try {
      this.logger.info({ kpiId, userId }, '[KPIExportService] Exporting single KPI');

      // First check if KPI exists
      const kpi = await this.prisma.kPIDefinition.findUnique({
        where: { id: kpiId },
        include: {
          steward: {
            select: { id: true, fullName: true, email: true },
          },
          approver: {
            select: { id: true, fullName: true, email: true },
          },
          series: {
            orderBy: { periodEnd: 'asc' },
            include: {
              collector: {
                select: { id: true, fullName: true, email: true },
              },
              verifier: {
                select: { id: true, fullName: true, email: true },
              },
            },
          },
        },
      });

      this.logger.info({ kpiId, kpiFound: !!kpi }, '[KPIExportService] Query result');

      if (!kpi) {
        this.logger.warn({ kpiId }, '[KPIExportService] KPI not found');
        return {
          success: false,
          format: ExportFormat.EXCEL,
          type: ExportType.KPI_REPORT,
          fileName: '',
          mimeType: '',
          size: 0,
          error: 'KPI not found',
        };
      }

      // Then check access: steward, approver, or ACTIVE status
      const hasAccess = 
        kpi.stewardId === userId || 
        kpi.approverId === userId || 
        kpi.status === 'ACTIVE';

      this.logger.info({ 
        kpiId, 
        userId, 
        stewardId: kpi.stewardId, 
        approverId: kpi.approverId, 
        status: kpi.status, 
        hasAccess 
      }, '[KPIExportService] Access check');

      if (!hasAccess) {
        this.logger.warn({ kpiId, userId }, '[KPIExportService] Access denied');
        return {
          success: false,
          format: ExportFormat.EXCEL,
          type: ExportType.KPI_REPORT,
          fileName: '',
          mimeType: '',
          size: 0,
          error: 'Access denied',
        };
      }

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Metrika PMO';
      workbook.created = new Date();

      // Add sheets
      this.addKPIOverviewSheet(workbook, kpi as any);
      this.addKPISeriesSheet(workbook, kpi as any);
      this.addKPIAnalysisSheet(workbook, kpi as any);

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `kpi-${kpi.code}-${new Date().toISOString().split('T')[0]}.xlsx`;

      this.logger.info(
        { kpiId, userId, fileSize: buffer.byteLength },
        '[KPIExportService] Single KPI exported successfully'
      );

      return {
        success: true,
        format: ExportFormat.EXCEL,
        type: ExportType.KPI_REPORT,
        buffer: buffer as unknown as Buffer,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.byteLength,
      };
    } catch (error) {
      this.logger.error({ error, kpiId, userId }, '[KPIExportService] Failed to export single KPI');
      return {
        success: false,
        format: ExportFormat.EXCEL,
        type: ExportType.KPI_REPORT,
        fileName: '',
        mimeType: '',
        size: 0,
        error: error instanceof Error ? error.message : 'Failed to export KPI',
      };
    }
  }

  private calculateDashboardStats(kpis: KPIWithSeries[]): KPIDashboardStats {
    const stats: KPIDashboardStats = {
      totalKPIs: kpis.length,
      byCategory: {},
      byStatus: {},
      onTrack: 0,
      atRisk: 0,
      critical: 0,
      breached: 0,
    };

    for (const kpi of kpis) {
      // Count by category
      stats.byCategory[kpi.category] = (stats.byCategory[kpi.category] || 0) + 1;

      // Count by status
      stats.byStatus[kpi.status] = (stats.byStatus[kpi.status] || 0) + 1;

      // Performance status (based on latest data point)
      if (kpi.series.length > 0) {
        const latest = kpi.series[0];
        const actual = Number(latest.actualValue);
        const target = Number(kpi.targetValue);
        const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
        const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

        const deviation = Math.abs(((actual - target) / target) * 100);

        if (critical && deviation >= critical) {
          stats.critical++;
        } else if (warning && deviation >= warning) {
          stats.atRisk++;
        } else {
          stats.onTrack++;
        }

        // Check breached (actual exceeds critical threshold)
        if (critical && Math.abs(actual - target) > critical) {
          stats.breached++;
        }
      }
    }

    return stats;
  }

  private addDashboardSummarySheet(workbook: ExcelJS.Workbook, stats: KPIDashboardStats): void {
    const sheet = workbook.addWorksheet('Dashboard Summary');

    // Title
    sheet.mergeCells('A1:D1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'KPI Dashboard Summary';
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Overall stats
    sheet.addRow([]);
    sheet.addRow(['Overall Statistics']);
    sheet.addRow(['Total KPIs', stats.totalKPIs]);
    sheet.addRow(['On Track', stats.onTrack]);
    sheet.addRow(['At Risk', stats.atRisk]);
    sheet.addRow(['Critical', stats.critical]);
    sheet.addRow(['Breached', stats.breached]);

    // By category
    sheet.addRow([]);
    sheet.addRow(['By Category']);
    for (const [category, count] of Object.entries(stats.byCategory)) {
      sheet.addRow([category, count]);
    }

    // By status
    sheet.addRow([]);
    sheet.addRow(['By Status']);
    for (const [status, count] of Object.entries(stats.byStatus)) {
      sheet.addRow([status, count]);
    }

    // Styling
    sheet.getColumn('A').width = 30;
    sheet.getColumn('B').width = 15;

    // Bold section headers
    ['A3', 'A10', 'A16'].forEach((cell) => {
      sheet.getCell(cell).font = { bold: true };
    });
  }

  private addKPIListSheet(workbook: ExcelJS.Workbook, kpis: KPIWithSeries[]): void {
    const sheet = workbook.addWorksheet('KPI List');

    // Headers
    sheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Target', key: 'target', width: 12 },
      { header: 'Latest Value', key: 'latestValue', width: 12 },
      { header: 'Deviation %', key: 'deviation', width: 12 },
      { header: 'Performance', key: 'performance', width: 15 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Steward', key: 'steward', width: 25 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    for (const kpi of kpis) {
      const latest = kpi.series[0];
      const target = Number(kpi.targetValue);
      const actual = latest ? Number(latest.actualValue) : null;
      const deviation = actual !== null ? ((actual - target) / target) * 100 : null;

      let performance = 'No Data';
      if (actual !== null) {
        const absDeviation = Math.abs(deviation!);
        const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;
        const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;

        if (critical && absDeviation >= critical) {
          performance = 'Critical';
        } else if (warning && absDeviation >= warning) {
          performance = 'At Risk';
        } else {
          performance = 'On Track';
        }
      }

      sheet.addRow({
        code: kpi.code,
        name: kpi.name,
        category: kpi.category,
        status: kpi.status,
        target: target,
        latestValue: actual,
        deviation: deviation !== null ? deviation.toFixed(2) : 'N/A',
        performance,
        unit: kpi.unit,
        steward: kpi.steward.fullName,
      });
    }

    // Conditional formatting for performance column
    const performanceCol = sheet.getColumn('performance');
    performanceCol.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      if (cell.value === 'Critical') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' } };
      } else if (cell.value === 'At Risk') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC000' },
        };
      } else if (cell.value === 'On Track') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF92D050' },
        };
      }
    });
  }

  private addCategoryBreakdownSheet(workbook: ExcelJS.Workbook, kpis: KPIWithSeries[]): void {
    const sheet = workbook.addWorksheet('By Category');

    // Group by category
    const byCategory = kpis.reduce((acc, kpi) => {
      if (!acc[kpi.category]) {
        acc[kpi.category] = [];
      }
      acc[kpi.category].push(kpi);
      return acc;
    }, {} as Record<string, KPIWithSeries[]>);

    let currentRow = 1;

    for (const [category, categoryKPIs] of Object.entries(byCategory)) {
      // Category header
      sheet.mergeCells(`A${currentRow}:F${currentRow}`);
      const categoryCell = sheet.getCell(`A${currentRow}`);
      categoryCell.value = `${category} (${categoryKPIs.length} KPIs)`;
      categoryCell.font = { size: 14, bold: true };
      categoryCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E6E6' },
      };
      currentRow++;

      // Column headers
      const headerRow = sheet.getRow(currentRow);
      ['Code', 'Name', 'Target', 'Latest', 'Deviation %', 'Performance'].forEach((header, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = header;
        cell.font = { bold: true };
      });
      currentRow++;

      // Data rows
      for (const kpi of categoryKPIs) {
        const latest = kpi.series[0];
        const target = Number(kpi.targetValue);
        const actual = latest ? Number(latest.actualValue) : null;
        const deviation = actual !== null ? ((actual - target) / target) * 100 : null;

        let performance = 'No Data';
        if (actual !== null) {
          const absDeviation = Math.abs(deviation!);
          const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;
          const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;

          if (critical && absDeviation >= critical) {
            performance = 'Critical';
          } else if (warning && absDeviation >= warning) {
            performance = 'At Risk';
          } else {
            performance = 'On Track';
          }
        }

        const dataRow = sheet.getRow(currentRow);
        dataRow.values = [
          kpi.code,
          kpi.name,
          target,
          actual,
          deviation !== null ? deviation.toFixed(2) : 'N/A',
          performance,
        ];
        currentRow++;
      }

      currentRow++; // Empty row between categories
    }

    // Set column widths
    sheet.getColumn(1).width = 15;
    sheet.getColumn(2).width = 30;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 12;
    sheet.getColumn(6).width = 15;
  }

  private addKPIOverviewSheet(workbook: ExcelJS.Workbook, kpi: any): void {
    const sheet = workbook.addWorksheet('Overview');

    // Title
    sheet.mergeCells('A1:B1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `KPI: ${kpi.name}`;
    titleCell.font = { size: 16, bold: true };

    // Basic info
    sheet.addRow([]);
    sheet.addRow(['Code', kpi.code]);
    sheet.addRow(['Name', kpi.name]);
    sheet.addRow(['Description', kpi.description || 'N/A']);
    sheet.addRow(['Category', kpi.category]);
    sheet.addRow(['Status', kpi.status]);
    sheet.addRow([]);

    // Target & thresholds
    sheet.addRow(['Target & Thresholds']);
    sheet.addRow(['Target Value', Number(kpi.targetValue)]);
    sheet.addRow(['Unit', kpi.unit]);
    sheet.addRow(['Warning Threshold', kpi.thresholdWarning ? Number(kpi.thresholdWarning) : 'N/A']);
    sheet.addRow(['Critical Threshold', kpi.thresholdCritical ? Number(kpi.thresholdCritical) : 'N/A']);
    sheet.addRow([]);

    // Ownership
    sheet.addRow(['Ownership']);
    sheet.addRow(['Steward', kpi.steward.fullName]);
    sheet.addRow(['Approver', kpi.approver ? kpi.approver.fullName : 'N/A']);
    sheet.addRow([]);

    // Latest performance
    if (kpi.series.length > 0) {
      const latest = kpi.series[kpi.series.length - 1]; // Series sorted asc
      const actual = Number(latest.actualValue);
      const target = Number(kpi.targetValue);
      const deviation = ((actual - target) / target) * 100;

      sheet.addRow(['Latest Performance']);
      sheet.addRow(['Period', `${latest.periodStart.toISOString().split('T')[0]} - ${latest.periodEnd.toISOString().split('T')[0]}`]);
      sheet.addRow(['Actual Value', actual]);
      sheet.addRow(['Deviation %', deviation.toFixed(2)]);
      sheet.addRow(['Collected At', latest.collectedAt.toISOString()]);
      sheet.addRow(['Verification Status', latest.verificationStatus]);
    }

    // Styling
    sheet.getColumn('A').width = 30;
    sheet.getColumn('B').width = 40;

    // Bold labels
    sheet.getColumn('A').eachCell((cell) => {
      cell.font = { bold: true };
    });
  }

  private addKPISeriesSheet(workbook: ExcelJS.Workbook, kpi: any): void {
    const sheet = workbook.addWorksheet('Historical Data');

    // Headers
    sheet.columns = [
      { header: 'Period Start', key: 'periodStart', width: 15 },
      { header: 'Period End', key: 'periodEnd', width: 15 },
      { header: 'Actual Value', key: 'actualValue', width: 15 },
      { header: 'Target', key: 'target', width: 15 },
      { header: 'Deviation %', key: 'deviation', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Collected At', key: 'collectedAt', width: 20 },
      { header: 'Collector', key: 'collector', width: 25 },
      { header: 'Verification', key: 'verification', width: 15 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    const target = Number(kpi.targetValue);
    for (const series of kpi.series) {
      const actual = Number(series.actualValue);
      const deviation = ((actual - target) / target) * 100;

      let status = 'On Track';
      const absDeviation = Math.abs(deviation);
      const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;
      const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;

      if (critical && absDeviation >= critical) {
        status = 'Critical';
      } else if (warning && absDeviation >= warning) {
        status = 'At Risk';
      }

      sheet.addRow({
        periodStart: series.periodStart.toISOString().split('T')[0],
        periodEnd: series.periodEnd.toISOString().split('T')[0],
        actualValue: actual,
        target,
        deviation: deviation.toFixed(2),
        status,
        collectedAt: series.collectedAt.toISOString(),
        collector: series.collector ? series.collector.fullName : 'System',
        verification: series.verificationStatus,
      });
    }
  }

  private addKPIAnalysisSheet(workbook: ExcelJS.Workbook, kpi: any): void {
    const sheet = workbook.addWorksheet('Analysis');

    if (kpi.series.length === 0) {
      sheet.addRow(['No data available for analysis']);
      return;
    }

    // Calculate statistics
    const values = kpi.series.map((s: any) => Number(s.actualValue));
    const target = Number(kpi.targetValue);
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = values[values.length - 1];

    // Trend calculation (simple linear regression slope)
    let trend = 'Stable';
    if (values.length >= 3) {
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const avgFirst = firstHalf.reduce((a: number, b: number) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a: number, b: number) => a + b, 0) / secondHalf.length;

      if (avgSecond > avgFirst * 1.05) {
        trend = 'Improving';
      } else if (avgSecond < avgFirst * 0.95) {
        trend = 'Declining';
      }
    }

    // Add analysis
    sheet.addRow(['Statistical Analysis']);
    sheet.addRow([]);
    sheet.addRow(['Target Value', target]);
    sheet.addRow(['Latest Value', latest]);
    sheet.addRow(['Average Value', avg.toFixed(2)]);
    sheet.addRow(['Minimum Value', min]);
    sheet.addRow(['Maximum Value', max]);
    sheet.addRow(['Data Points', values.length]);
    sheet.addRow(['Trend', trend]);
    sheet.addRow([]);

    // Performance summary
    const deviations = values.map((v: number) => Math.abs(((v - target) / target) * 100));
    const avgDeviation = deviations.reduce((a: number, b: number) => a + b, 0) / deviations.length;

    sheet.addRow(['Performance Summary']);
    sheet.addRow([]);
    sheet.addRow(['Average Deviation %', avgDeviation.toFixed(2)]);
    sheet.addRow(['Latest Deviation %', (((latest - target) / target) * 100).toFixed(2)]);

    // Count by status
    const critical = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;
    const warning = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;

    let onTrackCount = 0;
    let atRiskCount = 0;
    let criticalCount = 0;

    for (const dev of deviations) {
      if (critical && dev >= critical) {
        criticalCount++;
      } else if (warning && dev >= warning) {
        atRiskCount++;
      } else {
        onTrackCount++;
      }
    }

    sheet.addRow([]);
    sheet.addRow(['On Track Periods', onTrackCount]);
    sheet.addRow(['At Risk Periods', atRiskCount]);
    sheet.addRow(['Critical Periods', criticalCount]);

    // Styling
    sheet.getColumn('A').width = 30;
    sheet.getColumn('B').width = 20;
    sheet.getColumn('A').eachCell((cell) => {
      if (cell.value && ['Statistical Analysis', 'Performance Summary'].includes(cell.value.toString())) {
        cell.font = { bold: true, size: 14 };
      }
    });
  }
}
