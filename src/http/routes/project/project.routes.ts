import { Router } from 'express';
import type { ProjectsController } from '../../controllers/project/projects.controller';
import type { ProjectCloneController } from '../../controllers/project/project-clone.controller';
import type { KanbanController } from '../../controllers/project/kanban.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export const createProjectRouter = (
  controller: ProjectsController,
  cloneController: ProjectCloneController,
  kanbanController: KanbanController
): Router => {
  const router = Router();

  router.post('/', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.create);
  router.get('/', requirePermissions(PERMISSIONS.PROJECT_READ), controller.list);
  
  // Search endpoint (MUST come before /:projectId to avoid route conflicts)
  router.get('/search', requirePermissions(PERMISSIONS.PROJECT_READ), controller.searchProjects);
  
  // Clone & Template routes (MUST come before /:projectId to avoid route conflicts)
  router.get(
    '/templates/list',
    requirePermissions(PERMISSIONS.PROJECT_READ),
    cloneController.listTemplates.bind(cloneController)
  );
  router.post(
    '/templates/:templateId/clone',
    requirePermissions(PERMISSIONS.PROJECT_WRITE),
    cloneController.cloneFromTemplate.bind(cloneController)
  );

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

  // Project-specific clone routes
  router.post(
    '/:projectId/clone',
    requirePermissions(PERMISSIONS.PROJECT_WRITE),
    cloneController.cloneProject.bind(cloneController)
  );
  router.post(
    '/:projectId/mark-as-template',
    requirePermissions(PERMISSIONS.PROJECT_WRITE),
    cloneController.markAsTemplate.bind(cloneController)
  );

  return router;
};
