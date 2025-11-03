import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';

describe('System Settings E2E Tests', () => {
  let context: TestAppContext;
  let accessToken: string;
  let adminAccessToken: string;

  beforeAll(async () => {
    context = await setupTestApp();

    // Login as admin user (created by seedCoreRbac)
    const loginRes = await context.httpClient
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@metrika.local',
        password: 'ChangeMeNow123!',
      });
    accessToken = loginRes.body.data.attributes.accessToken;
    
    // For now, use same admin token for both (RBAC will be implemented later)
    adminAccessToken = accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('GET /api/v1/settings/public - Get Public Settings', () => {
    it('should return public settings without authentication', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/public');

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Array);
      
      // All returned settings should be public
      body.data.forEach((setting: any) => {
        expect(setting.type).toBe('system-setting');
        expect(setting.attributes.isPublic).toBe(true);
      });
    });

    it('should include app name and version in public settings', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/public');

      expect(status).toBe(200);
      
      const appName = body.data.find((s: any) => s.attributes.key === 'app.name');
      const appVersion = body.data.find((s: any) => s.attributes.key === 'app.version');
      
      expect(appName).toBeDefined();
      expect(appVersion).toBeDefined();
      expect(appName.attributes.value).toBe('Metrika');
      expect(appVersion.attributes.value).toBe('1.0.0');
    });
  });

  describe('GET /api/v1/settings - List All Settings', () => {
    it('should list all settings with authentication', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
      
      // Should include both public and private settings
      const hasPublic = body.data.some((s: any) => s.attributes.isPublic === true);
      const hasPrivate = body.data.some((s: any) => s.attributes.isPublic === false);
      expect(hasPublic).toBe(true);
      expect(hasPrivate).toBe(true);
    });

    it('should require authentication', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings');

      expect(status).toBe(401);
      expect(body.errors[0].code).toBe('AUTH_UNAUTHORIZED');
    });

    it('should support cache control with useCache query param', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings?useCache=false')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/v1/settings/by-category - Get Settings by Category', () => {
    it('should group settings by category', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/by-category')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Object);
      
      // Should have categories like general, security, notifications, etc.
      expect(body.data.general).toBeDefined();
      expect(body.data.security).toBeDefined();
      expect(body.data.notifications).toBeDefined();
    });

    it('should have settings in correct categories', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/by-category')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      
      // General category should have app name and version
      const generalSettings = body.data.general;
      const hasName = generalSettings.some((s: any) => s.attributes.key === 'app.name');
      const hasVersion = generalSettings.some((s: any) => s.attributes.key === 'app.version');
      expect(hasName).toBe(true);
      expect(hasVersion).toBe(true);
    });
  });

  describe('GET /api/v1/settings/:key - Get Specific Setting', () => {
    it('should get a specific setting by key', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/app.name')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('system-setting');
      expect(body.data.attributes.key).toBe('app.name');
      expect(body.data.attributes.value).toBe('Metrika');
      expect(body.data.attributes.dataType).toBe('string');
    });

    it('should return 404 for non-existent setting', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/settings/nonexistent.key')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/settings - Create Setting', () => {
    it('should create a new setting', async () => {
      const settingData = {
        key: `test.setting.${Date.now()}`,
        value: 'test-value',
        dataType: 'string',
        description: 'Test setting',
        category: 'test',
        isPublic: false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(settingData);

      expect(status).toBe(201);
      expect(body.data.type).toBe('system-setting');
      expect(body.data.attributes.key).toBe(settingData.key);
      expect(body.data.attributes.value).toBe(settingData.value);

      // Verify in database
      const dbSetting = await context.prisma.systemSetting.findUnique({
        where: { key: settingData.key },
      });
      expect(dbSetting).not.toBeNull();
      expect(dbSetting!.value).toBe(settingData.value);
    });

    it('should validate data type for number', async () => {
      const settingData = {
        key: `test.number.${Date.now()}`,
        value: 42,
        dataType: 'number',
        description: 'Test number setting',
        category: 'test',
        isPublic: false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(settingData);

      expect(status).toBe(201);
      expect(body.data.attributes.value).toBe(42);
    });

    it('should validate data type for boolean', async () => {
      const settingData = {
        key: `test.boolean.${Date.now()}`,
        value: true,
        dataType: 'boolean',
        description: 'Test boolean setting',
        category: 'test',
        isPublic: false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(settingData);

      expect(status).toBe(201);
      expect(body.data.attributes.value).toBe(true);
    });

    it('should validate data type for json', async () => {
      const jsonValue = { foo: 'bar', nested: { value: 123 } };
      const settingData = {
        key: `test.json.${Date.now()}`,
        value: jsonValue,
        dataType: 'json',
        description: 'Test JSON setting',
        category: 'test',
        isPublic: false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(settingData);

      expect(status).toBe(201);
      expect(body.data.attributes.value).toEqual(jsonValue);
    });

    it('should reject invalid data type', async () => {
      const settingData = {
        key: `test.invalid.${Date.now()}`,
        value: 'string-value',
        dataType: 'number', // Type mismatch
        description: 'Test invalid type',
        category: 'test',
        isPublic: false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(settingData);

      expect(status).toBe(422);
      expect(body.errors[0].code).toBe('VALIDATION_FAILED');
    });

    it('should prevent duplicate keys', async () => {
      const key = `test.duplicate.${Date.now()}`;
      
      // Create first setting
      await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          key,
          value: 'first',
          dataType: 'string',
          description: 'First',
          category: 'test',
          isPublic: false,
        });

      // Try to create duplicate
      const { status, body } = await context.httpClient
        .post('/api/v1/settings')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          key,
          value: 'second',
          dataType: 'string',
          description: 'Second',
          category: 'test',
          isPublic: false,
        });

      expect(status).toBe(409);
      expect(body.errors[0].code).toBe('RESOURCE_CONFLICT');
    });
  });

  describe('PATCH /api/v1/settings/:key - Update Setting', () => {
    let testKey: string;

    beforeAll(async () => {
      testKey = `test.update.${Date.now()}`;
      await context.prisma.systemSetting.create({
        data: {
          key: testKey,
          value: 'initial-value',
          dataType: 'string',
          description: 'Test update setting',
          category: 'test',
          isPublic: false,
        },
      });
    });

    it('should update setting value', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/settings/${testKey}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ value: 'updated-value' });

      expect(status).toBe(200);
      expect(body.data.attributes.value).toBe('updated-value');

      // Verify in database
      const dbSetting = await context.prisma.systemSetting.findUnique({
        where: { key: testKey },
      });
      expect(dbSetting!.value).toBe('updated-value');
    });

    it('should update description and category', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/settings/${testKey}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          description: 'Updated description',
          category: 'updated',
        });

      expect(status).toBe(200);
      expect(body.data.attributes.description).toBe('Updated description');
      expect(body.data.attributes.category).toBe('updated');
    });

    it('should update isPublic flag', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/settings/${testKey}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ isPublic: true });

      expect(status).toBe(200);
      expect(body.data.attributes.isPublic).toBe(true);
    });

    it('should validate data type when updating value', async () => {
      const { status, body } = await context.httpClient
        .patch(`/api/v1/settings/${testKey}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ value: 123 }); // Wrong type (should be string)

      expect(status).toBe(422);
      expect(body.errors[0].code).toBe('VALIDATION_FAILED');
    });

    it('should return 404 for non-existent setting', async () => {
      const { status, body } = await context.httpClient
        .patch('/api/v1/settings/nonexistent.key')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ value: 'test' });

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/settings/bulk-update - Bulk Update Settings', () => {
    it('should update multiple settings at once', async () => {
      const key1 = `test.bulk1.${Date.now()}`;
      const key2 = `test.bulk2.${Date.now()}`;

      // Create test settings
      await context.prisma.systemSetting.createMany({
        data: [
          {
            key: key1,
            value: 'value1',
            dataType: 'string',
            description: 'Bulk test 1',
            category: 'test',
            isPublic: false,
          },
          {
            key: key2,
            value: 'value2',
            dataType: 'string',
            description: 'Bulk test 2',
            category: 'test',
            isPublic: false,
          },
        ],
      });

      const { status, body } = await context.httpClient
        .post('/api/v1/settings/bulk-update')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          updates: [
            { key: key1, value: 'updated1' },
            { key: key2, value: 'updated2' },
          ],
        });

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBe(2);

      // Verify in database
      const setting1 = await context.prisma.systemSetting.findUnique({
        where: { key: key1 },
      });
      const setting2 = await context.prisma.systemSetting.findUnique({
        where: { key: key2 },
      });

      expect(setting1!.value).toBe('updated1');
      expect(setting2!.value).toBe('updated2');
    });

    it('should include update count in meta', async () => {
      const key = `test.bulk.meta.${Date.now()}`;
      await context.prisma.systemSetting.create({
        data: {
          key,
          value: 'initial',
          dataType: 'string',
          description: 'Test',
          category: 'test',
          isPublic: false,
        },
      });

      const { status, body } = await context.httpClient
        .post('/api/v1/settings/bulk-update')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          updates: [{ key, value: 'updated' }],
        });

      expect(status).toBe(200);
      expect(body.meta.updated).toBe(1);
    });
  });

  describe('POST /api/v1/settings/clear-cache - Clear Cache', () => {
    it('should clear the settings cache', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/settings/clear-cache')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.meta.message).toContain('cache cleared');
    });
  });

  describe('DELETE /api/v1/settings/:key - Delete Setting', () => {
    it('should delete a setting', async () => {
      const key = `test.delete.${Date.now()}`;
      await context.prisma.systemSetting.create({
        data: {
          key,
          value: 'to-delete',
          dataType: 'string',
          description: 'Test delete',
          category: 'test',
          isPublic: false,
        },
      });

      const { status, body } = await context.httpClient
        .delete(`/api/v1/settings/${key}`)
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(200);
      expect(body.meta.message).toContain('deleted');

      // Verify deleted from database
      const dbSetting = await context.prisma.systemSetting.findUnique({
        where: { key },
      });
      expect(dbSetting).toBeNull();
    });

    it('should return 404 when deleting non-existent setting', async () => {
      const { status, body } = await context.httpClient
        .delete('/api/v1/settings/nonexistent.key')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(status).toBe(404);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });
  });
});
