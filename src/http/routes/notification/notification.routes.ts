import { Router } from 'express';
import type { UserNotificationsController } from '../../controllers/notifications/notifications.controller';

export function createNotificationsRouter(controller: UserNotificationsController): Router {
  const router = Router();

  router.get('/', controller.list);
  router.post('/read-all', controller.markAllRead);
  router.post('/:notificationId/read', controller.markRead);
  router.post('/:notificationId/archive', controller.archive);

  return router;
}
