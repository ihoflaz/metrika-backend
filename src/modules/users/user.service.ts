import { Prisma, PrismaClient, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { hashPassword } from '../auth/password.service';
import { badRequestError, notFoundError } from '../../common/errors';
import { ROLES } from '../rbac/permissions';

const userWithRoleInclude = Prisma.validator<Prisma.UserInclude>()({
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
});

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userWithRoleInclude }>;

export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus;
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  password: string;
  roles?: string[];
  status?: UserStatus;
}

export interface UpdateUserInput {
  email?: string;
  fullName?: string;
  password?: string | null;
  roles?: string[];
  status?: UserStatus;
}

export interface UserDTO {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  roles: string[];
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedUsers {
  users: UserDTO[];
  total: number;
  page: number;
  limit: number;
}

export class UserService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async listUsers(params: ListUsersParams): Promise<PaginatedUsers> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 && params.limit <= 100 ? params.limit : 20;

    const where: Prisma.UserWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { fullName: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, records] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: userWithRoleInclude,
      }),
    ]);

    return {
      users: records.map((user) => this.mapUser(user)),
      total,
      page,
      limit,
    };
  }

  async getUserById(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRoleInclude,
    });

    if (!user) {
      throw notFoundError('USER_NOT_FOUND', 'User not found');
    }

    return this.mapUser(user);
  }

  async getUserProfile(userId: string): Promise<UserDTO> {
    return this.getUserById(userId);
  }

  async createUser(input: CreateUserInput): Promise<UserDTO> {
    const roleCodes = input.roles && input.roles.length > 0 ? input.roles : [ROLES.TEAM_MEMBER];

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const roleRecords = await tx.role.findMany({
          where: { code: { in: roleCodes } },
        });

        if (roleRecords.length !== roleCodes.length) {
          const existingCodes = new Set(roleRecords.map((role) => role.code));
          const missing = roleCodes.filter((code) => !existingCodes.has(code));
          throw badRequestError(
            'USER_INVALID_ROLES',
            'One or more roles are invalid',
            `Unknown role codes: ${missing.join(', ')}`,
          );
        }

        const userId = uuidv7();
        const passwordHash = await hashPassword(input.password);

        await tx.user.create({
          data: {
            id: userId,
            email: input.email.trim().toLowerCase(),
            fullName: input.fullName.trim(),
            passwordHash,
            status: input.status ?? UserStatus.ACTIVE,
          },
        });

        await tx.userRole.createMany({
          data: roleRecords.map((role) => ({
            userId,
            roleId: role.id,
          })),
        });

        return tx.user.findUnique({
          where: { id: userId },
          include: userWithRoleInclude,
        });
      });

      if (!result) {
        throw new Error('Failed to load created user');
      }

      return this.mapUser(result);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateUser(userId: string, input: UpdateUserInput): Promise<UserDTO> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        include: userWithRoleInclude,
      });

      if (!existing) {
        throw notFoundError('USER_NOT_FOUND', 'User not found');
      }

      const data: Prisma.UserUpdateInput = {};

      if (typeof input.email === 'string') {
        data.email = input.email.trim().toLowerCase();
      }

      if (typeof input.fullName === 'string') {
        data.fullName = input.fullName.trim();
      }

      if (input.status) {
        data.status = input.status;
      }

      if (input.password !== undefined) {
        if (input.password === null || input.password.trim().length === 0) {
          throw badRequestError('USER_INVALID_PASSWORD', 'New password must not be empty');
        }
        data.passwordHash = await hashPassword(input.password);
        data.passwordSetAt = new Date();
      }

      await tx.user.update({
        where: { id: userId },
        data,
      });

      if (input.roles) {
        const roleRecords = await tx.role.findMany({
          where: { code: { in: input.roles } },
        });

        if (roleRecords.length !== input.roles.length) {
          const existingCodes = new Set(roleRecords.map((role) => role.code));
          const missing = input.roles.filter((code) => !existingCodes.has(code));
          throw badRequestError(
            'USER_INVALID_ROLES',
            'One or more roles are invalid',
            `Unknown role codes: ${missing.join(', ')}`,
          );
        }

        await tx.userRole.deleteMany({ where: { userId } });
        if (roleRecords.length > 0) {
          await tx.userRole.createMany({
            data: roleRecords.map((role) => ({
              userId,
              roleId: role.id,
            })),
          });
        }
      }

      const updated = await tx.user.findUnique({
        where: { id: userId },
        include: userWithRoleInclude,
      });

      if (!updated) {
        throw new Error('Failed to load updated user');
      }

      return updated;
    });

    return this.mapUser(result);
  }

  async deactivateUser(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
      include: userWithRoleInclude,
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: 'user_deactivated',
      },
    });

    return this.mapUser(user);
  }

  async activateUser(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
      include: userWithRoleInclude,
    });

    return this.mapUser(user);
  }

  private mapUser(user: UserWithRelations): UserDTO {
    const roles = user.roles.map((relation) => relation.role.code);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((relation) =>
          relation.role.permissions.map((perm) => perm.permission.code),
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
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw badRequestError(
        'USER_EMAIL_NOT_UNIQUE',
        'Email address already in use',
        'Another user already uses this email address',
      );
    }

    throw error;
  }
}
