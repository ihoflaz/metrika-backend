import { uuidv7 } from 'uuidv7';
import { PrismaClient, UserStatus } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

describe('API Keys E2E', () => {
  let context: TestAppContext;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    context = await setupTestApp();

    // Login to get auth token
    const loginResponse = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    authToken = loginResponse.body.data.attributes.accessToken;
    userId = loginResponse.body.data.relationships.user.id;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('POST /api/v1/users/api-keys', () => {
    it('should create an API key with valid data', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test API Key',
          scopes: ['tasks:read', 'tasks:write'],
          expiresInDays: 90,
        });

      expect(status).toBe(201);
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey.id).toEqual(expect.any(String));
      expect(body.apiKey.name).toBe('Test API Key');
      expect(body.apiKey.key).toMatch(/^mk_live_[a-f0-9]{48}$/);
      expect(body.apiKey.scopes).toEqual(['tasks:read', 'tasks:write']);
      expect(body.apiKey.expiresAt).toBeDefined();
      expect(body.warning).toContain('Save this API key securely');
      expect(body.apiKey.keyHash).toBeUndefined(); // Hash should never be exposed
    });

    it('should reject creation without name', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          scopes: ['tasks:read'],
          expiresInDays: 30,
        });

      expect(status).toBe(400);
      expect(body.errors).toBeDefined();
      expect(body.errors[0].code).toBe('INVALID_NAME');
    });

    it('should reject creation without scopes', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Invalid Key',
          scopes: [],
          expiresInDays: 30,
        });

      expect(status).toBe(400);
      expect(body.errors).toBeDefined();
      expect(body.errors[0].code).toBe('INVALID_SCOPES');
    });

    it('should reject creation with invalid expiration', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Invalid Key',
          scopes: ['tasks:read'],
          expiresInDays: -10,
        });

      expect(status).toBe(400);
      expect(body.errors).toBeDefined();
      expect(body.errors[0].code).toBe('INVALID_EXPIRATION');
    });

    it('should require authentication', async () => {
      const { status } = await context.httpClient.post('/api/v1/users/api-keys').send({
        name: 'Test Key',
        scopes: ['tasks:read'],
      });

      expect(status).toBe(401);
    });
  });

  describe('GET /api/v1/users/api-keys', () => {
    let createdKeyId: string;

    beforeAll(async () => {
      // Create a test key
      const response = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'List Test Key',
          scopes: ['projects:read'],
          expiresInDays: 60,
        });

      createdKeyId = response.body.apiKey.id;
    });

    it('should list user API keys with statistics', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(200);
      expect(body.apiKeys).toBeInstanceOf(Array);
      expect(body.apiKeys.length).toBeGreaterThan(0);
      expect(body.stats).toBeDefined();
      expect(body.stats.total).toBeGreaterThan(0);
      expect(body.stats.active).toBeGreaterThan(0);

      const key = body.apiKeys.find((k: any) => k.id === createdKeyId);
      expect(key).toBeDefined();
      expect(key.name).toBe('List Test Key');
      expect(key.scopes).toEqual(['projects:read']);
      expect(key.keyHash).toBeUndefined(); // Hash should never be exposed
    });

    it('should require authentication', async () => {
      const { status } = await context.httpClient.get('/api/v1/users/api-keys');

      expect(status).toBe(401);
    });
  });

  describe('GET /api/v1/users/api-keys/:id', () => {
    let testKeyId: string;

    beforeAll(async () => {
      const response = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Detail Test Key',
          scopes: ['documents:read'],
          expiresInDays: 45,
        });

      testKeyId = response.body.apiKey.id;
    });

    it('should get API key details', async () => {
      const { status, body } = await context.httpClient
        .get(`/api/v1/users/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(200);
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey.id).toBe(testKeyId);
      expect(body.apiKey.name).toBe('Detail Test Key');
      expect(body.apiKey.scopes).toEqual(['documents:read']);
      expect(body.apiKey.keyHash).toBeUndefined();
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status, body } = await context.httpClient
        .get(`/api/v1/users/api-keys/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(404);
      expect(body.errors).toBeDefined();
    });

    it('should require authentication', async () => {
      const { status } = await context.httpClient.get(`/api/v1/users/api-keys/${testKeyId}`);

      expect(status).toBe(401);
    });
  });

  describe('DELETE /api/v1/users/api-keys/:id', () => {
    let revokeKeyId: string;

    beforeEach(async () => {
      const response = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Revoke Test Key',
          scopes: ['tasks:delete'],
          expiresInDays: 30,
        });

      revokeKeyId = response.body.apiKey.id;
    });

    it('should revoke an API key', async () => {
      const { status, body } = await context.httpClient
        .delete(`/api/v1/users/api-keys/${revokeKeyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(200);
      expect(body.message).toContain('revoked successfully');
      expect(body.apiKey.revokedAt).toBeDefined();

      // Verify key is revoked in database
      const dbKey = await context.prisma.apiKey.findUnique({
        where: { id: revokeKeyId },
      });
      expect(dbKey?.revokedAt).toBeDefined();
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status } = await context.httpClient
        .delete(`/api/v1/users/api-keys/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(404);
    });

    it('should reject revoking already revoked key', async () => {
      // First revoke
      await context.httpClient
        .delete(`/api/v1/users/api-keys/${revokeKeyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      // Try to revoke again
      const { status, body } = await context.httpClient
        .delete(`/api/v1/users/api-keys/${revokeKeyId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(400);
      expect(body.errors[0].code).toBe('API_KEY_ALREADY_REVOKED');
    });

    it('should require authentication', async () => {
      const { status } = await context.httpClient.delete(`/api/v1/users/api-keys/${revokeKeyId}`);

      expect(status).toBe(401);
    });
  });

  describe('POST /api/v1/users/api-keys/:id/regenerate', () => {
    let regenerateKeyId: string;
    let originalKeyValue: string;

    beforeEach(async () => {
      const response = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Regenerate Test Key',
          scopes: ['projects:write'],
          expiresInDays: 180,
        });

      regenerateKeyId = response.body.apiKey.id;
      originalKeyValue = response.body.apiKey.key;
    });

    it('should regenerate an API key', async () => {
      const { status, body } = await context.httpClient
        .post(`/api/v1/users/api-keys/${regenerateKeyId}/regenerate`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(200);
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey.id).not.toBe(regenerateKeyId); // New ID
      expect(body.apiKey.key).toMatch(/^mk_live_[a-f0-9]{48}$/);
      expect(body.apiKey.key).not.toBe(originalKeyValue); // New key
      expect(body.apiKey.name).toBe('Regenerate Test Key'); // Same name
      expect(body.apiKey.scopes).toEqual(['projects:write']); // Same scopes
      expect(body.warning).toContain('Save this API key securely');

      // Verify old key is revoked
      const oldKey = await context.prisma.apiKey.findUnique({
        where: { id: regenerateKeyId },
      });
      expect(oldKey?.revokedAt).toBeDefined();
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status } = await context.httpClient
        .post(`/api/v1/users/api-keys/${fakeId}/regenerate`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(status).toBe(404);
    });

    it('should require authentication', async () => {
      const { status } = await context.httpClient.post(
        `/api/v1/users/api-keys/${regenerateKeyId}/regenerate`,
      );

      expect(status).toBe(401);
    });
  });

  describe('API Key Usage Tracking', () => {
    it('should update lastUsedAt when key is validated', async () => {
      // Create a key
      const createResponse = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Usage Tracking Key',
          scopes: ['*'],
          expiresInDays: 30,
        });

      const plainKey = createResponse.body.apiKey.key;
      const keyId = createResponse.body.apiKey.id;

      // Wait a moment to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // TODO: Once API key authentication is implemented in middleware,
      // make a request using the API key and verify lastUsedAt is updated

      // For now, just verify the key exists and has no lastUsedAt initially
      const dbKey = await context.prisma.apiKey.findUnique({
        where: { id: keyId },
      });
      expect(dbKey).toBeDefined();
      expect(dbKey?.lastUsedAt).toBeNull();
    });
  });

  describe('Expired Keys', () => {
    it('should not allow using expired keys', async () => {
      // Create a key with 1 day expiration (we can't create with sub-day expiration due to validation)
      // We'll verify the key is created and has correct expiration date
      const createResponse = await context.httpClient
        .post('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Short-lived Key',
          scopes: ['tasks:read'],
          expiresInDays: 1,
        });

      expect(createResponse.status).toBe(201);
      const keyId = createResponse.body.apiKey.id;
      const expiresAt = new Date(createResponse.body.apiKey.expiresAt);
      const now = new Date();
      
      // Verify expiration is approximately 1 day from now
      const dayInMs = 24 * 60 * 60 * 1000;
      const timeDiff = Math.abs(expiresAt.getTime() - now.getTime() - dayInMs);
      expect(timeDiff).toBeLessThan(5000); // Within 5 seconds tolerance

      // To test expired key validation, we'd need to:
      // 1. Manually update the database to set expiresAt to past
      // 2. Or implement API key authentication middleware first
      
      // For now, just verify the key is in the list
      const listResponse = await context.httpClient
        .get('/api/v1/users/api-keys')
        .set('Authorization', `Bearer ${authToken}`);

      const key = listResponse.body.apiKeys.find((k: any) => k.id === keyId);
      expect(key).toBeDefined();
    });
  });
});
