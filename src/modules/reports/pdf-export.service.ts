import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { logger } from '../../lib/logger';

/**
 * PDF Export Service
 * Generates professional PDF reports
 */
export class PDFExportService {
  /**
   * Add header to PDF page
   */
  private addHeader(doc: PDFKit.PDFDocument, title: string): void {
    doc
      .fontSize(20)
      .fillColor('#4472C4')
      .text(title, 50, 50, { align: 'center' });

    doc
      .fontSize(10)
      .fillColor('#666666')
      .text(`Generated: ${format(new Date(), 'PPpp')}`, 50, 80, { align: 'center' });

    doc.moveDown(2);
  }

  /**
   * Add footer to PDF page
   */
  private addFooter(doc: PDFKit.PDFDocument, pageNumber: number): void {
    doc
      .fontSize(10)
      .fillColor('#999999')
      .text(`Page ${pageNumber}`, 50, doc.page.height - 50, {
        align: 'center',
      });
  }

  /**
   * Export Portfolio Summary to PDF
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
    }>;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const result = Buffer.concat(chunks);
          logger.info('Portfolio summary PDF generated successfully');
          resolve(result);
        });
        doc.on('error', reject);

        // Header
        this.addHeader(doc, 'Portfolio Summary Report');

        // Summary Section
        doc
          .fontSize(14)
          .fillColor('#000000')
          .text('Executive Summary', { underline: true });
        doc.moveDown(0.5);

        const summaryData = [
          ['Total Projects:', data.summary.totalProjects],
          ['Active Projects:', data.summary.activeProjects],
          ['Completed Projects:', data.summary.completedProjects],
          ['Total Tasks:', data.summary.totalTasks],
          ['Completed Tasks:', data.summary.completedTasks],
          ['Overdue Tasks:', data.summary.overdueTasks],
          ['Total Budget:', `$${data.summary.totalBudget.toLocaleString()}`],
          ['Spent Budget:', `$${data.summary.spentBudget.toLocaleString()}`],
        ];

        doc.fontSize(11);
        summaryData.forEach(([label, value]) => {
          doc
            .fillColor('#000000')
            .text(String(label), 70, doc.y, { continued: true, width: 200 })
            .fillColor('#4472C4')
            .text(String(value), { align: 'right', width: 400 });
          doc.moveDown(0.3);
        });

        doc.moveDown(2);

        // Projects Table
        doc
          .fontSize(14)
          .fillColor('#000000')
          .text('Project Details', { underline: true });
        doc.moveDown(0.5);

        // Table headers
        const tableTop = doc.y;
        const col1 = 50;
        const col2 = 130;
        const col3 = 280;
        const col4 = 360;
        const col5 = 450;

        doc
          .fontSize(10)
          .fillColor('#FFFFFF')
          .rect(col1, tableTop, 520, 20)
          .fill('#4472C4');

        doc
          .fillColor('#FFFFFF')
          .text('Code', col1 + 5, tableTop + 5, { width: 70 })
          .text('Name', col2 + 5, tableTop + 5, { width: 140 })
          .text('Status', col3 + 5, tableTop + 5, { width: 70 })
          .text('Progress', col4 + 5, tableTop + 5, { width: 80 })
          .text('Tasks', col5 + 5, tableTop + 5, { width: 70 });

        // Table rows
        let y = tableTop + 25;
        data.projects.slice(0, 15).forEach((project, index) => {
          if (y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
          }

          const bgColor = index % 2 === 0 ? '#F2F2F2' : '#FFFFFF';
          doc.rect(col1, y, 520, 20).fill(bgColor);

          doc
            .fillColor('#000000')
            .fontSize(9)
            .text(project.code, col1 + 5, y + 5, { width: 70 })
            .text(project.name, col2 + 5, y + 5, { width: 140 })
            .text(project.status, col3 + 5, y + 5, { width: 70 })
            .text(`${project.progress}%`, col4 + 5, y + 5, { width: 80 })
            .text(`${project.tasksCompleted}/${project.tasksTotal}`, col5 + 5, y + 5, { width: 70 });

          y += 20;
        });

        // Footer
        this.addFooter(doc, 1);

        doc.end();
      } catch (error) {
        logger.error({ error }, 'Failed to generate portfolio summary PDF');
        reject(new Error('Failed to generate PDF file'));
      }
    });
  }

  /**
   * Export KPI Dashboard to PDF
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
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const result = Buffer.concat(chunks);
          logger.info('KPI dashboard PDF generated successfully');
          resolve(result);
        });
        doc.on('error', reject);

        // Header
        this.addHeader(doc, 'KPI Dashboard');

        // KPI Table
        const tableTop = doc.y;
        const col1 = 50;
        const col2 = 180;
        const col3 = 280;
        const col4 = 350;
        const col5 = 450;

        doc
          .fontSize(10)
          .fillColor('#FFFFFF')
          .rect(col1, tableTop, 520, 20)
          .fill('#4472C4');

        doc
          .fillColor('#FFFFFF')
          .text('KPI Name', col1 + 5, tableTop + 5, { width: 120 })
          .text('Category', col2 + 5, tableTop + 5, { width: 90 })
          .text('Current', col3 + 5, tableTop + 5, { width: 60 })
          .text('Target', col4 + 5, tableTop + 5, { width: 90 })
          .text('Status', col5 + 5, tableTop + 5, { width: 70 });

        // Table rows
        let y = tableTop + 25;
        data.kpis.forEach((kpi, index) => {
          if (y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
          }

          const bgColor = index % 2 === 0 ? '#F2F2F2' : '#FFFFFF';
          doc.rect(col1, y, 520, 20).fill(bgColor);

          // Status color
          let statusColor = '#000000';
          switch (kpi.status.toUpperCase()) {
            case 'ON_TRACK':
            case 'ACHIEVED':
              statusColor = '#00B050';
              break;
            case 'AT_RISK':
            case 'WARNING':
              statusColor = '#FFC000';
              break;
            case 'OFF_TRACK':
            case 'CRITICAL':
              statusColor = '#FF0000';
              break;
          }

          doc
            .fillColor('#000000')
            .fontSize(9)
            .text(kpi.name, col1 + 5, y + 5, { width: 120 })
            .text(kpi.category, col2 + 5, y + 5, { width: 90 })
            .text(`${kpi.currentValue} ${kpi.unit}`, col3 + 5, y + 5, { width: 60 })
            .text(`${kpi.targetValue} ${kpi.unit}`, col4 + 5, y + 5, { width: 90 })
            .fillColor(statusColor)
            .text(kpi.status, col5 + 5, y + 5, { width: 70 });

          y += 20;
        });

        // Footer
        this.addFooter(doc, 1);

        doc.end();
      } catch (error) {
        logger.error({ error }, 'Failed to generate KPI dashboard PDF');
        reject(new Error('Failed to generate PDF file'));
      }
    });
  }
}

export const pdfExportService = new PDFExportService();
