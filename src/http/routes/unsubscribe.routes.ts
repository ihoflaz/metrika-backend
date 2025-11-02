import { Router } from 'express';
import * as unsubscribeController from '../controllers/notifications/unsubscribe.controller';

export const createUnsubscribeRouter = (): Router => {
  const router = Router();

  // Public route - no authentication required
  router.get('/:token', unsubscribeController.unsubscribe);

  return router;
};
