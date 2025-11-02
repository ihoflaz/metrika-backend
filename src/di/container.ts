import { asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix';
import type { RequestHandler, Router } from 'express';
import { loadAppConfig, type AppConfig } from '../config/app-config';
import { initializeEnv } from '../config/env';
import { createLogger, type Logger } from '../lib/logger';
import { createApp } from '../http/app';
import { createPrismaClient, type DatabaseClient } from '../db/prisma-client';
import { TokenService } from '../modules/auth/token.service';
import { AuthService } from '../modules/auth/auth.service';
import { AuditService } from '../modules/audit/audit.service';
import { UserService } from '../modules/users/user.service';
import { ApiKeyService } from '../modules/users/api-key.service';
import { ProjectService } from '../modules/projects/project.service';
import { ProjectMemberService } from '../modules/projects/project-member.service';
import { TaskService } from '../modules/tasks/task.service';
import { TaskWatcherService } from '../modules/tasks/task-watcher.service';
import { TaskCommentService } from '../modules/tasks/task-comment.service';
import { TaskNotificationService } from '../modules/tasks/task-notification.service';
import { DocumentStorageService } from '../modules/storage/document-storage.service';
import { VirusScannerService } from '../modules/security/virus-scanner.service';
import { DocumentService } from '../modules/documents/document.service';
import { DocumentApprovalQueueService } from '../modules/documents/document-approval-queue.service';
import { EmailService } from '../modules/notifications/email.service';
import { KPIService } from '../modules/kpi/kpi.service';
import { KPIMonitoringQueueService } from '../modules/kpi/kpi-monitoring-queue.service';
import { ReportService } from '../modules/reports/report.service';
import { AuthController } from '../http/controllers/auth/auth.controller';
import { UsersController } from '../http/controllers/user/users.controller';
import { ApiKeysController } from '../http/controllers/user/api-keys.controller';
import { ProjectsController } from '../http/controllers/project/projects.controller';
import { ProjectMembersController } from '../http/controllers/project/project-members.controller';
import { TasksController } from '../http/controllers/task/tasks.controller';
import { TaskWatchersController } from '../http/controllers/task/task-watchers.controller';
import { TaskCommentsController } from '../http/controllers/task/task-comments.controller';
import { DocumentsController } from '../http/controllers/document/documents.controller';
import { KPIController } from '../http/controllers/kpi/kpi.controller';
import { ReportsController } from '../http/controllers/report/reports.controller';
import { AuditController } from '../http/controllers/audit/audit.controller';
import { createAuthRouter } from '../http/routes/auth.routes';
import { createUserRouter } from '../http/routes/user.routes';
import { createApiKeysRouter } from '../http/routes/user/api-keys.routes';
import { createProjectRouter } from '../http/routes/project/project.routes';
import {
  createProjectMembersRouter,
  createMembersRouter,
} from '../http/routes/project/project-members.routes';
import { createProjectTaskRouter, createTaskRouter } from '../http/routes/task/task.routes';
import {
  createDocumentRouter,
  createProjectDocumentRouter,
} from '../http/routes/document/document.routes';
import { createKPIRouter } from '../http/routes/kpi/kpi.routes';
import { createReportsRouter } from '../http/routes/report/report.routes';
import { createAuditRouter } from '../http/routes/audit/audit.routes';
import { createQueueRouter } from '../http/routes/queue/queue.routes';
import { KanbanService } from '../modules/kanban/kanban.service';
import { KanbanController } from '../modules/kanban/kanban.controller';
import { createKanbanRouter } from '../modules/kanban/kanban.routes';
import { createExportRouter } from '../http/routes/export/export.routes';
import { createMonitoringRouter } from '../http/routes/monitoring/queue.routes';
import { createUnsubscribeRouter } from '../http/routes/unsubscribe.routes';
import { createAuthenticationMiddleware } from '../http/middleware/auth/authentication';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  prisma: DatabaseClient;
  tokenService: TokenService;
  auditService: AuditService;
  userService: UserService;
  apiKeyService: ApiKeyService;
  projectService: ProjectService;
  projectMemberService: ProjectMemberService;
  taskService: TaskService;
  taskWatcherService: TaskWatcherService;
  taskCommentService: TaskCommentService;
  taskNotificationService: TaskNotificationService;
  documentStorageService: DocumentStorageService;
  virusScannerService: VirusScannerService;
  documentService: DocumentService;
  documentApprovalQueueService: DocumentApprovalQueueService;
  emailService: EmailService;
  kpiService: KPIService;
  kpiMonitoringQueueService: KPIMonitoringQueueService;
  reportService: ReportService;
  authService: AuthService;
  authController: AuthController;
  usersController: UsersController;
  apiKeysController: ApiKeysController;
  projectsController: ProjectsController;
  projectMembersController: ProjectMembersController;
  tasksController: TasksController;
  taskWatchersController: TaskWatchersController;
  taskCommentsController: TaskCommentsController;
  documentsController: DocumentsController;
  kpiController: KPIController;
  reportsController: ReportsController;
  auditController: AuditController;
  kanbanService: KanbanService;
  kanbanController: KanbanController;
  authRouter: Router;
  userRouter: Router;
  apiKeysRouter: Router;
  projectRouter: Router;
  projectMembersRouter: Router;
  membersRouter: Router;
  projectTaskRouter: Router;
  taskRouter: Router;
  projectDocumentRouter: Router;
  documentRouter: Router;
  kpiRouter: Router;
  reportsRouter: Router;
  auditRouter: Router;
  queueRouter: Router;
  kanbanRouter: Router;
  exportRouter: Router;
  monitoringRouter: Router;
  unsubscribeRouter: Router;
  authMiddleware: RequestHandler;
  app: ReturnType<typeof createApp>;
}

