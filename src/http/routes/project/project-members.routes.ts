import { Router } from 'express';
import type { ProjectMembersController } from '../../controllers/project/project-members.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export const createProjectMembersRouter = (controller: ProjectMembersController): Router => {
  const router = Router({ mergeParams: true });

  router.post('/', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.addMember);
  router.get('/', requirePermissions(PERMISSIONS.PROJECT_READ), controller.listMembers);

  return router;
};

export const createMembersRouter = (controller: ProjectMembersController): Router => {
  const router = Router();

  router.get('/:memberId', requirePermissions(PERMISSIONS.PROJECT_READ), controller.getMember);
  router.patch('/:memberId', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.updateMember);
  router.delete('/:memberId', requirePermissions(PERMISSIONS.PROJECT_WRITE), controller.removeMember);

  return router;
};
