import { Router } from 'express';
import type { AuthController } from '../controllers/auth/auth.controller';

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();

  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/change-password', controller.changePassword);

  return router;
};
