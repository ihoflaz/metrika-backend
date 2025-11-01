import type { AwilixContainer } from 'awilix';
import request from 'supertest';
import { buildContainer, type AppDependencies } from '../../src/di/container';
import { initializeEnv } from '../../src/config/env';

const ensureEnvDefaults = () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_HOST ??= '127.0.0.1';
  process.env.APP_PORT ??= '0';
  process.env.LOG_LEVEL ??= 'silent';
  process.env.AUTH_ACCESS_TOKEN_SECRET ??= 'test-access-secret-change-me-1234567890';
  process.env.AUTH_REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-change-me-1234567890123456';
  process.env.DATABASE_URL ??= 'postgresql://metrika:metrika_pass@localhost:5432/metrika?schema=public';
  process.env.SMTP_HOST ??= 'localhost';
  process.env.SMTP_PORT ??= '1025';
  process.env.SMTP_SECURE ??= 'false';
  process.env.SMTP_FROM ??= 'no-reply@metrika.local';
  process.env.SMTP_USERNAME ??= '';
  process.env.SMTP_PASSWORD ??= '';
  process.env.STORAGE_ENDPOINT ??= 'http://localhost:9000';
  process.env.STORAGE_REGION ??= 'us-east-1';
  process.env.STORAGE_ACCESS_KEY ??= 'minioadmin';
  process.env.STORAGE_SECRET_KEY ??= 'minioadmin';
  process.env.STORAGE_BUCKET ??= 'metrika-documents';
  process.env.CLAMAV_HOST ??= 'localhost';
  process.env.CLAMAV_PORT ??= '3310';
};

describe('Health endpoints', () => {
  let container: AwilixContainer<AppDependencies>;

  beforeEach(() => {
    ensureEnvDefaults();
    initializeEnv();
    container = buildContainer();
  });

  afterEach(async () => {
    if (container) {
      await container.dispose();
    }
  });

  it('returns ok for /healthz', async () => {
    const app = container.resolve('app');

    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body.data.type).toBe('health');
    expect(response.body.data.attributes.status).toBe('ok');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });

  it('returns ready for /readyz', async () => {
    const app = container.resolve('app');

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.data.type).toBe('readiness');
    expect(response.body.data.attributes.status).toBe('ready');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });
});
