import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupTestApp, teardownTestApp } from '../utils/test-app';
import { randomUUID } from 'crypto';

describe('Export E2E Tests', () => {
  let testContext: any;
  let adminToken: string;
  let testUser: any;
  let testProject: any;
  let testKPI: any;

  beforeAll(async () => {
    testContext = await setupTestApp();
    const httpClient = testContext.httpClient;
    const prisma = testContext.prisma;

    // Create admin user with role
    const adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
    
    testUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `admin-export-${randomUUID()}@test.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test$test', // dummy hash
        fullName: 'Export Test Admin',
        userRoles: {
          create: {
            roleId: adminRole!.id,
          },
        },
      },
    });

    // Login to get token (mock - just create token manually)
    adminToken = 'mock-admin-token-for-export-tests';

    // Create test project
    testProject = await prisma.project.create({
      data: {
        id: randomUUID(),
        code: `PRJ-TEST-${Date.now()}`,
        name: 'Test Export Project',
        description: 'Test project for export',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        owner: { connect: { id: testUser.id } },
        progress: 50,
      },
    });

    // Create test KPI
    testKPI = await prisma.kPIDefinition.create({
      data: {
        id: randomUUID(),
        code: `KPI-TEST-${Date.now()}`,
        name: 'Test Export KPI',
        description: 'Test KPI for export',
        category: 'FINANCIAL',
        calculationFormula: 'SUM(values)',
        targetValue: 100,
        unit: 'USD',
        aggregationPeriod: 'MONTHLY',
        dataSourceType: 'MANUAL',
        status: 'ACTIVE',
        stewardId: testUser.id,
      },
    });

    // Add KPI data point
    await prisma.kPISeries.create({
      data: {
        id: randomUUID(),
        kpiId: testKPI.id,
        periodStart: new Date(),
        periodEnd: new Date(),
        actualValue: 85,
        valueSource: 'MANUAL_ENTRY',
        verificationStatus: 'VERIFIED',
      },
    });
  });

  afterAll(async () => {
    await teardownTestApp(testContext);
  });

  test('GET /api/v1/reports/portfolio-summary/export - should export Excel file', async () => {
    const res = await testContext.httpClient
      .get('/api/v1/reports/portfolio-summary/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('portfolio-summary');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/reports/kpi-dashboard/export - should export Excel file', async () => {
    const res = await testContext.httpClient
      .get('/api/v1/reports/kpi-dashboard/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('kpi-dashboard');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/reports/task-metrics/export - should export Excel file', async () => {
    const res = await testContext.httpClient
      .get('/api/v1/reports/task-metrics/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('task-metrics');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/kpis/:kpiId/export - should export single KPI Excel file', async () => {
    const res = await testContext.httpClient
      .get(`/api/v1/kpis/${testKPI.id}/export`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('kpi-');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/reports/portfolio-summary/export/pdf - should export PDF file', async () => {
    const res = await testContext.httpClient
      .get('/api/v1/reports/portfolio-summary/export/pdf')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('portfolio-summary');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/v1/reports/kpi-dashboard/export/pdf - should export PDF file', async () => {
    const res = await testContext.httpClient
      .get('/api/v1/reports/kpi-dashboard/export/pdf')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('kpi-dashboard');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
