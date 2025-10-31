import { PrismaClient } from '@prisma/client';
import { initializeEnv } from '../src/config/env';
import { loadAppConfig } from '../src/config/app-config';
import { seedCoreRbac } from '../src/modules/rbac/seed';

const prisma = new PrismaClient();

const main = async () => {
  initializeEnv();
  const config = loadAppConfig();
  await seedCoreRbac(prisma, config.PASSWORD_MIN_LENGTH);
  // eslint-disable-next-line no-console
  console.log('Seed data applied successfully.');
};

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to seed database', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
