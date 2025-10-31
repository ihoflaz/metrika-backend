import { Router } from 'express';
import type { AuthController } from '../controllers/auth/auth.controller';

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();

  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);

  return router;
};
