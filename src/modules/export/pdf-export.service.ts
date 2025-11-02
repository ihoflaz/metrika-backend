import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Logger } from '../../lib/logger';
import {
  PDFOptions,
  PDFTemplateData,
  ExportResult,
  ExportFormat,
  ExportType,
} from './export.types';

/**
 * Base PDF Export Service
 * Uses Puppeteer to generate PDF documents from HTML templates
 */
export class PDFExportService {
  private browser: Browser | null = null;

  constructor(private readonly logger: Logger) {}

  /**
   * Initialize Puppeteer browser
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info('Launching Puppeteer browser...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info('Puppeteer browser closed');
    }
  }

  /**
   * Generate PDF from HTML content
   */
  async generatePDFFromHTML(
    html: string,
    options?: PDFOptions
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Set viewport for consistent rendering
      await page.setViewport({
        width: options?.orientation === 'landscape' ? 1200 : 800,
        height: 1000,
        deviceScaleFactor: 2,
      });

      // Set content
      await page.setContent(html, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 30000,
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: options?.format || 'A4',
        landscape: options?.orientation === 'landscape',
        margin: options?.margin || {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
        displayHeaderFooter: options?.displayHeaderFooter ?? true,
        headerTemplate: options?.headerTemplate || this.getDefaultHeaderTemplate(),
        footerTemplate: options?.footerTemplate || this.getDefaultFooterTemplate(),
        printBackground: options?.printBackground ?? true,
        scale: options?.scale || 1,
        preferCSSPageSize: false,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  /**
   * Generate PDF from template data
   */
  async generatePDF(
    templateData: PDFTemplateData,
    options?: PDFOptions
  ): Promise<Buffer> {
    const html = this.renderTemplate(templateData);
    return this.generatePDFFromHTML(html, options);
  }

  /**
   * Render HTML template with data
   */
  private renderTemplate(data: PDFTemplateData): string {
    return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
      background: white;
    }
    
    .container {
      max-width: 100%;
      padding: 0;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 40px;
      margin-bottom: 30px;
    }
    
    .header h1 {
      font-size: 28pt;
      margin-bottom: 10px;
      font-weight: 600;
    }
    
    .header .subtitle {
      font-size: 14pt;
      opacity: 0.95;
    }
    
    .metadata {
      background: #f8f9fa;
      padding: 20px 40px;
      margin-bottom: 30px;
      border-left: 4px solid #667eea;
    }
    
    .metadata-item {
      display: inline-block;
      margin-right: 30px;
      margin-bottom: 10px;
    }
    
    .metadata-item strong {
      color: #495057;
      font-weight: 600;
    }
    
    .content {
      padding: 0 40px 40px 40px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 10pt;
    }
    
    table thead {
      background: #667eea;
      color: white;
    }
    
    table th,
    table td {
      padding: 12px;
      text-align: left;
      border: 1px solid #dee2e6;
    }
    
    table tbody tr:nth-child(even) {
      background: #f8f9fa;
    }
    
    table tbody tr:hover {
      background: #e9ecef;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 9pt;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-success {
      background: #28a745;
      color: white;
    }
    
    .badge-warning {
      background: #ffc107;
      color: #333;
    }
    
    .badge-danger {
      background: #dc3545;
      color: white;
    }
    
    .badge-info {
      background: #17a2b8;
      color: white;
    }
    
    .badge-secondary {
      background: #6c757d;
      color: white;
    }
    
    .summary-box {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    
    .summary-box h3 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 14pt;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    
    .summary-item {
      background: white;
      padding: 15px;
      border-radius: 6px;
      border-left: 3px solid #667eea;
    }
    
    .summary-item .label {
      font-size: 9pt;
      color: #6c757d;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 5px;
    }
    
    .summary-item .value {
      font-size: 18pt;
      font-weight: 700;
      color: #333;
    }
    
    .page-break {
      page-break-after: always;
    }
    
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data.title}</h1>
      ${data.subtitle ? `<div class="subtitle">${data.subtitle}</div>` : ''}
    </div>
    
    <div class="metadata">
      <div class="metadata-item">
        <strong>Tarih:</strong> ${data.date}
      </div>
      ${data.author ? `<div class="metadata-item"><strong>Hazırlayan:</strong> ${data.author}</div>` : ''}
      ${
        data.metadata
          ? Object.entries(data.metadata)
              .map(
                ([key, value]) =>
                  `<div class="metadata-item"><strong>${key}:</strong> ${value}</div>`
              )
              .join('')
          : ''
      }
    </div>
    
    <div class="content">
      ${typeof data.content === 'string' ? data.content : JSON.stringify(data.content)}
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Default header template for PDF
   */
  private getDefaultHeaderTemplate(): string {
    return `
      <div style="font-size: 9px; padding: 10px 40px; width: 100%; color: #666;">
        <span style="float: left;">Metrika PMO System</span>
        <span style="float: right;"></span>
      </div>
    `;
  }

  /**
   * Default footer template for PDF
   */
  private getDefaultFooterTemplate(): string {
    return `
      <div style="font-size: 9px; padding: 10px 40px; width: 100%; color: #666; border-top: 1px solid #dee2e6;">
        <span style="float: left;">Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        <span style="float: right;"><span class="date"></span></span>
      </div>
    `;
  }

  /**
   * Create export result
   */
  async createExportResult(
    templateData: PDFTemplateData,
    type: ExportType,
    fileName: string,
    options?: PDFOptions
  ): Promise<ExportResult> {
    try {
      const buffer = await this.generatePDF(templateData, options);

      return {
        success: true,
        format: ExportFormat.PDF,
        type,
        buffer,
        fileName: `${fileName}.pdf`,
        mimeType: 'application/pdf',
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error({ error }, 'PDF export failed');
      return {
        success: false,
        format: ExportFormat.PDF,
        type,
        fileName: `${fileName}.pdf`,
        mimeType: 'application/pdf',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Format table HTML for PDF
   */
  formatTableHTML(data: any[], columns: { header: string; key: string; format?: (val: any) => string }[]): string {
    const headers = columns.map((col) => `<th>${col.header}</th>`).join('');
    const rows = data
      .map((row) => {
        const cells = columns
          .map((col) => {
            const value = row[col.key];
            const formatted = col.format ? col.format(value) : value;
            return `<td>${formatted}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    return `
      <table>
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  /**
   * Format status badge HTML
   */
  formatStatusBadge(status: string): string {
    const badgeClass = this.getStatusBadgeClass(status);
    return `<span class="badge ${badgeClass}">${status}</span>`;
  }

  /**
   * Get status badge CSS class
   */
  private getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      COMPLETED: 'badge-success',
      IN_PROGRESS: 'badge-info',
      PLANNED: 'badge-warning',
      BLOCKED: 'badge-danger',
      ON_HOLD: 'badge-secondary',
      CANCELLED: 'badge-secondary',
      DRAFT: 'badge-secondary',
      // KPI statuses
      ACTIVE: 'badge-success',
      MONITORING: 'badge-info',
      BREACHED: 'badge-danger',
      PROPOSED: 'badge-warning',
    };

    return classes[status] || 'badge-secondary';
  }
}
