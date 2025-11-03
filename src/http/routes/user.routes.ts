import { Router } from 'express';
import type { UsersController } from '../controllers/user/users.controller';
import { requirePermissions } from '../middleware/auth/authentication';
import { PERMISSIONS } from '../../modules/rbac/permissions';
import type { AppDependencies } from '../../di/container';
import * as unsubscribeController from '../controllers/notifications/unsubscribe.controller';

export const createUserRouter = (deps: { usersController: UsersController; apiKeysRouter: Router }): Router => {
  const router = Router();

  router.get('/', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.list);
  router.post('/', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.create);

  router.get('/me', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.me);
  router.get('/me/email-logs', requirePermissions(PERMISSIONS.USER_READ), unsubscribeController.getEmailLogs);

  router.get('/:id', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.getById);
  router.patch('/:id', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.update);
  router.delete('/:id', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.deactivate);
  router.post('/:id/activate', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.activate);

  router.use('/api-keys', deps.apiKeysRouter);

  return router;
};
