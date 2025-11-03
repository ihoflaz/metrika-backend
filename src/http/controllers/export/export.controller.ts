import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TaskExportService } from '../../../modules/export/task-export.service';
import { PortfolioExportService } from '../../../modules/export/portfolio-export.service';
import { KPIExportService } from '../../../modules/export/kpi-export.service';
import { TaskMetricsExportService } from '../../../modules/export/task-metrics-export.service';
import { ExportFormat, ExportType, ExportFilters, ExportMetadata } from '../../../modules/export/export.types';
import { logger } from '../../../lib/logger';
import { createPrismaClient } from '../../../db/prisma-client';
import { loadAppConfig } from '../../../config/app-config';
import { PrismaClient } from '@prisma/client';

// Lazy initialization to support test environment
let prisma: PrismaClient | null = null;
let taskExportService: TaskExportService | null = null;
let portfolioExportService: PortfolioExportService | null = null;
let kpiExportService: KPIExportService | null = null;
let taskMetricsExportService: TaskMetricsExportService | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    const config = loadAppConfig();
    prisma = createPrismaClient(config);
  }
  return prisma;
}

function getTaskExportService(): TaskExportService {
  if (!taskExportService) {
    taskExportService = new TaskExportService(logger, getPrisma());
  }
  return taskExportService;
}

function getPortfolioExportService(): PortfolioExportService {
  if (!portfolioExportService) {
    portfolioExportService = new PortfolioExportService(getPrisma(), logger);
  }
  return portfolioExportService;
}

function getKPIExportService(): KPIExportService {
  if (!kpiExportService) {
    kpiExportService = new KPIExportService(getPrisma(), logger);
  }
  return kpiExportService;
}

function getTaskMetricsExportService(): TaskMetricsExportService {
  if (!taskMetricsExportService) {
    taskMetricsExportService = new TaskMetricsExportService(getPrisma(), logger);
  }
  return taskMetricsExportService;
}

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

    const result = await getTaskExportService().exportTasks({
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

    const result = await getTaskExportService().exportTasks({
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

/**
 * Export Portfolio Summary to Excel or PDF
 * 
 * Generates comprehensive portfolio report including:
 * - Overall statistics (projects, tasks, completion rates)
 * - Budget overview
 * - KPI performance
 * - Detailed project listing
 * 
 * Query Parameters:
 * - format: 'excel' (default) or 'pdf'
 */
export async function exportPortfolioSummary(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { authUser } = res.locals;

    if (!authUser || !authUser.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Get format from query parameter (default to excel)
    const format = (req.query.format as string || 'excel').toLowerCase();
    const isPDF = format === 'pdf';

    logger.info(
      { userId: authUser.id, format },
      '[ExportController] Exporting portfolio summary'
    );

    // Call appropriate export method based on format
    const result = isPDF
      ? await getPortfolioExportService().exportPortfolioSummaryPDF(authUser.id)
      : await getPortfolioExportService().exportPortfolioSummary(authUser.id);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Portfolio export failed',
      });
    }

    // Set response headers for file download
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`
    );
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    logger.error({ error }, '[ExportController] Portfolio export failed');
    next(error);
  }
}

/**
 * Export KPI Dashboard to Excel or PDF
 * 
 * Generates KPI dashboard report including:
 * - Overall KPI statistics
 * - Performance by category
 * - List of all KPIs with latest values
 * - Deviation analysis
 * 
 * Query Parameters:
 * - format: 'excel' (default) or 'pdf'
 */
export async function exportKPIDashboard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { authUser } = res.locals;

    if (!authUser || !authUser.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Get format from query parameter (default to excel)
    const format = (req.query.format as string || 'excel').toLowerCase();
    const isPDF = format === 'pdf';

    logger.info(
      { userId: authUser.id, format },
      '[ExportController] Exporting KPI dashboard'
    );

    // Call appropriate export method based on format
    const result = isPDF
      ? await getKPIExportService().exportKPIDashboardPDF(authUser.id)
      : await getKPIExportService().exportKPIDashboard(authUser.id);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'KPI dashboard export failed',
      });
    }

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    logger.error({ error }, '[ExportController] KPI dashboard export failed');
    next(error);
  }
}

/**
 * Export Single KPI Report to Excel
 * 
 * Generates detailed KPI report including:
 * - KPI overview (definition, targets, thresholds)
 * - Historical data series
 * - Statistical analysis
 * - Performance trends
 */
export async function exportSingleKPI(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { authUser } = res.locals;
    const { kpiId } = req.params;

    if (!authUser || !authUser.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    logger.info({ userId: authUser.id, kpiId }, '[ExportController] Exporting single KPI');

    // Debug: Check if KPI exists
    const kpiCheck = await getPrisma().kPIDefinition.findUnique({ where: { id: kpiId } });
    logger.info({ kpiId, exists: !!kpiCheck }, '[ExportController] KPI existence check');

    const result = await getKPIExportService().exportSingleKPI(kpiId, authUser.id);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error || 'KPI export failed',
      });
    }

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    logger.error({ error }, '[ExportController] Single KPI export failed');
    next(error);
  }
}

/**
 * Export Task Metrics to Excel
 * 
 * Generates task metrics report including:
 * - Overall task statistics
 * - Distribution by status and priority
 * - Completion rates by project
 * - Delay analysis
 * - Detailed task listing
 */
export async function exportTaskMetrics(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { authUser } = res.locals;

    if (!authUser || !authUser.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Parse filters from query params
    const filters: any = {};
    if (req.query.projectId) filters.projectId = req.query.projectId as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.priority) filters.priority = req.query.priority as string;
    if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

    logger.info({ userId: authUser.id, filters }, '[ExportController] Exporting task metrics');

    const result = await getTaskMetricsExportService().exportTaskMetrics(authUser.id, filters);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Task metrics export failed',
      });
    }

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.size);

    res.send(result.buffer);
  } catch (error) {
    logger.error({ error }, '[ExportController] Task metrics export failed');
    next(error);
  }
}
