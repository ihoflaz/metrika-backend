import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AwilixContainer } from 'awilix';
import request from 'supertest';
import { seedCoreRbac } from '../../src/modules/rbac/seed';
import { buildContainer, type AppDependencies } from '../../src/di/container';
import { loadAppConfig } from '../../src/config/app-config';
import { initializeEnv } from '../../src/config/env';

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
  ensureEnvDefaults();
  initializeEnv();

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL must be defined for tests');
  }

  const schemaName = `test_${randomUUID().replace(/-/g, '')}`;
  const databaseUrl = buildTestDatabaseUrl(baseUrl, schemaName);
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;

  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  const prisma = new PrismaClient();
  const config = loadAppConfig();
  await seedCoreRbac(prisma, config.PASSWORD_MIN_LENGTH);

  const container = buildContainer();
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
  await container.dispose();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$disconnect();
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
};
