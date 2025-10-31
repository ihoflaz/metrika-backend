import express, {
  type NextFunction,
  type Request,
  type Response,
  type RequestHandler,
  type Router,
} from 'express';
import type { AppConfig } from '../config/app-config';
import type { Logger } from '../lib/logger';
import { createHealthRouter } from './routes/health.routes';
import { createErrorHandler } from './middleware/error-handler';
import { getRequestId, requestContextMiddleware } from './middleware/request-context';

export interface CreateAppOptions {
  logger: Logger;
  config: AppConfig;
  authRouter: Router;
  userRouter: Router;
  authMiddleware: RequestHandler;
}

export const createApp = ({
  logger,
  config,
  authRouter,
  userRouter,
  authMiddleware,
}: CreateAppOptions) => {
  const app = express();

  app.disable('x-powered-by');
  app.locals.config = config;
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(
      {
        requestId: getRequestId(res),
        method: req.method,
        path: req.path,
      },
      'Handling incoming request',
    );
    next();
  });

  app.use('/', createHealthRouter());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', authMiddleware, userRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      errors: [
        {
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'The requested resource could not be found',
        },
      ],
      meta: { requestId: getRequestId(res) },
    });
  });

  app.use(createErrorHandler(logger));

  return app;
};
