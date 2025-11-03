import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AwilixContainer } from 'awilix';
import request from 'supertest';
import { seedCoreRbac } from '../../src/modules/rbac/seed';
import { buildContainer, type AppDependencies } from '../../src/di/container';
import { loadAppConfig } from '../../src/config/app-config';
import { initializeEnv } from '../../src/config/env';
import { getQueueService } from '../../src/modules/automation/queue.service';

export interface TestAppContext {
  container: AwilixContainer<AppDependencies>;
  prisma: PrismaClient;
  httpClient: ReturnType<typeof request>;
  schemaName: string;
  databaseUrl: string;
  originalDatabaseUrl?: string;
}

const ensureEnvDefaults = () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= 'postgresql://metrika:metrika_pass@localhost:5432/metrika?schema=public';
  process.env.APP_HOST ??= '127.0.0.1';
  process.env.APP_PORT ??= '0';
  process.env.LOG_LEVEL ??= 'silent';
  process.env.AUTH_ACCESS_TOKEN_SECRET ??= 'test-access-secret-change-me-1234567890';
  process.env.AUTH_REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-change-me-1234567890123456';
  process.env.AUTH_ACCESS_TOKEN_TTL ??= '900';
  process.env.AUTH_REFRESH_TOKEN_TTL ??= '1209600';
  process.env.PASSWORD_MIN_LENGTH ??= '12';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '1025';
  process.env.SMTP_SECURE ??= 'false';
  process.env.SMTP_FROM ??= 'no-reply@metrika.local';
  process.env.SMTP_USERNAME ??= '';
  process.env.SMTP_PASSWORD ??= '';
  process.env.MAILHOG_BASE_URL ??= 'http://localhost:8025';
  process.env.STORAGE_ENDPOINT ??= 'http://localhost:9000';
  process.env.STORAGE_REGION ??= 'us-east-1';
  process.env.STORAGE_ACCESS_KEY ??= 'minioadmin';
  process.env.STORAGE_SECRET_KEY ??= 'minioadmin';
  process.env.STORAGE_BUCKET ??= 'metrika-documents';
  process.env.CLAMAV_HOST ??= 'localhost';
  process.env.CLAMAV_PORT ??= '3310';
};

const buildTestDatabaseUrl = (baseUrl: string, schema: string) => {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
};

export const setupTestApp = async (): Promise<TestAppContext> => {
  initializeEnv();
  ensureEnvDefaults();

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL must be defined for tests');
  }

  const schemaName = `test_${randomUUID().replace(/-/g, '')}`;
  const databaseUrl = buildTestDatabaseUrl(baseUrl, schemaName);
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;

  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  const prisma = new PrismaClient();
  const config = loadAppConfig();
  await seedCoreRbac(prisma, config.PASSWORD_MIN_LENGTH);

  const container = buildContainer(prisma); // Inject test prisma client
  const app = container.resolve('app');
  const httpClient = request(app);

  return {
    container,
    prisma,
    httpClient,
    schemaName,
    databaseUrl,
    originalDatabaseUrl,
  };
};

export const teardownTestApp = async ({
  container,
  prisma,
  schemaName,
  originalDatabaseUrl,
}: TestAppContext) => {
  try {
    // Close QueueService singleton (closes all Redis connections)
    const queueService = getQueueService();
    await queueService.close();
  } catch (error) {
    console.error('Error closing QueueService:', error);
  }

  try {
    // Dispose container first (closes connections, workers, etc.)
    await container.dispose();
  } catch (error) {
    console.error('Error disposing container:', error);
  }

  try {
    // Drop test schema
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    console.error('Error dropping schema:', error);
  }

  try {
    // Disconnect Prisma client
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }

  // Restore original DATABASE_URL
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
};
