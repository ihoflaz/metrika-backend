import { Router } from 'express';
import type { WebhookController } from '../../controllers/notifications/webhook.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export function createWebhookRouter(controller: WebhookController): Router {
  const router = Router();

  router.use(requirePermissions(PERMISSIONS.USER_WRITE));

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.patch('/:webhookId', controller.update);
  router.delete('/:webhookId', controller.delete);

  return router;
}
