import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TaskExportService } from '../../../modules/export/task-export.service';
import { ExportFormat, ExportType, ExportFilters, ExportMetadata } from '../../../modules/export/export.types';
import { logger } from '../../../lib/logger';
import { createPrismaClient } from '../../../db/prisma-client';
import { loadAppConfig } from '../../../config/app-config';

const config = loadAppConfig();
const prisma = createPrismaClient(config);

// Validation schemas
const exportFiltersSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.array(z.string()).optional(),
  priority: z.array(z.string()).optional(),
  ownerId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const exportOptionsSchema = z.object({
  filters: exportFiltersSchema.optional(),
  styling: z
    .object({
      pageSize: z.enum(['A4', 'Letter', 'Legal']).optional(),
      orientation: z.enum(['portrait', 'landscape']).optional(),
    })
    .optional(),
  metadata: z
    .object({
      title: z.string().optional(),
      subject: z.string().optional(),
      author: z.string().optional(),
    })
    .optional(),
}).optional().default({});

// Singleton instance
const taskExportService = new TaskExportService(logger, prisma);

/**
 * Export tasks to Excel
 */
export async function exportTasksToExcel(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = exportOptionsSchema.parse(req.body || {});

    // Convert filters
    const filters: ExportFilters | undefined = body.filters ? {
      projectId: body.filters.projectId,
      status: body.filters.status as any,
      priority: body.filters.priority as any,
      ownerId: body.filters.ownerId,
      startDate: body.filters.startDate ? new Date(body.filters.startDate) : undefined,
      endDate: body.filters.endDate ? new Date(body.filters.endDate) : undefined,
    } : undefined;

    // Convert metadata
    const metadata: ExportMetadata | undefined = body.metadata ? {
      ...body.metadata,
      createdAt: new Date(),
    } : undefined;

    const result = await taskExportService.exportTasks({
      format: ExportFormat.EXCEL,
      type: ExportType.TASKS,
      filters,
      styling: body.styling,
      metadata,
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Export failed',
      });
    }

    // Set response headers for file download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`
    );
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Export tasks to PDF
 */
export async function exportTasksToPDF(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = exportOptionsSchema.parse(req.body || {});

    // Convert filters
    const filters: ExportFilters | undefined = body.filters ? {
      projectId: body.filters.projectId,
      status: body.filters.status as any,
      priority: body.filters.priority as any,
      ownerId: body.filters.ownerId,
      startDate: body.filters.startDate ? new Date(body.filters.startDate) : undefined,
      endDate: body.filters.endDate ? new Date(body.filters.endDate) : undefined,
    } : undefined;

    // Convert metadata
    const metadata: ExportMetadata | undefined = body.metadata ? {
      ...body.metadata,
      createdAt: new Date(),
    } : undefined;

    const result = await taskExportService.exportTasks({
      format: ExportFormat.PDF,
      type: ExportType.TASKS,
      filters,
      styling: body.styling,
      metadata,
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Export failed',
      });
    }

    // Set response headers for file download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`
    );
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
}
