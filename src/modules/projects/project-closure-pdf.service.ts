import PDFDocument from 'pdfkit';
import type { Readable } from 'stream';

type PDFDoc = typeof PDFDocument.prototype;

export interface ProjectClosureData {
  project: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    startDate: Date;
    endDate: Date | null;
    actualStart: Date | null;
    actualEnd: Date | null;
    budgetPlanned: any;
    durationDays: number;
  };
  statistics: {
    totalTasks: number;
    completedTasks: number;
    cancelledTasks: number;
    completionRate: number;
    totalDocuments: number;
    totalMembers: number;
  };
}

/**
 * ProjectClosurePDFService
 * 
 * Generates professional PDF closure reports for projects.
 * Uses PDFKit for PDF generation with company branding.
 */
export class ProjectClosurePDFService {
  /**
   * Generate project closure PDF report
   * Returns a readable stream that can be piped to response or file
   */
  generateClosureReport(data: ProjectClosureData): Readable {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Project Closure Report - ${data.project.code}`,
        Author: 'Metrika PMO System',
        Subject: `Closure report for project ${data.project.name}`,
        Keywords: 'project, closure, report, pmo',
      },
    });

    // Header
    this.addHeader(doc, data);

    // Project Information Section
    this.addProjectInfo(doc, data);

    // Statistics Section
    this.addStatistics(doc, data);

    // Timeline Section
    this.addTimeline(doc, data);

    // Footer
    this.addFooter(doc);

    // Finalize PDF
    doc.end();

    return doc as unknown as Readable;
  }

  private addHeader(doc: PDFDoc, data: ProjectClosureData) {
    // Company Name
    doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .text('METRIKA', 50, 50)
      .fontSize(10)
      .font('Helvetica')
      .text('Project Management Office', 50, 80);

    // Report Title
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('PROJECT CLOSURE REPORT', 50, 120, { align: 'center' })
      .moveDown(0.5);

    // Project Code
    doc
      .fontSize(12)
      .font('Helvetica')
      .fillColor('#666666')
      .text(data.project.code, { align: 'center' })
      .fillColor('#000000')
      .moveDown(2);
  }

  private addProjectInfo(doc: PDFDoc, data: ProjectClosureData) {
    const y = doc.y;

    // Section Title
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Project Information', 50, y)
      .moveDown(0.5);

    // Draw separator line
    doc
      .strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
      .moveDown(1);

    const infoY = doc.y;
    doc.fontSize(10).font('Helvetica');

    // Left column
    const leftX = 70;
    let currentY = infoY;

    doc
      .font('Helvetica-Bold')
      .text('Project Name:', leftX, currentY);
    doc
      .font('Helvetica')
      .text(data.project.name, leftX + 100, currentY, { width: 200 });

    currentY += 20;
    doc
      .font('Helvetica-Bold')
      .text('Description:', leftX, currentY);
    doc
      .font('Helvetica')
      .text(data.project.description || 'N/A', leftX + 100, currentY, { 
        width: 200,
        height: 40,
      });

    currentY += 60;
    doc
      .font('Helvetica-Bold')
      .text('Status:', leftX, currentY);
    doc
      .font('Helvetica')
      .fillColor(data.project.status === 'CLOSED' ? '#28a745' : '#6c757d')
      .text(data.project.status, leftX + 100, currentY)
      .fillColor('#000000');

    // Right column
    const rightX = 320;
    currentY = infoY;

    doc
      .font('Helvetica-Bold')
      .text('Start Date:', rightX, currentY);
    doc
      .font('Helvetica')
      .text(this.formatDate(data.project.startDate), rightX + 80, currentY);

    currentY += 20;
    doc
      .font('Helvetica-Bold')
      .text('End Date:', rightX, currentY);
    doc
      .font('Helvetica')
      .text(
        data.project.actualEnd ? this.formatDate(data.project.actualEnd) : 'N/A',
        rightX + 80,
        currentY
      );

    currentY += 20;
    doc
      .font('Helvetica-Bold')
      .text('Duration:', rightX, currentY);
    doc
      .font('Helvetica')
      .text(`${data.project.durationDays} days`, rightX + 80, currentY);

    currentY += 20;
    doc
      .font('Helvetica-Bold')
      .text('Budget:', rightX, currentY);
    doc
      .font('Helvetica')
      .text(
        data.project.budgetPlanned
          ? `$${Number(data.project.budgetPlanned).toLocaleString()}`
          : 'N/A',
        rightX + 80,
        currentY
      );

    doc.moveDown(6);
  }

  private addStatistics(doc: PDFDoc, data: ProjectClosureData) {
    const y = doc.y;

    // Section Title
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Project Statistics', 50, y)
      .moveDown(0.5);

    // Draw separator line
    doc
      .strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
      .moveDown(1);

    const statsY = doc.y;

    // Statistics boxes
    const boxWidth = 145;
    const boxHeight = 80;
    const boxPadding = 10;
    const startX = 50;

    const stats = [
      {
        label: 'Total Tasks',
        value: data.statistics.totalTasks.toString(),
        color: '#007bff',
      },
      {
        label: 'Completed',
        value: data.statistics.completedTasks.toString(),
        color: '#28a745',
      },
      {
        label: 'Cancelled',
        value: data.statistics.cancelledTasks.toString(),
        color: '#dc3545',
      },
      {
        label: 'Completion Rate',
        value: `${data.statistics.completionRate.toFixed(1)}%`,
        color: '#17a2b8',
      },
    ];

    stats.forEach((stat, index) => {
      const x = startX + (index % 3) * (boxWidth + 15);
      const y = statsY + Math.floor(index / 3) * (boxHeight + 15);

      // Draw box
      doc
        .rect(x, y, boxWidth, boxHeight)
        .fillAndStroke('#f8f9fa', '#dee2e6');

      // Draw colored top bar
      doc
        .rect(x, y, boxWidth, 5)
        .fill(stat.color);

      // Label
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#6c757d')
        .text(stat.label, x + boxPadding, y + 20, {
          width: boxWidth - boxPadding * 2,
          align: 'center',
        });

      // Value
      doc
        .fontSize(24)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text(stat.value, x + boxPadding, y + 40, {
          width: boxWidth - boxPadding * 2,
          align: 'center',
        });
    });

    // Additional stats
    doc.y = statsY + boxHeight + 30;
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#000000')
      .text(`Total Documents: ${data.statistics.totalDocuments}`, 70, doc.y)
      .text(`Team Members: ${data.statistics.totalMembers}`, 320, doc.y - 12);

    doc.moveDown(3);
  }

  private addTimeline(doc: PDFDoc, data: ProjectClosureData) {
    const y = doc.y;

    // Section Title
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Project Timeline', 50, y)
      .moveDown(0.5);

    // Draw separator line
    doc
      .strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke()
      .moveDown(1);

    const timelineY = doc.y;
    const lineY = timelineY + 30;

    // Timeline line
    doc
      .strokeColor('#007bff')
      .lineWidth(3)
      .moveTo(100, lineY)
      .lineTo(500, lineY)
      .stroke();

    // Start point
    doc
      .circle(100, lineY, 8)
      .fillAndStroke('#28a745', '#28a745');

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('START', 85, lineY + 15)
      .fontSize(8)
      .font('Helvetica')
      .text(this.formatDate(data.project.startDate), 70, lineY + 30);

    // End point
    doc
      .circle(500, lineY, 8)
      .fillAndStroke('#dc3545', '#dc3545');

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('END', 490, lineY + 15)
      .fontSize(8)
      .font('Helvetica')
      .text(
        data.project.actualEnd ? this.formatDate(data.project.actualEnd) : 'Ongoing',
        470,
        lineY + 30
      );

    // Duration label
    doc
      .fontSize(10)
      .font('Helvetica-Oblique')
      .fillColor('#6c757d')
      .text(`${data.project.durationDays} days`, 250, lineY - 20, {
        align: 'center',
        width: 100,
      });

    doc.moveDown(5);
  }

  private addFooter(doc: PDFDoc) {
    const bottomMargin = 50;
    const footerY = 792 - bottomMargin - 30; // A4 height - margin - footer height

    // Separator line
    doc
      .strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(50, footerY)
      .lineTo(545, footerY)
      .stroke();

    // Footer text
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#6c757d')
      .text('Generated by Metrika PMO System', 50, footerY + 10)
      .text(
        `Report Date: ${this.formatDate(new Date())}`,
        0,
        footerY + 10,
        { align: 'right', width: 545 }
      );

    // Confidentiality notice
    doc
      .fontSize(7)
      .text(
        'This document contains confidential project information.',
        50,
        footerY + 25,
        { align: 'center', width: 495 }
      );
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
