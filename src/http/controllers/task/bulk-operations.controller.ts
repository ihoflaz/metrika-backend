import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TaskStatus, TaskPriority } from '@prisma/client';
import { createBulkOperationsService } from '../../../modules/tasks/bulk-operations.service';

// Helper to get Prisma from request (via container in res.locals)
function getPrismaFromRequest(res: Response) {
  // In production, use container from res.locals if available
  // Otherwise fall back to singleton
  if (res.locals.container) {
    return res.locals.container.resolve('prisma');
  }
  // Fallback: create new client with current DATABASE_URL
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient();
}

// Validation schemas
const bulkUpdateSchema = z.object({
  taskIds: z.array(z.string()).min(1, 'At least one task ID required'),
  data: z.object({
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(TaskPriority).optional(),
    ownerId: z.string().uuid().optional(),
    plannedStartDate: z.coerce.date().optional(),
    plannedEndDate: z.coerce.date().optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
  }),
});

const bulkDeleteSchema = z.object({
  taskIds: z.array(z.string()).min(1, 'At least one task ID required'),
  hardDelete: z.boolean().optional().default(false),
});

const bulkChangeStatusSchema = z.object({
  taskIds: z.array(z.string()).min(1, 'At least one task ID required'),
  newStatus: z.nativeEnum(TaskStatus),
  comment: z.string().optional(),
});

const bulkWatchersSchema = z.object({
  taskIds: z.array(z.string()).min(1, 'At least one task ID required'),
  userIds: z.array(z.string()).min(1, 'At least one user ID required'),
});

/**
 * POST /api/v1/tasks/bulk/update
 * Bulk update tasks
 */
export async function bulkUpdateTasks(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = bulkUpdateSchema.parse(req.body);
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const result = await bulkOperationsService.bulkUpdateTasks(input);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/tasks/bulk/delete
 * Bulk delete tasks (soft or hard)
 */
export async function bulkDeleteTasks(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = bulkDeleteSchema.parse(req.body);
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const result = await bulkOperationsService.bulkDeleteTasks(input);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/tasks/bulk/change-status
 * Bulk change task status
 */
export async function bulkChangeStatus(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = bulkChangeStatusSchema.parse(req.body);
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const result = await bulkOperationsService.bulkChangeStatus({
      ...input,
      userId: res.locals.authUser.id,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/tasks/bulk/add-watchers
 * Bulk add watchers to tasks
 */
export async function bulkAddWatchers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = bulkWatchersSchema.parse(req.body);
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const result = await bulkOperationsService.bulkAddWatchers(
      input.taskIds,
      input.userIds
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/tasks/bulk/remove-watchers
 * Bulk remove watchers from tasks
 */
export async function bulkRemoveWatchers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = bulkWatchersSchema.parse(req.body);
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const result = await bulkOperationsService.bulkRemoveWatchers(
      input.taskIds,
      input.userIds
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/projects/:projectId/bulk-stats
 * Get bulk operation statistics for a project
 */
export async function getBulkOperationStats(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { projectId } = req.params;
    const prisma = getPrismaFromRequest(res);
    const bulkOperationsService = createBulkOperationsService(prisma);

    const stats = await bulkOperationsService.getBulkOperationStats(projectId);

    res.json(stats);
  } catch (error) {
    next(error);
  }
}
