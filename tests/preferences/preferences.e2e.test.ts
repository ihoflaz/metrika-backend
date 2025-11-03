import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';

describe('User Preferences E2E Tests', () => {
  let context: TestAppContext;
  let accessToken: string;
  let userId: string;

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
    userId = loginRes.body.data.id;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('GET /api/v1/user/preferences - Get All Preferences', () => {
    it('should return all preferences with defaults', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('user-preferences');
      expect(body.data.id).toBeDefined(); // Should have user ID
      expect(body.data.attributes).toBeInstanceOf(Object);
      
      // Should include default preferences
      expect(body.data.attributes['ui.theme']).toBe('auto'); // Default value
      expect(body.data.attributes['ui.language']).toBeDefined();
    });

    it('should filter preferences by keys query param', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences?keys=ui.theme&keys=ui.language')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('user-preferences');
      expect(body.data.attributes).toBeInstanceOf(Object);
      expect(Object.keys(body.data.attributes).length).toBe(2);
      
      expect(body.data.attributes['ui.theme']).toBeDefined();
      expect(body.data.attributes['ui.language']).toBeDefined();
    });

    it('should require authentication', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences');

      expect(status).toBe(401);
      expect(body.errors[0].code).toBe('AUTH_UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/user/preferences/:key - Get Specific Preference', () => {
    it('should get a specific preference with default value', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/ui.theme')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('user-preference');
      expect(body.data.attributes.key).toBe('ui.theme');
      expect(body.data.attributes.value).toBe('auto');
    });

    it('should return null for non-default preference key', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/custom.key')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('user-preference');
      expect(body.data.attributes.value).toBeNull();
    });
  });

  describe('PUT /api/v1/user/preferences/:key - Set Preference', () => {
    it('should set a new preference value', async () => {
      const { status, body } = await context.httpClient
        .put('/api/v1/user/preferences/ui.theme')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'dark' });

      expect(status).toBe(200);
      expect(body.data.attributes.key).toBe('ui.theme');
      expect(body.data.attributes.value).toBe('dark');

      // Verify in database
      const dbPref = await context.prisma.userPreference.findFirst({
        where: {
          userId,
          key: 'ui.theme',
        },
      });
      expect(dbPref).not.toBeNull();
      expect(dbPref!.value).toBe('dark');
    });

    it('should update existing preference', async () => {
      // Set initial value
      await context.httpClient
        .put('/api/v1/user/preferences/ui.language')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'tr' });

      // Update to new value
      const { status, body } = await context.httpClient
        .put('/api/v1/user/preferences/ui.language')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'en' });

      expect(status).toBe(200);
      expect(body.data.attributes.value).toBe('en');

      // Verify only one record exists
      const count = await context.prisma.userPreference.count({
        where: {
          userId,
          key: 'ui.language',
        },
      });
      expect(count).toBe(1);
    });

    it('should allow setting custom preference keys', async () => {
      const { status, body } = await context.httpClient
        .put('/api/v1/user/preferences/custom.setting')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'test-value' });

      expect(status).toBe(200);
      expect(body.data.attributes.key).toBe('custom.setting');
      expect(body.data.attributes.value).toBe('test-value');
    });

    it('should require value in request body', async () => {
      const { status, body } = await context.httpClient
        .put('/api/v1/user/preferences/ui.theme')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(status).toBe(422);
      expect(body.errors[0].code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /api/v1/user/preferences/bulk - Bulk Set Preferences', () => {
    it('should set multiple preferences at once', async () => {
      const preferences = {
        'ui.theme': 'light',
        'ui.language': 'tr',
        'ui.dateFormat': 'DD/MM/YYYY',
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ preferences });

      expect(status).toBe(200);
      expect(body.data).toBeInstanceOf(Object);
      expect(body.data.type).toBe('bulk-preferences-result');
      expect(body.data.attributes.updatedCount).toBe(3);

      // Verify in database
      const dbPrefs = await context.prisma.userPreference.findMany({
        where: {
          userId,
          key: { in: Object.keys(preferences) },
        },
      });
      expect(dbPrefs.length).toBe(3);
    });

    it('should return count in attributes', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'ui.theme': 'dark',
            'ui.language': 'en',
          },
        });

      expect(status).toBe(200);
      expect(body.data.attributes.updatedCount).toBe(2);
    });

    it('should accept any preference keys', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'ui.theme': 'dark',
            'custom.key': 'custom-value',
          },
        });

      expect(status).toBe(200);
      expect(body.data.attributes.updatedCount).toBe(2);
    });
  });

  describe('DELETE /api/v1/user/preferences/:key - Delete Preference', () => {
    it('should delete preference and revert to default', async () => {
      // Set a custom value first (note: ui.sidebarWidth is not in DEFAULT_PREFERENCES)
      await context.httpClient
        .put('/api/v1/user/preferences/ui.language')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'tr' });

      // Delete it
      const { status } = await context.httpClient
        .delete('/api/v1/user/preferences/ui.language')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(204);

      // Verify deleted from database
      const dbPref = await context.prisma.userPreference.findFirst({
        where: {
          userId,
          key: 'ui.language',
        },
      });
      expect(dbPref).toBeNull();

      // Verify returns default value now
      const getRes = await context.httpClient
        .get('/api/v1/user/preferences/ui.language')
        .set('Authorization', `Bearer ${accessToken}`);
      
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.attributes.value).toBe('en'); // Default value
    });

    it('should succeed when deleting non-existent preference (idempotent)', async () => {
      // Try to delete a preference that was never set
      const { status } = await context.httpClient
        .delete('/api/v1/user/preferences/custom.never.set')
        .set('Authorization', `Bearer ${accessToken}`);

      // Should succeed even if not exists (idempotent)
      expect(status).toBe(204);
    });

    it('should allow deleting any preference key', async () => {
      // Set a custom preference first
      await context.httpClient
        .put('/api/v1/user/preferences/custom.deletable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ value: 'will-be-deleted' });

      const { status } = await context.httpClient
        .delete('/api/v1/user/preferences/custom.deletable')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(204);
    });
  });

  describe('GET /api/v1/user/preferences/notifications - Get Notification Preferences', () => {
    it('should return structured notification preferences', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/notifications')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('notification-preferences');
      expect(body.data.attributes).toHaveProperty('emailEnabled');
      expect(body.data.attributes).toHaveProperty('taskAssigned');
      expect(body.data.attributes).toHaveProperty('taskCompleted');
      expect(body.data.attributes).toHaveProperty('taskDelayed');
      expect(body.data.attributes).toHaveProperty('kpiBreach');
      expect(body.data.attributes).toHaveProperty('documentApproval');
    });

    it('should reflect custom notification preferences', async () => {
      // Set custom values
      await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'notifications.email.enabled': false,
            'notifications.task.assigned': false,
          },
        });

      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/notifications')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.attributes.emailEnabled).toBe(false);
      expect(body.data.attributes.taskAssigned).toBe(false);
    });
  });

  describe('GET /api/v1/user/preferences/ui - Get UI Preferences', () => {
    it('should return structured UI preferences', async () => {
      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/ui')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('ui-preferences');
      expect(body.data.attributes).toHaveProperty('theme');
      expect(body.data.attributes).toHaveProperty('language');
      expect(body.data.attributes).toHaveProperty('dateFormat');
      expect(body.data.attributes).toHaveProperty('timezone');
      expect(body.data.attributes).toHaveProperty('tablePageSize');
      expect(body.data.attributes).toHaveProperty('sidebarCollapsed');
      expect(body.data.attributes).toHaveProperty('kanbanCompactMode');
    });

    it('should reflect custom UI preferences', async () => {
      // Set custom values
      await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'ui.theme': 'dark',
            'ui.language': 'tr',
            'ui.table.pageSize': 50,
          },
        });

      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/ui')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.attributes.theme).toBe('dark');
      expect(body.data.attributes.language).toBe('tr');
      expect(body.data.attributes.tablePageSize).toBe(50);
    });
  });

  describe('GET /api/v1/user/preferences/export - Export Preferences', () => {
    it('should export all preferences as JSON', async () => {
      // Set some custom preferences
      await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'ui.theme': 'dark',
            'ui.language': 'en',
            'notifications.email.enabled': true,
          },
        });

      const { status, body } = await context.httpClient
        .get('/api/v1/user/preferences/export')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.userId).toBeDefined();
      expect(body.exportedAt).toBeDefined();
      expect(body.preferences).toBeInstanceOf(Object);
      
      // Should include custom values
      expect(body.preferences['ui.theme']).toBe('dark');
      expect(body.preferences['ui.language']).toBe('en');
    });
  });

  describe('POST /api/v1/user/preferences/import - Import Preferences', () => {
    it('should import preferences from JSON', async () => {
      const preferences = {
        'ui.theme': 'light',
        'ui.language': 'tr',
        'ui.dateFormat': 'DD/MM/YYYY',
        'notifications.email.enabled': false,
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ preferences });

      expect(status).toBe(200);
      expect(body.data.type).toBe('import-result');
      expect(body.data.attributes.importedCount).toBe(4);
      expect(body.data.attributes.totalProvided).toBe(4);

      // Verify in database
      const dbPrefs = await context.prisma.userPreference.findMany({
        where: {
          userId,
          key: { in: Object.keys(preferences) },
        },
      });
      expect(dbPrefs.length).toBe(4);
    });

    it('should import all provided preferences', async () => {
      const preferences = {
        'ui.theme': 'dark',
        'custom.key': 'custom-value',
        'ui.language': 'en',
      };

      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ preferences });

      expect(status).toBe(200);
      expect(body.data.type).toBe('import-result');
      expect(body.data.attributes.importedCount).toBe(3);
      expect(body.data.attributes.totalProvided).toBe(3);
    });

    it('should require preferences object', async () => {
      const { status, body } = await context.httpClient
        .post('/api/v1/user/preferences/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(status).toBe(422);
      expect(body.errors[0].code).toBe('VALIDATION_FAILED');
    });
  });

  describe('DELETE /api/v1/user/preferences - Delete All Preferences', () => {
    it('should delete all user preferences', async () => {
      // Set some preferences
      await context.httpClient
        .post('/api/v1/user/preferences/bulk')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          preferences: {
            'ui.theme': 'dark',
            'ui.language': 'tr',
            'ui.dateFormat': 'DD/MM/YYYY',
          },
        });

      // Delete all
      const { status, body } = await context.httpClient
        .delete('/api/v1/user/preferences')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(status).toBe(200);
      expect(body.data.type).toBe('delete-result');
      expect(body.data.attributes.deletedCount).toBeGreaterThan(0);

      // Verify all deleted
      const count = await context.prisma.userPreference.count({
        where: { userId },
      });
      expect(count).toBe(0);

      // Verify defaults are returned
      const getRes = await context.httpClient
        .get('/api/v1/user/preferences/ui.theme')
        .set('Authorization', `Bearer ${accessToken}`);
      
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.attributes.value).toBe('auto'); // Default
    });
  });
});
