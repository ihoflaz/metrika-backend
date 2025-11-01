import { Router } from 'express';
import type { ProjectsController } from '../../controllers/project/projects.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export const createProjectRouter = (controller: ProjectsController): Router => {
  const router = Router();

  router.post('/', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.create);
  router.get('/', requirePermissions(PERMISSIONS.PROJECT_READ), controller.list);
  router.get('/:projectId', requirePermissions(PERMISSIONS.PROJECT_READ), controller.getById);
  router.patch('/:projectId', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.update);
  router.post('/:projectId/close', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.close);

  return router;
};
