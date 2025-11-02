import express, {
  type NextFunction,
  type Request,
  type Response,
  type RequestHandler,
  type Router,
} from 'express';
import cors from 'cors';
import type { AwilixContainer } from 'awilix';
import type { AppConfig } from '../config/app-config';
import type { Logger } from '../lib/logger';
import { createHealthRouter } from './routes/health.routes';
import { createErrorHandler } from './middleware/error-handler';
import { getRequestId, requestContextMiddleware } from './middleware/request-context';

export interface CreateAppOptions {
  logger: Logger;
  config: AppConfig;
  container: AwilixContainer;
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
  reportsRouter: Router;
  auditRouter: Router;
  queueRouter: Router;
  kanbanRouter: Router;
  exportRouter: Router;
  monitoringRouter: Router;
  unsubscribeRouter: Router;
  authMiddleware: RequestHandler;
}

export const createApp = ({
  logger,
  config,
  container,
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
  reportsRouter,
  auditRouter,
  queueRouter,
  kanbanRouter,
  exportRouter,
  monitoringRouter,
  unsubscribeRouter,
  authMiddleware,
}: CreateAppOptions) => {
  const app = express();

  app.disable('x-powered-by');
  
  // CORS configuration
  const corsOptions: cors.CorsOptions = {
    origin: process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:5173'], // Default for local development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86400, // 24 hours
  };
  app.use(cors(corsOptions));
  
  app.locals.config = config;
  
  // Add container to res.locals for dependency injection
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.container = container;
    next();
  });
  
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
  app.use('/api/v1/unsubscribe', unsubscribeRouter); // Public route - no auth
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
  app.use('/api/v1/reports', authMiddleware, reportsRouter);
  app.use('/api/v1/audit', authMiddleware, auditRouter);
  app.use('/api/v1/queues', authMiddleware, queueRouter);
  app.use('/api/v1/projects/:projectId/kanban', authMiddleware, kanbanRouter);
  app.use('/api/v1/export', authMiddleware, exportRouter);
  app.use('/api/v1/monitoring/queues', authMiddleware, monitoringRouter);

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
