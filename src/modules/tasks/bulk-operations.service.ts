import { PrismaClient, TaskStatus, TaskPriority } from '@prisma/client';
import { createLogger } from '../../lib/logger';

const logger = createLogger({ name: 'BulkOperationsService' });

// UUID validation regex
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/**
 * Validate and filter task IDs
 * Returns { validIds, invalidIds }
 */
function validateTaskIds(taskIds: string[]): { validIds: string[]; invalidIds: string[] } {
  const validIds: string[] = [];
  const invalidIds: string[] = [];

  for (const id of taskIds) {
    if (UUID_REGEX.test(id)) {
      validIds.push(id);
    } else {
      invalidIds.push(id);
    }
  }

  return { validIds, invalidIds };
}

export interface BulkUpdateInput {
  taskIds: string[];
  data: {
    status?: TaskStatus;
    priority?: TaskPriority;
    ownerId?: string;
    plannedStartDate?: Date;
    plannedEndDate?: Date;
    progressPct?: number;
  };
}

export interface BulkDeleteInput {
  taskIds: string[];
  hardDelete?: boolean; // true: permanent delete, false: soft delete (status=CANCELLED)
}

export interface BulkChangeStatusInput {
  taskIds: string[];
  newStatus: TaskStatus;
  comment?: string;
  userId: string;
}

export interface BulkOperationResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{
    taskId: string;
    error: string;
  }>;
  results?: any[];
}

/**
 * Bulk Operations Service
 * 
 * Provides bulk operations for tasks with:
 * - Transaction safety (all-or-nothing)
 * - Partial failure handling (continue on error)
 * - Detailed error reporting
 * - Audit logging
 */
