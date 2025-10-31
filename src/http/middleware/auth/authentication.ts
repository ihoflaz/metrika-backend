import type { NextFunction, Request, Response } from 'express';
import { PrismaClient, UserStatus } from '@prisma/client';
import { unauthorizedError, forbiddenError } from '../../../common/errors';
import type { TokenService } from '../../../modules/auth/token.service';
import type { Logger } from '../../../lib/logger';
import type { AuthenticatedRequestUser } from '../../types/auth-context';

export interface AuthenticationDependencies {
  tokenService: TokenService;
  prisma: PrismaClient;
  logger: Logger;
}

const hasAuthorizationHeader = (req: Request): string | null => {
  const header = req.header('authorization');
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
};

export const createAuthenticationMiddleware =
  ({ tokenService, prisma, logger }: AuthenticationDependencies) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = hasAuthorizationHeader(req);
      if (!token) {
        throw unauthorizedError('Missing bearer token');
      }

      const payload = await tokenService.verifyAccessToken(token);
      const userRecord = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true,
        },
      });

      if (!userRecord || userRecord.status !== UserStatus.ACTIVE) {
        throw unauthorizedError('User is not active');
      }

      const authUser: AuthenticatedRequestUser = {
        id: userRecord.id,
        email: userRecord.email,
        fullName: userRecord.fullName,
        roles: payload.roles,
        permissions: payload.permissions,
      };

      res.locals.authUser = authUser;
      next();
    } catch (error: unknown) {
      logger.debug({ error }, 'Authentication failed');
      next(error);
    }
  };

export const requirePermissions =
  (...permissions: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      next(unauthorizedError('Authentication required'));
      return;
    }

    const missing = permissions.filter((permission) => !authUser.permissions.includes(permission));
    if (missing.length > 0) {
      next(
        forbiddenError('ACCESS_DENIED', 'Access denied', 'Missing required permissions', {
          required: permissions,
          missing,
        }),
      );
      return;
    }

    next();
  };
