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
import { AuthController } from '../http/controllers/auth/auth.controller';
import { UsersController } from '../http/controllers/user/users.controller';
import { createAuthRouter } from '../http/routes/auth.routes';
import { createUserRouter } from '../http/routes/user.routes';
import { createAuthenticationMiddleware } from '../http/middleware/auth/authentication';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  prisma: DatabaseClient;
  tokenService: TokenService;
  auditService: AuditService;
  userService: UserService;
  authService: AuthService;
  authController: AuthController;
  usersController: UsersController;
  authRouter: Router;
  userRouter: Router;
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
    userRouter: asFunction(({ usersController }: Pick<AppDependencies, 'usersController'>) =>
      createUserRouter(usersController),
    ).singleton(),
    app: asFunction(
      ({
        logger,
        config,
        authRouter,
        userRouter,
        authMiddleware,
      }: Pick<
        AppDependencies,
        'logger' | 'config' | 'authRouter' | 'userRouter' | 'authMiddleware'
      >) => createApp({ logger, config, authRouter, userRouter, authMiddleware }),
    ).singleton(),
  });

  return container;
};
