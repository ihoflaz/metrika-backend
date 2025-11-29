import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { randomUUID } from 'crypto';
import { setupTestApp, teardownTestApp } from '../utils/test-app';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

function binaryParser(res: any, callback: any) {
  res.setEncoding('binary');
  res.data = '';
  res.on('data', (chunk: string) => {
    res.data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(res.data, 'binary'));
  });
}

describe('Export E2E Tests', () => {
  let testContext: any;
  let adminToken: string;
  let adminUser: any;
  let testProject: any;
  let testKPI: any;

  beforeAll(async () => {
    testContext = await setupTestApp();
    const httpClient = testContext.httpClient;
    const prisma = testContext.prisma;

    adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
    });

    const { status: loginStatus, body: loginBody } = await httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    if (loginStatus !== 200) {
      throw new Error(`Unable to log in seeded admin user for export tests (status ${loginStatus})`);
    }

    adminToken = loginBody.data.attributes.accessToken;

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
        sponsor: { connect: { id: adminUser.id } },
      },
    });

    // Create test KPI
    const kpiCode = `KPI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    testKPI = await prisma.kPIDefinition.create({
      data: {
        id: randomUUID(),
        code: kpiCode,
        name: 'Test Export KPI',
        description: 'Test KPI for export',
        category: 'FINANCIAL',
        calculationFormula: 'SUM(values)',
        targetValue: 100,
        unit: 'USD',
        aggregationPeriod: 'MONTHLY',
        dataSourceType: 'MANUAL',
        status: 'ACTIVE',
        stewardId: adminUser.id,
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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('kpi-dashboard');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
