import type { AwilixContainer } from 'awilix';
import request from 'supertest';
import { buildContainer, type AppDependencies } from '../../src/di/container';

describe('Health endpoints', () => {
  let container: AwilixContainer<AppDependencies>;

  beforeEach(() => {
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
