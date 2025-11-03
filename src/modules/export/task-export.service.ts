import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Logger } from '../../lib/logger';
import type { DatabaseClient } from '../../db/prisma-client';
import { ExcelExportService } from './excel-export.service';
import { PDFExportService } from './pdf-export.service';
import {
  ExportOptions,
  ExportResult,
  ExportFormat,
  ExportType,
  TaskExportData,
  TaskExportSummary,
} from './export.types';

/**
 * Task Export Service
 * Handles Excel and PDF export of tasks with detailed formatting
 */
export class TaskExportService {
  private readonly excelService: ExcelExportService;
  private readonly pdfService: PDFExportService;

  constructor(
    private readonly logger: Logger,
    private readonly prisma: DatabaseClient
  ) {
    this.excelService = new ExcelExportService(logger);
    this.pdfService = new PDFExportService(logger);
  }

  /**
   * Export tasks to Excel or PDF
   */
  async exportTasks(options: ExportOptions): Promise<ExportResult> {
    this.logger.info({ options }, 'Starting task export');

    try {
      // Fetch tasks from database
      const tasks = await this.fetchTasks(options);
      const summary = this.calculateSummary(tasks);

      // Generate export based on format
      if (options.format === ExportFormat.EXCEL) {
        return await this.exportToExcel(tasks, summary, options);
      } else if (options.format === ExportFormat.PDF) {
        return await this.exportToPDF(tasks, summary, options);
      } else {
        throw new Error(`Unsupported export format: ${options.format}`);
      }
    } catch (error) {
      this.logger.error({ error }, 'Task export failed');
      throw error;
    }
  }

