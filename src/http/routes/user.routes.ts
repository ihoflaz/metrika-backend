import { Router } from 'express';
import type { UsersController } from '../controllers/user/users.controller';
import type { ApiKeysController } from '../controllers/user/api-keys.controller';
import { requirePermissions } from '../middleware/auth/authentication';
import { PERMISSIONS } from '../../modules/rbac/permissions';
import * as unsubscribeController from '../controllers/notifications/unsubscribe.controller';

export const createUserRouter = (deps: {
  usersController: UsersController;
  apiKeysController: ApiKeysController;
}): Router => {
  const router = Router();

  // Nested API key routes (legacy: /api/v1/users/api-keys/*)
  router.post('/api-keys', (req, res, next) => deps.apiKeysController.createApiKey(req, res, next));
  router.get('/api-keys', (req, res, next) => deps.apiKeysController.listApiKeys(req, res, next));
  router.get('/api-keys/:id', (req, res, next) => deps.apiKeysController.getApiKey(req, res, next));
  router.delete('/api-keys/:id', (req, res, next) => deps.apiKeysController.revokeApiKey(req, res, next));
  router.post('/api-keys/:id/regenerate', (req, res, next) =>
    deps.apiKeysController.regenerateApiKey(req, res, next),
  );

  router.get('/', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.list);
  router.post('/', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.create);

  router.get('/me', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.me);
  router.get('/me/email-logs', requirePermissions(PERMISSIONS.USER_READ), unsubscribeController.getEmailLogs);

  router.get('/:id', requirePermissions(PERMISSIONS.USER_READ), deps.usersController.getById);
  router.patch('/:id', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.update);
  router.delete('/:id', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.deactivate);
  router.post('/:id/activate', requirePermissions(PERMISSIONS.USER_WRITE), deps.usersController.activate);

  return router;
};
