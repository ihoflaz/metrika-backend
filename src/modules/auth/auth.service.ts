import { PrismaClient, UserStatus, Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { forbiddenError, unauthorizedError } from '../../common/errors';
import { verifyPassword } from './password.service';
import type { TokenService } from './token.service';
import type { AuthenticatedUserDTO, LoginResponseDTO, AuthTokensDTO } from './dto/auth.dto';
import type { AuditService } from '../audit/audit.service';

export interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string | null;
}

export type RefreshContext = LoginContext;

type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    roles: {
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true;
              };
            };
          };
        };
      };
    };
  };
}>;
const forbiddenStatuses: UserStatus[] = [UserStatus.SUSPENDED, UserStatus.INVITED];

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const extractUserProfile = (user: UserWithRoles): AuthenticatedUserDTO => {
  const roles = user.roles.map((item) => item.role.code);
  const permissions = Array.from(
    new Set(
      user.roles.flatMap((item) =>
        item.role.permissions.map((permission) => permission.permission.code),
      ),
    ),
  );

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roles,
    permissions,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
};

export class AuthService {
  private readonly prisma: PrismaClient;

  private readonly tokenService: TokenService;

  private readonly auditService: AuditService;

  constructor(prisma: PrismaClient, tokenService: TokenService, auditService: AuditService) {
    this.prisma = prisma;
    this.tokenService = tokenService;
    this.auditService = auditService;
  }

  private getUserWithRoles(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async login(email: string, password: string, context: LoginContext): Promise<LoginResponseDTO> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.getUserWithRoles(normalizedEmail);

    if (!user) {
      await this.auditService.logAuthEvent('AUTH_LOGIN_FAILED', {
        actorId: null,
        detail: 'Unknown email',
        context,
        email: normalizedEmail,
      });
      throw unauthorizedError('Invalid credentials');
    }

    if (forbiddenStatuses.includes(user.status)) {
      await this.auditService.logAuthEvent('AUTH_LOGIN_BLOCKED', {
        actorId: user.id,
        detail: `User status is ${user.status}`,
        context,
        email: normalizedEmail,
      });
      throw forbiddenError('AUTH_ACCOUNT_RESTRICTED', 'Account is not active');
    }

    const passwordValid = await verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      await this.auditService.logAuthEvent('AUTH_LOGIN_FAILED', {
        actorId: user.id,
        detail: 'Invalid password',
        context,
        email: normalizedEmail,
      });
      throw unauthorizedError('Invalid credentials');
    }

    const issued = await this.issueTokens(user.id, user, context);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.auditService.logAuthEvent('AUTH_LOGIN_SUCCESS', {
      actorId: user.id,
      context,
    });

    const userProfile = extractUserProfile(user);
    userProfile.lastLoginAt = new Date().toISOString();

    return {
      tokens: issued.tokens,
      user: userProfile,
    };
  }

  async refresh(refreshToken: string, context: RefreshContext): Promise<LoginResponseDTO> {
    const verification = await this.tokenService.verifyRefreshToken(refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: verification.hash },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!storedToken || storedToken.revokedAt) {
      throw unauthorizedError('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw unauthorizedError('Refresh token expired');
    }

    const { user } = storedToken;

    if (!user || forbiddenStatuses.includes(user.status)) {
      throw forbiddenError('AUTH_ACCOUNT_RESTRICTED', 'Account is not active');
    }

    const issued = await this.issueTokens(user.id, user, context);

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        replacedByToken: issued.refreshTokenHash,
      },
    });

    await this.auditService.logAuthEvent('AUTH_REFRESH_SUCCESS', {
      actorId: user.id,
      context,
    });

    return {
      tokens: issued.tokens,
      user: extractUserProfile(user),
    };
  }

  private async issueTokens(
    userId: string,
    user: UserWithRoles,
    context: LoginContext,
  ): Promise<{ tokens: AuthTokensDTO; refreshTokenHash: string; refreshTokenId: string }> {
    const roles = user.roles.map((item) => item.role.code);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((item) =>
          item.role.permissions.map((permission) => permission.permission.code),
        ),
      ),
    );

    const accessToken = await this.tokenService.generateAccessToken(userId, roles, permissions);
    const refreshToken = await this.tokenService.generateRefreshToken();

    const createdToken = await this.prisma.refreshToken.create({
      data: {
        id: uuidv7(),
        tokenHash: refreshToken.tokenHash,
        userId,
        issuedAt: new Date(),
        expiresAt: refreshToken.expiresAt,
        replacedByToken: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return {
      tokens: {
        accessToken: accessToken.token,
        accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
        accessTokenExpiresIn: accessToken.expiresIn,
        refreshToken: refreshToken.token,
        refreshTokenExpiresAt: refreshToken.expiresAt.toISOString(),
        refreshTokenExpiresIn: refreshToken.expiresIn,
      },
      refreshTokenHash: refreshToken.tokenHash,
      refreshTokenId: createdToken.id,
    };
  }
}