  /**
   * Fetch tasks from database with filters
   */
  private async fetchTasks(options: ExportOptions): Promise<TaskExportData[]> {
    const filters = options.filters || {};

    const tasks = await this.prisma.task.findMany({
      where: {
        projectId: filters.projectId,
        status: filters.status ? { in: filters.status as any } : undefined,
        priority: filters.priority ? { in: filters.priority as any } : undefined,
        ownerId: filters.ownerId,
        plannedStart: filters.startDate
          ? { gte: filters.startDate }
          : undefined,
        plannedEnd: filters.endDate ? { lte: filters.endDate } : undefined,
      },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        project: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      owner: task.owner.fullName,
      project: task.project.name,
      plannedStart: task.plannedStart || undefined,
      plannedEnd: task.plannedEnd || undefined,
      actualStart: task.actualStart || undefined,
      actualEnd: task.actualEnd || undefined,
      progress: task.progressPct,
      estimatedHours: task.effortPlannedHours
        ? Number(task.effortPlannedHours)
        : undefined,
      loggedHours: task.effortLoggedHours
        ? Number(task.effortLoggedHours)
        : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(tasks: TaskExportData[]): TaskExportSummary {
    const byStatus = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byPriority = tasks.reduce((acc, task) => {
      acc[task.priority] = (acc[task.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
    const delayedTasks = tasks.filter((t) => {
      if (t.status === 'COMPLETED' || !t.plannedEnd) return false;
      return new Date() > new Date(t.plannedEnd);
    }).length;

    const onTimeTasks = completedTasks - delayedTasks;
    const avgProgress =
      tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length || 0;

    return {
      totalTasks: tasks.length,
      byStatus,
      byPriority,
      completionRate: (completedTasks / tasks.length) * 100 || 0,
      averageProgress: avgProgress,
      onTimeRate: completedTasks > 0 ? (onTimeTasks / completedTasks) * 100 : 0,
      delayedTasks,
    };
  }

  /**
   * Export to Excel format
   */
  private async exportToExcel(
    tasks: TaskExportData[],
    summary: TaskExportSummary,
    options: ExportOptions
  ): Promise<ExportResult> {
    const workbook = this.excelService.createWorkbook({
      creator: options.metadata?.author || 'Metrika PMO System',
      properties: {
        title: options.metadata?.title || 'Task Export',
        subject: 'Task List Export',
        keywords: 'tasks, export, excel',
        category: 'PMO Reports',
        description: 'Exported task list with detailed information',
      },
    });

    // Add summary worksheet
    const summarySheet = workbook.addWorksheet('Özet');
    this.addExcelSummary(summarySheet, summary, options);

    // Add tasks worksheet
    const tasksSheet = this.excelService.addWorksheet(workbook, {
      name: 'Görevler',
      data: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: this.translateStatus(task.status),
        priority: this.translatePriority(task.priority),
        owner: task.owner,
        project: task.project,
        plannedStart: task.plannedStart
          ? format(new Date(task.plannedStart), 'dd/MM/yyyy', { locale: tr })
          : '',
        plannedEnd: task.plannedEnd
          ? format(new Date(task.plannedEnd), 'dd/MM/yyyy', { locale: tr })
          : '',
        actualStart: task.actualStart
          ? format(new Date(task.actualStart), 'dd/MM/yyyy', { locale: tr })
          : '',
        actualEnd: task.actualEnd
          ? format(new Date(task.actualEnd), 'dd/MM/yyyy', { locale: tr })
          : '',
        progress: task.progress,
        estimatedHours: task.estimatedHours || 0,
        loggedHours: task.loggedHours || 0,
      })),
      columns: [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Görev Adı', key: 'title', width: 35 },
        { header: 'Durum', key: 'status', width: 15 },
        { header: 'Öncelik', key: 'priority', width: 12 },
        { header: 'Sorumlu', key: 'owner', width: 20 },
        { header: 'Proje', key: 'project', width: 20 },
        { header: 'Plan Başlangıç', key: 'plannedStart', width: 15 },
        { header: 'Plan Bitiş', key: 'plannedEnd', width: 15 },
        { header: 'Gerçek Başlangıç', key: 'actualStart', width: 15 },
        { header: 'Gerçek Bitiş', key: 'actualEnd', width: 15 },
        { header: 'İlerleme %', key: 'progress', width: 12, format: '0%' },
        {
          header: 'Tahmini Saat',
          key: 'estimatedHours',
          width: 12,
          format: '#,##0.00',
        },
        {
          header: 'Harcanan Saat',
          key: 'loggedHours',
          width: 12,
          format: '#,##0.00',
        },
      ],
      autoFilter: true,
      freezePane: { row: 1, col: 0 },
    });

    // Apply conditional formatting for status
    this.applyStatusFormatting(tasksSheet, tasks.length);

    const fileName = `tasks_${format(new Date(), 'yyyyMMdd_HHmmss')}`;
    return await this.excelService.createExportResult(
      workbook,
      ExportType.TASKS,
      fileName
    );
  }

  /**
   * Add summary section to Excel
   */
  private addExcelSummary(
    worksheet: any,
    summary: TaskExportSummary,
    options: ExportOptions
  ): void {
    // Title
    const titleRow = worksheet.addRow([options.metadata?.title || 'Görev Raporu']);
    titleRow.font = { bold: true, size: 16, color: { argb: 'FF366092' } };
    titleRow.height = 30;
    worksheet.addRow([]);

    // Metadata
    worksheet.addRow([
      'Rapor Tarihi:',
      format(new Date(), 'dd MMMM yyyy HH:mm', { locale: tr }),
    ]);
    if (options.metadata?.author) {
      worksheet.addRow(['Hazırlayan:', options.metadata.author]);
    }
    worksheet.addRow([]);

    // Summary statistics
    this.excelService.addSummarySection(worksheet, 'Özet İstatistikler', [
      { label: 'Toplam Görev', value: summary.totalTasks, format: '#,##0' },
      {
        label: 'Tamamlanma Oranı',
        value: summary.completionRate / 100,
        format: '0.00%',
      },
      {
        label: 'Ortalama İlerleme',
        value: summary.averageProgress / 100,
        format: '0.00%',
      },
      {
        label: 'Zamanında Tamamlama',
        value: summary.onTimeRate / 100,
        format: '0.00%',
      },
      { label: 'Gecikmiş Görevler', value: summary.delayedTasks, format: '#,##0' },
    ]);

    // By Status
    worksheet.addRow([]);
    worksheet.addRow(['Duruma Göre Dağılım']).font = {
      bold: true,
      size: 12,
      color: { argb: 'FF366092' },
    };
    Object.entries(summary.byStatus).forEach(([status, count]) => {
      worksheet.addRow([this.translateStatus(status), count]);
    });

    // By Priority
    worksheet.addRow([]);
    worksheet.addRow(['Önceliğe Göre Dağılım']).font = {
      bold: true,
      size: 12,
      color: { argb: 'FF366092' },
    };
    Object.entries(summary.byPriority).forEach(([priority, count]) => {
      worksheet.addRow([this.translatePriority(priority), count]);
    });

    // Set column widths
    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 20;
  }

  /**
   * Apply status-based conditional formatting
   */
  private applyStatusFormatting(worksheet: any, rowCount: number): void {
    // Status is the 3rd column (ID=1, Title=2, Status=3)
    // Access cells directly instead of using getColumn
    for (let i = 2; i <= rowCount + 1; i++) {
      const cell = worksheet.getCell(`C${i}`); // C column for status
      const status = cell.value as string;
      
      if (status?.includes('Tamamlandı')) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF00B050' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      } else if (status?.includes('Devam')) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF00B0F0' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      } else if (status?.includes('Bloke')) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      }
    }
  }

  /**
   * Export to PDF format
   */
  private async exportToPDF(
    tasks: TaskExportData[],
    summary: TaskExportSummary,
    options: ExportOptions
  ): Promise<ExportResult> {
    const summaryHTML = this.generateSummaryHTML(summary);
    const tasksHTML = this.generateTasksTableHTML(tasks);

    const content = `
      ${summaryHTML}
      <div class="page-break"></div>
      <h2 style="color: #667eea; margin-top: 30px;">Görev Listesi</h2>
      ${tasksHTML}
    `;

    const templateData = {
      title: options.metadata?.title || 'Görev Raporu',
      subtitle: options.metadata?.subject,
      date: format(new Date(), 'dd MMMM yyyy HH:mm', { locale: tr }),
      author: options.metadata?.author,
      content,
    };

    const fileName = `tasks_${format(new Date(), 'yyyyMMdd_HHmmss')}`;
    return await this.pdfService.createExportResult(
      templateData,
      ExportType.TASKS,
      fileName,
      {
        format: options.styling?.pageSize || 'A4',
        orientation: options.styling?.orientation || 'landscape',
        printBackground: true,
      }
    );
  }

  /**
   * Generate summary HTML for PDF
   */
  private generateSummaryHTML(summary: TaskExportSummary): string {
    return `
      <div class="summary-box">
        <h3>Özet İstatistikler</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="label">Toplam Görev</div>
            <div class="value">${summary.totalTasks}</div>
          </div>
          <div class="summary-item">
            <div class="label">Tamamlanma Oranı</div>
            <div class="value">${summary.completionRate.toFixed(1)}%</div>
          </div>
          <div class="summary-item">
            <div class="label">Ortalama İlerleme</div>
            <div class="value">${summary.averageProgress.toFixed(1)}%</div>
          </div>
          <div class="summary-item">
            <div class="label">Zamanında Tamamlama</div>
            <div class="value">${summary.onTimeRate.toFixed(1)}%</div>
          </div>
          <div class="summary-item">
            <div class="label">Gecikmiş Görevler</div>
            <div class="value">${summary.delayedTasks}</div>
          </div>
        </div>
      </div>

      <div class="summary-box">
        <h3>Duruma Göre Dağılım</h3>
        <table style="width: 100%;">
          <tbody>
            ${Object.entries(summary.byStatus)
              .map(
                ([status, count]) => `
              <tr>
                <td><strong>${this.translateStatus(status)}</strong></td>
                <td style="text-align: right;">${count}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="summary-box">
        <h3>Önceliğe Göre Dağılım</h3>
        <table style="width: 100%;">
          <tbody>
            ${Object.entries(summary.byPriority)
              .map(
                ([priority, count]) => `
              <tr>
                <td><strong>${this.translatePriority(priority)}</strong></td>
                <td style="text-align: right;">${count}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Generate tasks table HTML for PDF
   */
  private generateTasksTableHTML(tasks: TaskExportData[]): string {
    return this.pdfService.formatTableHTML(tasks, [
      { header: 'Görev', key: 'title' },
      {
        header: 'Durum',
        key: 'status',
        format: (val) => this.pdfService.formatStatusBadge(val),
      },
      {
        header: 'Öncelik',
        key: 'priority',
        format: (val) => this.translatePriority(val),
      },
      { header: 'Sorumlu', key: 'owner' },
      {
        header: 'Plan Bitiş',
        key: 'plannedEnd',
        format: (val) =>
          val ? format(new Date(val), 'dd/MM/yyyy', { locale: tr }) : '-',
      },
      {
        header: 'İlerleme',
        key: 'progress',
        format: (val) => `${val}%`,
      },
    ]);
  }

  /**
   * Translate status to Turkish
   */
  private translateStatus(status: string): string {
    const translations: Record<string, string> = {
      DRAFT: 'Taslak',
      PLANNED: 'Planlandı',
      IN_PROGRESS: 'Devam Ediyor',
      BLOCKED: 'Bloke',
      ON_HOLD: 'Beklemede',
      COMPLETED: 'Tamamlandı',
      CANCELLED: 'İptal Edildi',
    };
    return translations[status] || status;
  }

  /**
   * Translate priority to Turkish
   */
  private translatePriority(priority: string): string {
    const translations: Record<string, string> = {
      LOW: 'Düşük',
      NORMAL: 'Normal',
      HIGH: 'Yüksek',
      CRITICAL: 'Kritik',
    };
    return translations[priority] || priority;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.pdfService.closeBrowser();
  }
}