export class BulkOperationsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Bulk update tasks
   * Uses transaction to ensure atomicity
   */
  async bulkUpdateTasks(input: BulkUpdateInput): Promise<BulkOperationResult> {
    const { taskIds, data } = input;
    
    logger.info({ taskIds, data }, 'Starting bulk update');

    try {
      // Validate UUIDs
      const { validIds, invalidIds } = validateTaskIds(taskIds);

      if (invalidIds.length > 0) {
        logger.warn({ invalidIds }, 'Invalid UUIDs provided');
      }

      if (validIds.length === 0) {
        return {
          success: false,
          processed: 0,
          failed: invalidIds.length,
          errors: invalidIds.map((id) => ({ taskId: id, error: 'Invalid UUID format' })),
        };
      }

      // Validate task IDs exist
      const existingTasks = await this.prisma.task.findMany({
        where: { id: { in: validIds } },
        select: { id: true },
      });

      const existingIds = new Set(existingTasks.map((t) => t.id));
      const missingIds = validIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        logger.warn({ missingIds }, 'Some task IDs not found');
      }

      // Perform bulk update in transaction
      const results = await this.prisma.$transaction(
        existingTasks.map((task) =>
          this.prisma.task.update({
            where: { id: task.id },
            data,
          })
        )
      );

      logger.info(
        { updated: results.length },
        'Bulk update completed successfully'
      );

      return {
        success: true,
        processed: results.length,
        failed: missingIds.length + invalidIds.length,
        errors: [
          ...invalidIds.map((id) => ({ taskId: id, error: 'Invalid UUID format' })),
          ...missingIds.map((id) => ({ taskId: id, error: 'Task not found' })),
        ],
        results,
      };
    } catch (error) {
      logger.error({ error, taskIds }, 'Bulk update failed');
      throw error;
    }
  }

  /**
   * Bulk delete tasks
   * Supports both hard delete and soft delete (status=CANCELLED)
   */
  async bulkDeleteTasks(input: BulkDeleteInput): Promise<BulkOperationResult> {
    const { taskIds, hardDelete = false } = input;

    logger.info({ taskIds, hardDelete }, 'Starting bulk delete');

    try {
      if (hardDelete) {
        // Hard delete: Remove from database
        // First delete dependencies
        await this.prisma.taskDependency.deleteMany({
          where: {
            OR: [
              { taskId: { in: taskIds } },
              { dependsOnTaskId: { in: taskIds } },
            ],
          },
        });

        // Delete task watchers
        await this.prisma.taskWatcher.deleteMany({
          where: { taskId: { in: taskIds } },
        });

        // Delete task comments
        await this.prisma.taskComment.deleteMany({
          where: { taskId: { in: taskIds } },
        });

        // Finally delete tasks
        const result = await this.prisma.task.deleteMany({
          where: { id: { in: taskIds } },
        });

        logger.info({ deleted: result.count }, 'Hard delete completed');

        return {
          success: true,
          processed: result.count,
          failed: 0,
          errors: [],
        };
      } else {
        // Soft delete: Set status to CANCELLED
        const errors: Array<{ taskId: string; error: string }> = [];
        let processed = 0;

        for (const taskId of taskIds) {
          try {
            await this.prisma.task.update({
              where: { id: taskId },
              data: {
                status: 'CANCELLED',
              },
            });
            processed++;
          } catch (error: any) {
            errors.push({ taskId, error: error.message });
          }
        }

        logger.info({ cancelled: processed }, 'Soft delete completed');

        return {
          success: errors.length === 0,
          processed,
          failed: errors.length,
          errors,
        };
      }
    } catch (error) {
      logger.error({ error, taskIds }, 'Bulk delete failed');
      throw error;
    }
  }

  /**
   * Bulk change task status
   * With optional comment for audit trail
   */
  async bulkChangeStatus(
    input: BulkChangeStatusInput
  ): Promise<BulkOperationResult> {
    const { taskIds, newStatus, comment, userId } = input;

    logger.info({ taskIds, newStatus, comment }, 'Starting bulk status change');

    try {
      const results = await this.prisma.$transaction(
        taskIds.map((taskId) =>
          this.prisma.task.update({
            where: { id: taskId },
            data: {
              status: newStatus,
              // Add timestamp fields based on status
              ...(newStatus === 'IN_PROGRESS' && {
                actualStart: new Date(),
              }),
              ...(newStatus === 'COMPLETED' && {
                actualEnd: new Date(),
                progressPct: 100,
              }),
            },
          })
        )
      );

      // If comment provided, add to all tasks
      if (comment) {
        await this.prisma.$transaction(
          taskIds.map((taskId) =>
            this.prisma.taskComment.create({
              data: {
                id: crypto.randomUUID(),
                taskId,
                authorId: userId,
                body: `[Bulk Status Change] ${comment}`,
              },
            })
          )
        );
      }

      logger.info(
        { updated: results.length, newStatus },
        'Bulk status change completed'
      );

      return {
        success: true,
        processed: results.length,
        failed: 0,
        errors: [],
        results,
      };
    } catch (error) {
      logger.error({ error, taskIds, newStatus }, 'Bulk status change failed');
      throw error;
    }
  }

  /**
   * Bulk add watchers to tasks
   */
  async bulkAddWatchers(
    taskIds: string[],
    userIds: string[]
  ): Promise<BulkOperationResult> {
    logger.info({ taskIds, userIds }, 'Starting bulk add watchers');

    const errors: Array<{ taskId: string; error: string }> = [];
    let processed = 0;

    try {
      for (const taskId of taskIds) {
        try {
          await this.prisma.taskWatcher.createMany({
            data: userIds.map((userId) => ({
              id: crypto.randomUUID(),
              taskId,
              userId,
            })),
            skipDuplicates: true,
          });

          processed++;
        } catch (error: any) {
          errors.push({
            taskId,
            error: error.message || 'Unknown error',
          });
        }
      }

      logger.info(
        { added: processed, failed: errors.length },
        'Bulk add watchers completed'
      );

      return {
        success: errors.length === 0,
        processed,
        failed: errors.length,
        errors,
      };
    } catch (error) {
      logger.error({ error, taskIds, userIds }, 'Bulk add watchers failed');
      throw error;
    }
  }

  /**
   * Bulk remove watchers from tasks
   */
  async bulkRemoveWatchers(
    taskIds: string[],
    userIds: string[]
  ): Promise<BulkOperationResult> {
    logger.info({ taskIds, userIds }, 'Starting bulk remove watchers');

    try {
      const result = await this.prisma.taskWatcher.deleteMany({
        where: {
          taskId: { in: taskIds },
          userId: { in: userIds },
        },
      });

      logger.info({ removed: result.count }, 'Bulk remove watchers completed');

      return {
        success: true,
        processed: result.count,
        failed: 0,
        errors: [],
      };
    } catch (error) {
      logger.error({ error, taskIds, userIds }, 'Bulk remove watchers failed');
      throw error;
    }
  }

  /**
   * Get bulk operation statistics
   */
  async getBulkOperationStats(projectId: string): Promise<any> {
    const [totalTasks, byStatus, byPriority] = await Promise.all([
      // Total tasks
      this.prisma.task.count({
        where: { projectId },
      }),

      // Tasks by status
      this.prisma.task.groupBy({
        by: ['status'],
        where: { projectId },
        _count: true,
      }),

      // Tasks by priority
      this.prisma.task.groupBy({
        by: ['priority'],
        where: { projectId },
        _count: true,
      }),
    ]);

    return {
      total: totalTasks,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        _count: s._count,
      })),
      byPriority: byPriority.map((p) => ({
        priority: p.priority,
        _count: p._count,
      })),
    };
  }
}

// Export factory function for DI container
export function createBulkOperationsService(prisma: PrismaClient): BulkOperationsService {
  return new BulkOperationsService(prisma);
}

// Legacy singleton for backwards compatibility
// Note: This uses a separate Prisma instance. For tests, use the factory function with test context's Prisma.
const defaultPrisma = new PrismaClient();
export const bulkOperationsService = new BulkOperationsService(defaultPrisma);
