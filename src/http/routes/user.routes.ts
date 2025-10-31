import { Router } from 'express';
import type { UsersController } from '../controllers/user/users.controller';
import { requirePermissions } from '../middleware/auth/authentication';
import { PERMISSIONS } from '../../modules/rbac/permissions';

export const createUserRouter = (controller: UsersController): Router => {
  const router = Router();

  router.get('/me', requirePermissions(PERMISSIONS.USER_READ), controller.me);

  return router;
};
