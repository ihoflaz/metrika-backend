import ExcelJS from 'exceljs';
import type { Logger } from '../../lib/logger';
import {
  ExcelWorkbookOptions,
  ExcelSheetConfig,
  ExportResult,
  ExportFormat,
  ExportType,
} from './export.types';

/**
 * Base Excel Export Service
 * Provides common functionality for generating Excel files
 */
export class ExcelExportService {
  constructor(private readonly logger: Logger) {}

  /**
   * Create a new Excel workbook with metadata
   */
  createWorkbook(options?: ExcelWorkbookOptions): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();

    // Set workbook properties
    workbook.creator = options?.creator || 'Metrika PMO System';
    workbook.lastModifiedBy = options?.lastModifiedBy || 'Metrika PMO System';
    workbook.created = options?.created || new Date();
    workbook.modified = options?.modified || new Date();

    if (options?.properties) {
      if (options.properties.title) workbook.title = options.properties.title;
      if (options.properties.subject) workbook.subject = options.properties.subject;
      if (options.properties.keywords) workbook.keywords = options.properties.keywords;
      if (options.properties.category) workbook.category = options.properties.category;
      if (options.properties.description) workbook.description = options.properties.description;
    }

    return workbook;
  }

  /**
   * Add a worksheet with data and styling
   */
  addWorksheet(
    workbook: ExcelJS.Workbook,
    config: ExcelSheetConfig
  ): ExcelJS.Worksheet {
    const worksheet = workbook.addWorksheet(config.name);

    // Set columns
    worksheet.columns = config.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 15,
      style: col.style,
    }));

    // Apply header styling
    if (config.styling?.headerStyle) {
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        if (config.styling?.headerStyle) {
          Object.assign(cell, config.styling.headerStyle);
        }
      });
      headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF366092' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 25;
    }

    // Add data rows
    config.data.forEach((item, index) => {
      const row = worksheet.addRow(item);

      // Apply alternating row colors
      if (config.styling?.evenRowStyle && index % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F5F5' },
          };
        });
      }

      // Apply column-specific formatting
      config.columns.forEach((col) => {
        if (col.format) {
          const cell = row.getCell(col.key);
          cell.numFmt = col.format;
        }
      });
    });

    // Add auto filter
    if (config.autoFilter) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: config.columns.length },
      };
    }

    // Freeze panes
    if (config.freezePane) {
      worksheet.views = [
        {
          state: 'frozen',
          xSplit: config.freezePane.col || 0,
          ySplit: config.freezePane.row || 1,
        },
      ];
    }

    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        };
      });
    });

    return worksheet;
  }

  /**
   * Add a summary section to worksheet
   */
  addSummarySection(
    worksheet: ExcelJS.Worksheet,
    title: string,
    summaryData: Array<{ label: string; value: any; format?: string }>
  ): void {
    // Add title row
    const titleRow = worksheet.addRow([title]);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FF366092' } };
    titleRow.height = 30;
    titleRow.getCell(1).alignment = { vertical: 'middle' };

    // Add empty row
    worksheet.addRow([]);

    // Add summary data
    summaryData.forEach((item) => {
      const row = worksheet.addRow([item.label, item.value]);
      row.getCell(1).font = { bold: true };
      row.getCell(1).alignment = { horizontal: 'right' };
      if (item.format) {
        row.getCell(2).numFmt = item.format;
      }
    });

    // Add empty row after summary
    worksheet.addRow([]);
  }

  /**
   * Add a chart to worksheet
   */
  addChart(
    worksheet: ExcelJS.Worksheet,
    chartConfig: {
      type: 'bar' | 'line' | 'pie';
      title: string;
      position: string; // e.g., 'A1'
      width?: number;
      height?: number;
      dataRange: string; // e.g., 'A2:B10'
    }
  ): void {
    // Note: ExcelJS chart support is limited
    // For complex charts, consider generating them separately or using images
    this.logger.info(
      `Chart placeholder added: ${chartConfig.title} at ${chartConfig.position}`
    );

    // Add a text placeholder for now
    const cell = worksheet.getCell(chartConfig.position);
    cell.value = `[Chart: ${chartConfig.title}]`;
    cell.font = { italic: true, color: { argb: 'FF999999' } };
  }

  /**
   * Generate Excel buffer
   */
  async generateBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate export result
   */
  async createExportResult(
    workbook: ExcelJS.Workbook,
    type: ExportType,
    fileName: string
  ): Promise<ExportResult> {
    try {
      const buffer = await this.generateBuffer(workbook);

      return {
        success: true,
        format: ExportFormat.EXCEL,
        type,
        buffer,
        fileName: `${fileName}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error({ error }, 'Excel export failed');
      return {
        success: false,
        format: ExportFormat.EXCEL,
        type,
        fileName: `${fileName}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Format cell value based on type
   */
  formatCellValue(value: any, format?: string): any {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'number' && format) {
      return value;
    }

    return value;
  }

  /**
   * Get status color based on task/KPI status
   */
  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      COMPLETED: '00B050',
      IN_PROGRESS: '00B0F0',
      PLANNED: 'FFC000',
      BLOCKED: 'FF0000',
      ON_HOLD: 'C0C0C0',
      CANCELLED: '7F7F7F',
      DRAFT: 'D0D0D0',
      // KPI statuses
      ACTIVE: '00B050',
      MONITORING: '00B0F0',
      BREACHED: 'FF0000',
      PROPOSED: 'FFC000',
    };

    return colors[status] || 'FFFFFF';
  }

  /**
   * Get priority color
   */
  getPriorityColor(priority: string): string {
    const colors: Record<string, string> = {
      CRITICAL: 'C00000',
      HIGH: 'FF6600',
      NORMAL: 'FFC000',
      LOW: '00B050',
    };

    return colors[priority] || 'FFFFFF';
  }
}
