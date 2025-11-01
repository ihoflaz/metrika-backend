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
  projectRouter: Router;
  projectMembersRouter: Router;
  membersRouter: Router;
  projectTaskRouter: Router;
  projectDocumentRouter: Router;
  documentRouter: Router;
  taskRouter: Router;
  kpiRouter: Router;
  authMiddleware: RequestHandler;
}

export const createApp = ({
  logger,
  config,
  authRouter,
  userRouter,
  projectRouter,
  projectMembersRouter,
  membersRouter,
  projectTaskRouter,
  projectDocumentRouter,
  documentRouter,
  taskRouter,
  kpiRouter,
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
  app.use('/api/v1/projects', authMiddleware, projectRouter);
  app.use('/api/v1/projects/:projectId/members', authMiddleware, projectMembersRouter);
  app.use('/api/v1/members', authMiddleware, membersRouter);
  app.use('/api/v1/projects/:projectId/tasks', authMiddleware, projectTaskRouter);
  app.use('/api/v1/projects/:projectId/documents', authMiddleware, projectDocumentRouter);
  app.use('/api/v1/documents', authMiddleware, documentRouter);
  app.use('/api/v1/tasks', authMiddleware, taskRouter);
  app.use('/api/v1/kpis', authMiddleware, kpiRouter);

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
