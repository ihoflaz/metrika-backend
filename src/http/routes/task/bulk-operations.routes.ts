import { Router } from 'express';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';
import * as bulkOpsController from '../../controllers/task/bulk-operations.controller';

const router = Router();

/**
 * Bulk Operations Routes
 * 
 * All bulk operations require TASK_WRITE permission
 * and operate on multiple tasks at once.
 */

// POST /api/v1/tasks/bulk/update
router.post(
  '/update',
  requirePermissions(PERMISSIONS.TASK_WRITE),
  bulkOpsController.bulkUpdateTasks
);

// POST /api/v1/tasks/bulk/delete
router.post(
  '/delete',
  requirePermissions(PERMISSIONS.TASK_WRITE), // Requires write permission
  bulkOpsController.bulkDeleteTasks
);

// POST /api/v1/tasks/bulk/change-status
router.post(
  '/change-status',
  requirePermissions(PERMISSIONS.TASK_WRITE),
  bulkOpsController.bulkChangeStatus
);

// POST /api/v1/tasks/bulk/add-watchers
router.post(
  '/add-watchers',
  requirePermissions(PERMISSIONS.TASK_WRITE),
  bulkOpsController.bulkAddWatchers
);

// POST /api/v1/tasks/bulk/remove-watchers
router.post(
  '/remove-watchers',
  requirePermissions(PERMISSIONS.TASK_WRITE),
  bulkOpsController.bulkRemoveWatchers
);

// GET /api/v1/projects/:projectId/bulk-stats
router.get(
  '/stats/:projectId',
  requirePermissions(PERMISSIONS.PROJECT_READ),
  bulkOpsController.getBulkOperationStats
);

export default router;
