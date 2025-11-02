import request from 'supertest';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';

describe('Audit Export E2E', () => {
  let testApp: TestAppContext;
  let httpClient: ReturnType<typeof request>;
  let authToken: string;

  beforeAll(async () => {
    testApp = await setupTestApp();
    httpClient = testApp.httpClient;

    // Login as admin to get auth token
    const loginRes = await httpClient
      .post('/api/v1/auth/login')
      .send({ email: 'admin@metrika.local', password: 'ChangeMeNow123!' })
      .expect(200);

    authToken = loginRes.body.data.attributes.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(testApp);
  });

  describe('GET /api/v1/audit/export - Authentication', () => {
    it('should return 401 when accessing audit export without token', async () => {
      await httpClient.get('/api/v1/audit/export').expect(401);
    });
  });

  describe('GET /api/v1/audit/export - JSON Format', () => {
    it('should export audit logs in JSON format', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toMatch(/audit-logs-.*\.json/);

      // Parse JSON response
      const logs = JSON.parse(res.text);
      expect(Array.isArray(logs)).toBe(true);
      
      // Should have at least one log entry (from admin login)
      expect(logs.length).toBeGreaterThan(0);
      
      // Check log structure
      if (logs.length > 0) {
        const log = logs[0];
        expect(log).toHaveProperty('id');
        expect(log).toHaveProperty('actorType');
        expect(log).toHaveProperty('eventCode');
        expect(log).toHaveProperty('createdAt');
      }
    });

    it('should filter audit logs by date range', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const res = await httpClient
        .get(`/api/v1/audit/export?format=json&startDate=${yesterday.toISOString()}&endDate=${tomorrow.toISOString()}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const logs = JSON.parse(res.text);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should filter audit logs by event code', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json&eventCode=AUTH_LOGIN_SUCCESS')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const logs = JSON.parse(res.text);
      expect(Array.isArray(logs)).toBe(true);
      
      // All logs should have AUTH_LOGIN_SUCCESS event code
      logs.forEach((log: any) => {
        expect(log.eventCode).toBe('AUTH_LOGIN_SUCCESS');
      });
    });

    it('should filter audit logs by actor type', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json&actorType=USER')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const logs = JSON.parse(res.text);
      expect(Array.isArray(logs)).toBe(true);
      
      // All logs should have USER actor type
      logs.forEach((log: any) => {
        expect(log.actorType).toBe('USER');
      });
    });
  });

  describe('GET /api/v1/audit/export - CSV Format', () => {
    it('should export audit logs in CSV format', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=csv')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toMatch(/audit-logs-.*\.csv/);

      // Check CSV content structure
      const csvContent = res.text;
      expect(csvContent).toContain('id,actorType,actorId,actorEmail,actorName,eventCode,description,ipAddress,userAgent,createdAt');
      
      // Should have data rows (more than just header)
      const lines = csvContent.split('\n').filter((line) => line.trim() !== '');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should handle empty result set in CSV format', async () => {
      // Query with date range in the far past
      const pastDate = new Date('2000-01-01');
      
      const res = await httpClient
        .get(`/api/v1/audit/export?format=csv&startDate=${pastDate.toISOString()}&endDate=${pastDate.toISOString()}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const csvContent = res.text;
      // Should only have header
      expect(csvContent).toBe('id,actorType,actorId,actorEmail,actorName,eventCode,description,ipAddress,userAgent,createdAt\n');
    });
  });

  describe('GET /api/v1/audit/export - Validation', () => {
    it('should return 400 for invalid format', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=xml')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].code).toBe('INVALID_FORMAT');
    });

    it('should return 400 for invalid start date', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json&startDate=invalid-date')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].code).toBe('INVALID_START_DATE');
    });

    it('should return 400 for invalid end date', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json&endDate=not-a-date')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].code).toBe('INVALID_END_DATE');
    });

    it('should return 400 for invalid actor type', async () => {
      const res = await httpClient
        .get('/api/v1/audit/export?format=json&actorType=INVALID')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].code).toBe('INVALID_ACTOR_TYPE');
    });
  });

  describe('GET /api/v1/audit/export - Combined Filters', () => {
    it('should apply multiple filters together', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const res = await httpClient
        .get(`/api/v1/audit/export?format=json&startDate=${yesterday.toISOString()}&endDate=${tomorrow.toISOString()}&eventCode=AUTH_LOGIN_SUCCESS&actorType=USER`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const logs = JSON.parse(res.text);
      expect(Array.isArray(logs)).toBe(true);
      
      // All logs should match all filters
      logs.forEach((log: any) => {
        expect(log.eventCode).toBe('AUTH_LOGIN_SUCCESS');
        expect(log.actorType).toBe('USER');
        const logDate = new Date(log.createdAt);
        expect(logDate.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(logDate.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });
  });
});