export const buildContainer = (): AwilixContainer<AppDependencies> => {
  initializeEnv();

  const container = createContainer<AppDependencies>({
    injectionMode: InjectionMode.PROXY,
  });

  container.register({
    config: asValue(loadAppConfig()),
    logger: asFunction(({ config }: Pick<AppDependencies, 'config'>) =>
      createLogger({ level: config.LOG_LEVEL }),
    ).singleton(),
    prisma: asFunction(({ config }: Pick<AppDependencies, 'config'>) => createPrismaClient(config))
      .singleton()
      .disposer(async (client) => {
        await client.$disconnect();
      }),
    tokenService: asFunction(
      ({ config }: Pick<AppDependencies, 'config'>) => new TokenService(config),
    ).singleton(),
    auditService: asFunction(
      ({ prisma, logger }: Pick<AppDependencies, 'prisma' | 'logger'>) =>
        new AuditService(prisma, logger),
    ).singleton(),
    userService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new UserService(prisma),
    ).singleton(),
    apiKeyService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new ApiKeyService(prisma),
    ).singleton(),
    projectService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new ProjectService(prisma),
    ).singleton(),
    projectMemberService: asFunction(
      ({ prisma, logger }: Pick<AppDependencies, 'prisma' | 'logger'>) =>
        new ProjectMemberService(prisma, logger),
    ).singleton(),
    taskService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new TaskService(prisma),
    ).singleton(),
    emailService: asFunction(
      ({ config, logger }: Pick<AppDependencies, 'config' | 'logger'>) =>
        new EmailService(config, logger),
    ).singleton(),
    kpiService: asFunction(
      ({ prisma, logger }: Pick<AppDependencies, 'prisma' | 'logger'>) =>
        new KPIService(prisma, logger),
    ).singleton(),
    reportService: asFunction(
      ({ prisma, logger }: Pick<AppDependencies, 'prisma' | 'logger'>) =>
        new ReportService(prisma, logger),
    ).singleton(),
    kpiMonitoringQueueService: asFunction(
      ({
        prisma,
        emailService,
        taskService,
        logger,
        config,
      }: Pick<AppDependencies, 'prisma' | 'emailService' | 'taskService' | 'logger' | 'config'>) => {
        const service = new KPIMonitoringQueueService(
          prisma,
          emailService,
          taskService,
          logger,
          { host: 'localhost', port: 6379 }, // Redis connection
        );
        // Start recurring monitoring in non-test environments
        if (config.NODE_ENV !== 'test') {
          service.scheduleRecurringMonitoring().catch((err) => {
            logger.error({ error: err }, 'Failed to schedule KPI monitoring');
          });
        }
        return service;
      },
    )
      .singleton()
      .disposer(async (service) => {
        await service.close();
      }),
    documentStorageService: asFunction(
      ({ config, logger }: Pick<AppDependencies, 'config' | 'logger'>) =>
        new DocumentStorageService(config, logger),
    ).singleton(),
    virusScannerService: asFunction(
      ({ config, logger }: Pick<AppDependencies, 'config' | 'logger'>) =>
        new VirusScannerService(config.CLAMAV_HOST, config.CLAMAV_PORT, logger),
    ).singleton(),
    documentApprovalQueueService: asFunction(
      ({
        prisma,
        emailService,
        logger,
        config,
      }: Pick<AppDependencies, 'prisma' | 'emailService' | 'logger' | 'config'>) => {
        const service = new DocumentApprovalQueueService(
          prisma,
          emailService,
          logger,
          { host: 'localhost', port: 6379 }, // Redis connection
        );
        // Start workers in non-test environments
        if (config.NODE_ENV !== 'test') {
          service.startReminderWorker();
          service.startEscalationWorker();
        }
        return service;
      },
    )
      .singleton()
      .disposer(async (service) => {
        await service.shutdown();
      }),
    documentService: asFunction(
      ({
        prisma,
        documentStorageService,
        virusScannerService,
        documentApprovalQueueService,
        logger,
      }: Pick<
        AppDependencies,
        | 'prisma'
        | 'documentStorageService'
        | 'virusScannerService'
        | 'documentApprovalQueueService'
        | 'logger'
      >) =>
        new DocumentService(
          prisma,
          documentStorageService,
          virusScannerService,
          documentApprovalQueueService,
          logger,
        ),
    ).singleton(),
    taskWatcherService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new TaskWatcherService(prisma),
    ).singleton(),
    taskCommentService: asFunction(
      ({
        prisma,
        emailService,
        logger,
      }: Pick<AppDependencies, 'prisma' | 'emailService' | 'logger'>) =>
        new TaskCommentService(prisma, emailService, logger),
    ).singleton(),
    taskNotificationService: asFunction(
      ({
        prisma,
        emailService,
        logger,
        config,
      }: Pick<AppDependencies, 'prisma' | 'emailService' | 'logger' | 'config'>) => {
        const service = new TaskNotificationService(prisma, emailService, logger);
        if (config.NODE_ENV !== 'test') {
          service.start();
        }
        return service;
      },
    )
      .singleton()
      .disposer((service) => {
        service.stop();
      }),
    authService: asFunction(
      ({
        prisma,
        tokenService,
        auditService,
      }: Pick<AppDependencies, 'prisma' | 'tokenService' | 'auditService'>) =>
        new AuthService(prisma, tokenService, auditService),
    ).singleton(),
    authController: asFunction(
      ({ authService }: Pick<AppDependencies, 'authService'>) => new AuthController(authService),
    ).singleton(),
    usersController: asFunction(
      ({ userService }: Pick<AppDependencies, 'userService'>) => new UsersController(userService),
    ).singleton(),
    apiKeysController: asFunction(
      ({ apiKeyService, logger }: Pick<AppDependencies, 'apiKeyService' | 'logger'>) =>
        new ApiKeysController(apiKeyService, logger),
    ).singleton(),
    projectsController: asFunction(
      ({ projectService }: Pick<AppDependencies, 'projectService'>) =>
        new ProjectsController(projectService),
    ).singleton(),
    projectMembersController: asFunction(
      ({ projectMemberService }: Pick<AppDependencies, 'projectMemberService'>) =>
        new ProjectMembersController(projectMemberService),
    ).singleton(),
    tasksController: asFunction(
      ({ taskService, documentService }: Pick<AppDependencies, 'taskService' | 'documentService'>) =>
        new TasksController(taskService, documentService),
    ).singleton(),
    taskWatchersController: asFunction(
      ({ taskWatcherService }: Pick<AppDependencies, 'taskWatcherService'>) =>
        new TaskWatchersController(taskWatcherService),
    ).singleton(),
    taskCommentsController: asFunction(
      ({ taskCommentService }: Pick<AppDependencies, 'taskCommentService'>) =>
        new TaskCommentsController(taskCommentService),
    ).singleton(),
    documentsController: asFunction(
      ({ documentService }: Pick<AppDependencies, 'documentService'>) =>
        new DocumentsController(documentService),
    ).singleton(),
    kpiController: asFunction(
      ({ kpiService }: Pick<AppDependencies, 'kpiService'>) => new KPIController(kpiService),
    ).singleton(),
    reportsController: asFunction(
      ({ reportService }: Pick<AppDependencies, 'reportService'>) =>
        new ReportsController(reportService),
    ).singleton(),
    auditController: asFunction(
      ({ auditService, logger }: Pick<AppDependencies, 'auditService' | 'logger'>) =>
        new AuditController(auditService, logger),
    ).singleton(),
    kanbanService: asFunction(
      ({ prisma }: Pick<AppDependencies, 'prisma'>) => new KanbanService(prisma),
    ).singleton(),
    kanbanController: asFunction(
      ({ kanbanService }: Pick<AppDependencies, 'kanbanService'>) =>
        new KanbanController(kanbanService),
    ).singleton(),
    authMiddleware: asFunction(
      ({
        tokenService,
        prisma,
        logger,
      }: Pick<AppDependencies, 'tokenService' | 'prisma' | 'logger'>) =>
        createAuthenticationMiddleware({ tokenService, prisma, logger }),
    ).singleton(),
    authRouter: asFunction(({ authController }: Pick<AppDependencies, 'authController'>) =>
      createAuthRouter(authController),
    ).singleton(),
    apiKeysRouter: asFunction((deps: AppDependencies) => createApiKeysRouter(deps)).singleton(),
    userRouter: asFunction(({ usersController, apiKeysRouter }: Pick<AppDependencies, 'usersController' | 'apiKeysRouter'>) =>
      createUserRouter({ usersController, apiKeysRouter }),
    ).singleton(),
    projectRouter: asFunction(
      ({ projectsController }: Pick<AppDependencies, 'projectsController'>) =>
        createProjectRouter(projectsController),
    ).singleton(),
    projectMembersRouter: asFunction(
      ({ projectMembersController }: Pick<AppDependencies, 'projectMembersController'>) =>
        createProjectMembersRouter(projectMembersController),
    ).singleton(),
    membersRouter: asFunction(
      ({ projectMembersController }: Pick<AppDependencies, 'projectMembersController'>) =>
        createMembersRouter(projectMembersController),
    ).singleton(),
    projectTaskRouter: asFunction(({ tasksController }: Pick<AppDependencies, 'tasksController'>) =>
      createProjectTaskRouter(tasksController),
    ).singleton(),
    taskRouter: asFunction(
      ({
        tasksController,
        taskCommentsController,
        taskWatchersController,
      }: Pick<
        AppDependencies,
        'tasksController' | 'taskCommentsController' | 'taskWatchersController'
      >) => createTaskRouter(tasksController, taskCommentsController, taskWatchersController),
    ).singleton(),
    projectDocumentRouter: asFunction(
      ({ documentsController }: Pick<AppDependencies, 'documentsController'>) =>
        createProjectDocumentRouter(documentsController),
    ).singleton(),
    documentRouter: asFunction(
      ({ documentsController }: Pick<AppDependencies, 'documentsController'>) =>
        createDocumentRouter(documentsController),
    ).singleton(),
    kpiRouter: asFunction(({ kpiController }: Pick<AppDependencies, 'kpiController'>) =>
      createKPIRouter(kpiController),
    ).singleton(),
    reportsRouter: asFunction(
      ({ reportsController }: Pick<AppDependencies, 'reportsController'>) =>
        createReportsRouter(reportsController),
    ).singleton(),
    auditRouter: asFunction(
      ({ auditController, authMiddleware }: Pick<AppDependencies, 'auditController' | 'authMiddleware'>) =>
        createAuditRouter(auditController, authMiddleware),
    ).singleton(),
    queueRouter: asFunction(() => createQueueRouter()).singleton(),
    kanbanRouter: asFunction(
      ({ kanbanController }: Pick<AppDependencies, 'kanbanController'>) =>
        createKanbanRouter(kanbanController),
    ).singleton(),
    exportRouter: asFunction(() => createExportRouter()).singleton(),
    monitoringRouter: asFunction(() => createMonitoringRouter()).singleton(),
    unsubscribeRouter: asFunction(() => createUnsubscribeRouter()).singleton(),
    app: asFunction(
      ({
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
        reportsRouter,
        auditRouter,
        queueRouter,
        kanbanRouter,
        exportRouter,
        monitoringRouter,
        unsubscribeRouter,
        authMiddleware,
      }: Pick<
        AppDependencies,
        | 'logger'
        | 'config'
        | 'authRouter'
        | 'userRouter'
        | 'projectRouter'
        | 'projectMembersRouter'
        | 'membersRouter'
        | 'projectTaskRouter'
        | 'projectDocumentRouter'
        | 'documentRouter'
        | 'taskRouter'
        | 'kpiRouter'
        | 'reportsRouter'
        | 'auditRouter'
        | 'queueRouter'
        | 'kanbanRouter'
        | 'exportRouter'
        | 'monitoringRouter'
        | 'unsubscribeRouter'
        | 'authMiddleware'
      >) =>
        createApp({
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
        }),
    ).singleton(),
  });

  return container;
};
