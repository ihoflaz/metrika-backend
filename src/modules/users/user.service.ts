import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUserDTO } from '../auth/dto/auth.dto';
import { badRequestError } from '../../common/errors';

export class UserService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getUserProfile(userId: string): Promise<AuthenticatedUserDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) {
      throw badRequestError('USER_NOT_FOUND', 'User not found');
    }

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
  }
}
