import { Router } from 'express';
import type { ProjectsController } from '../../controllers/project/projects.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';
import * as kanbanController from '../../controllers/project/kanban.controller';

export const createProjectRouter = (controller: ProjectsController): Router => {
  const router = Router();

  router.post('/', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.create);
  router.get('/', requirePermissions(PERMISSIONS.PROJECT_READ), controller.list);
  router.get('/:projectId', requirePermissions(PERMISSIONS.PROJECT_READ), controller.getById);
  router.patch('/:projectId', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.update);
  router.post('/:projectId/close', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.close);
  router.get(
    '/:projectId/closure-report',
    requirePermissions(PERMISSIONS.PROJECT_READ),
    controller.generateClosureReport
  );

  // Kanban routes
  router.get(
    '/:projectId/kanban',
    requirePermissions(PERMISSIONS.PROJECT_READ),
    kanbanController.getKanbanBoard
  );
  router.post(
    '/:projectId/kanban/reorder',
    requirePermissions(PERMISSIONS.PROJECT_WRITE),
    kanbanController.reorderTasks
  );
  router.get(
    '/:projectId/gantt',
    requirePermissions(PERMISSIONS.PROJECT_READ),
    kanbanController.getGanttData
  );

  return router;
};
