import { PrismaClient, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import {
  PERMISSIONS,
  ROLE_PERMISSION_MAP,
  ROLES,
  type PermissionCode,
  type RoleCode,
} from './permissions';
import { hashPassword } from '../auth/password.service';
import { defaultPasswordPolicy, validatePassword } from '../auth/password-policy';

export interface SeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  adminFullName?: string;
}

const titleCase = (value: string) =>
  value
    .split(/[-_:]/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(' ');

const roleName = (code: RoleCode) =>
  code
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const seedCoreRbac = async (
  prisma: PrismaClient,
  passwordMinLength: number,
  options: SeedOptions = {},
) => {
  const adminEmail = (options.adminEmail ?? 'admin@metrika.local').trim().toLowerCase();
  const adminPassword = options.adminPassword ?? 'ChangeMeNow123!';
  const adminFullName = options.adminFullName ?? 'System Administrator';

  const policy = defaultPasswordPolicy(passwordMinLength);
  validatePassword(adminPassword, policy);

  const permissionEntries = Object.values(PERMISSIONS) as PermissionCode[];
  await Promise.all(
    permissionEntries.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {
          name: titleCase(code),
        },
        create: {
          id: uuidv7(),
          code,
          name: titleCase(code),
        },
      }),
    ),
  );

  const roleEntries = Object.values(ROLES) as RoleCode[];
  await Promise.all(
    roleEntries.map((code) =>
      prisma.role.upsert({
        where: { code },
        update: {
          name: roleName(code),
        },
        create: {
          id: uuidv7(),
          code,
          name: roleName(code),
        },
      }),
    ),
  );

  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionEntries } },
  });
  const permissionMap = new Map(permissions.map((record) => [record.code, record]));
  const roles = await prisma.role.findMany({ where: { code: { in: roleEntries } } });
  const roleMap = new Map(roles.map((record) => [record.code, record]));

  await Promise.all(
    roleEntries.flatMap((roleCode) => {
      const roleRecord = roleMap.get(roleCode);
      if (!roleRecord) {
        return [];
      }
      const requiredPermissions = ROLE_PERMISSION_MAP[roleCode] ?? [];
      return requiredPermissions.map((permissionCode) => {
        const permissionRecord = permissionMap.get(permissionCode);
        if (!permissionRecord) {
          return Promise.resolve();
        }
        return prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: roleRecord.id,
              permissionId: permissionRecord.id,
            },
          },
          update: {},
          create: {
            roleId: roleRecord.id,
            permissionId: permissionRecord.id,
          },
        });
      });
    }),
  );

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const adminRole = roleMap.get(ROLES.SYSADMIN);
  if (!adminRole) {
    throw new Error('SYSADMIN role was not created');
  }

  if (!existingAdmin) {
    const passwordHash = await hashPassword(adminPassword);
    const userId = uuidv7();
    await prisma.user.create({
      data: {
        id: userId,
        email: adminEmail,
        fullName: adminFullName,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: {
        userId,
        roleId: adminRole.id,
      },
    });
  } else {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: existingAdmin.id,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId: existingAdmin.id,
        roleId: adminRole.id,
      },
    });
  }
};
