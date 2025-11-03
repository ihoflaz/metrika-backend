import { uuidv7 } from 'uuidv7';
import { PrismaClient, UserStatus } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

const createTestUser = async (prisma: PrismaClient) => {
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.TEAM_MEMBER } });
  const password = 'TestUser123!';
  const passwordHash = await hashPassword(password);
  const userId = uuidv7();

  await prisma.user.create({
    data: {
      id: userId,
      email: 'testuser@metrika.local',
      fullName: 'Test User',
      passwordHash,
      status: UserStatus.ACTIVE,
      roles: {
        create: {
          role: {
            connect: { id: memberRole.id },
          },
        },
      },
    },
  });

  return { email: 'testuser@metrika.local', password, userId };
};

describe('API Keys E2E Tests', () => {
  let context: TestAppContext;
  let testUser: { email: string; password: string; userId: string };
  let accessToken: string;

  beforeAll(async () => {
    context = await setupTestApp();
    testUser = await createTestUser(context.prisma);

    // Login to get access token
    const loginResponse = await context.httpClient.post('/api/v1/auth/login').send({
      email: testUser.email,
      password: testUser.password,
    });
    accessToken = loginResponse.body.data.attributes.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('POST /api/v1/api-keys - Generate API Key', () => {
    it('should generate a new API key successfully', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test API Key',
          scopes: ['project:read', 'task:write'],
          expiresInDays: 30,
        });

      expect(status).toBe(201);
      expect(body.data.type).toBe('api-key');
      expect(body.data.attributes.name).toBe('Test API Key');
      expect(body.data.attributes.scopes).toEqual(['project:read', 'task:write']);
      expect(body.meta.plainKey).toMatch(/^mtk_/);
      expect(body.meta.warning).toContain('Store this key securely');
      
      // Verify key is stored in database
      const apiKey = await context.prisma.apiKey.findUnique({
        where: { id: body.data.id },
      });
      expect(apiKey).toBeDefined();
      expect(apiKey!.userId).toBe(testUser.userId);
    });

    it('should reject request without authentication', async () => {
      const { status, body } = await context.httpClient.post('/api/v1/api-keys').send({
        name: 'Unauthorized Key',
      });

      expect(status).toBe(401);
      expect(body.errors).toBeDefined();
    });

    it('should reject invalid request with missing name', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          scopes: ['project:read'],
        });

      expect(status).toBe(422); // Validation error returns 422
      expect(body.errors).toBeDefined();
    });

    it('should use default expiration when not specified', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Default Expiration Key',
          scopes: ['project:read'], // Scopes required
        });

      expect(status).toBe(201);
      expect(body.data.attributes.expiresAt).toBeDefined();
      
      // Verify expiration is approximately 1 year from now (default)
      const expiresAt = new Date(body.data.attributes.expiresAt);
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 365);
      const timeDiff = Math.abs(expiresAt.getTime() - expectedExpiry.getTime());
      expect(timeDiff).toBeLessThan(60000); // Within 1 minute tolerance
    });
  });

  describe('GET /api/v1/api-keys - List API Keys', () => {
    let testKeyId: string;

    beforeAll(async () => {
      // Create a test key for listing
      const response = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'List Test Key',
          scopes: ['project:read'],
        });
      testKeyId = response.body.data.id;
    });

    it('should list all user API keys', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
      
      const foundKey = body.data.find((key: any) => key.id === testKeyId);
      expect(foundKey).toBeDefined();
      expect(foundKey.attributes.name).toBe('List Test Key');
      expect(foundKey.meta.plainKey).toBeUndefined(); // Plain key should not be returned
    });

    it('should include isExpired flag for expired keys', async () => {
      // Create an expired key
      const expiredKey = await context.prisma.apiKey.create({
        data: {
          name: 'Expired Key',
          keyHash: 'hash123',
          userId: testUser.userId,
          scopes: [],
          expiresAt: new Date(Date.now() - 86400000), // Yesterday
        },
      });

      const { status, body } = await context.httpClient
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      const expiredKeyData = body.data.find((key: any) => key.id === expiredKey.id);
      expect(expiredKeyData.meta.isExpired).toBe(true);
    });

    it('should reject request without authentication', async () => {
      const { status, body } = await context.httpClient.get('/api/v1/api-keys');

      expect(status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });

  describe('GET /api/v1/api-keys/:keyId - Get Specific Key', () => {
    let testKeyId: string;

    beforeAll(async () => {
      const response = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Get Test Key',
          scopes: ['task:read'],
        });
      testKeyId = response.body.data.id;
    });

    it('should get specific API key by ID', async () => {
      const { status, body } = await context.httpClient
        .get(`/api/v1/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.id).toBe(testKeyId);
      expect(body.data.attributes.name).toBe('Get Test Key');
      expect(body.data.attributes.scopes).toEqual(['task:read']);
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status, body } = await context.httpClient
        .get(`/api/v1/api-keys/${fakeId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });

    it('should not allow accessing another user\'s key', async () => {
      // Create a key for another user
      const anotherUser = await context.prisma.user.create({
        data: {
          id: uuidv7(),
          email: 'another@metrika.local',
          fullName: 'Another User',
          passwordHash: await hashPassword('Password123!'),
          status: UserStatus.ACTIVE,
        },
      });

      const anotherUsersKey = await context.prisma.apiKey.create({
        data: {
          name: 'Another User Key',
          keyHash: 'hash456',
          userId: anotherUser.id,
          scopes: [],
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const { status, body } = await context.httpClient
        .get(`/api/v1/api-keys/${anotherUsersKey.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(404);
    });
  });

  describe('PATCH /api/v1/api-keys/:keyId - Update API Key', () => {
    let testKeyId: string;

    beforeEach(async () => {
      const uniqueName = `Update Test Key ${Date.now()}-${Math.random()}`;
      const response = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: uniqueName,
          scopes: ['project:read'],
        });
      testKeyId = response.body.data.id;
    });

    it('should update API key name', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Updated Key Name',
        });

      expect(status).toBe(200);
      expect(body.data.attributes.name).toBe('Updated Key Name');
    });

    it('should update API key scopes', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          scopes: ['project:read', 'project:write', 'task:read'],
        });

      expect(status).toBe(200);
      expect(body.data.attributes.scopes).toEqual(['project:read', 'project:write', 'task:read']);
    });

    it('should update expiration date', async () => {
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 60); // 60 days from now

      const { status, body } = await context.httpClient
        .patch(`/api/v1/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          expiresAt: newExpiresAt.toISOString(),
        });

      expect(status).toBe(200);
      expect(new Date(body.data.attributes.expiresAt).toISOString()).toBe(
        newExpiresAt.toISOString(),
      );
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status, body } = await context.httpClient
        .patch(`/api/v1/api-keys/${fakeId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'New Name',
        });

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/api-keys/:keyId/revoke - Revoke API Key', () => {
    let testKeyId: string;

    beforeEach(async () => {
      const uniqueName = `Revoke Test Key ${Date.now()}-${Math.random()}`;
      const response = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: uniqueName,
          scopes: ['project:read'],
        });
      testKeyId = response.body.data.id;
    });

    it('should revoke an API key', async () => {
      const { status, body } = await context.httpClient
        .post(`/api/v1/api-keys/${testKeyId}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.attributes.revokedAt).toBeDefined();
      expect(body.meta.message).toContain('revoked');

      // Verify in database
      const revokedKey = await context.prisma.apiKey.findUnique({
        where: { id: testKeyId },
      });
      expect(revokedKey!.revokedAt).toBeDefined();
    });

    it('should not revoke already revoked key', async () => {
      // Revoke once
      await context.httpClient
        .post(`/api/v1/api-keys/${testKeyId}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`);

      // Try to revoke again
      const { status, body } = await context.httpClient
        .post(`/api/v1/api-keys/${testKeyId}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(422); // Validation error returns 422
      expect(body.errors[0].code).toBe('VALIDATION_FAILED');
      expect(body.errors[0].title).toContain('Validation failed');
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status, body } = await context.httpClient
        .post(`/api/v1/api-keys/${fakeId}/revoke`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/api-keys/:keyId - Delete API Key', () => {
    let testKeyId: string;

    beforeEach(async () => {
      const uniqueName = `Delete Test Key ${Date.now()}-${Math.random()}`;
      const response = await context.httpClient
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: uniqueName,
          scopes: ['project:read'],
        });
      testKeyId = response.body.data.id;
    });

    it('should delete an API key permanently', async () => {
      const { status, body } = await context.httpClient
        .delete(`/api/v1/api-keys/${testKeyId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200); // Now returns 200 instead of 204
      expect(body.meta.message).toContain('deleted');

      // Verify deletion in database
      const deletedKey = await context.prisma.apiKey.findUnique({
        where: { id: testKeyId },
      });
      expect(deletedKey).toBeNull();
    });

    it('should return 404 for non-existent key', async () => {
      const fakeId = uuidv7();
      const { status, body } = await context.httpClient
        .delete(`/api/v1/api-keys/${fakeId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });

    it('should not delete another user\'s key', async () => {
      // Create a key for another user
      const anotherUser = await context.prisma.user.create({
        data: {
          id: uuidv7(),
          email: 'deletetest@metrika.local',
          fullName: 'Delete Test User',
          passwordHash: await hashPassword('Password123!'),
          status: UserStatus.ACTIVE,
        },
      });

      const anotherUsersKey = await context.prisma.apiKey.create({
        data: {
          name: 'Another User Key',
          keyHash: 'hash789',
          userId: anotherUser.id,
          scopes: [],
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const { status, body } = await context.httpClient
        .delete(`/api/v1/api-keys/${anotherUsersKey.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(404);

      // Verify key still exists
      const stillExists = await context.prisma.apiKey.findUnique({
        where: { id: anotherUsersKey.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });
});
