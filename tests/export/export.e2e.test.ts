import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.service';
import { uuidv7 } from 'uuidv7';
import { ROLES } from '../../src/modules/rbac/permissions';

// Binary parser for file downloads
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

let context: TestAppContext;
let prisma: PrismaClient;
let httpClient: ReturnType<typeof request>;

describe('Export API E2E Tests', () => {
  let projectId: string;
  let taskIds: string[] = [];
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    httpClient = context.httpClient;

    // Create test user with role
    userId = uuidv7();
    const password = 'TestPass123!';
    const passwordHash = await hashPassword(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.PROJECT_MANAGER } });

    const email = `export-test-${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email,
        fullName: 'Export Test User',
        passwordHash,
        status: 'ACTIVE',
        roles: {
          create: {
            role: { connect: { id: role.id } },
          },
        },
      },
    });

    // Login to get token
    const loginRes = await httpClient.post('/api/v1/auth/login').send({ email, password });
    authToken = loginRes.body.data.attributes.accessToken;
    
    // Debug: Verify token was obtained
    if (!authToken) {
      console.error('❌ Failed to obtain auth token!', loginRes.body);
      throw new Error('Auth token not obtained');
    }
    console.log('✅ Auth token obtained successfully');

    // Create test project
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        name: 'Export Test Project',
        code: 'EXP-TEST-001',
        status: 'ACTIVE',
        startDate: new Date('2025-11-01'),
        sponsorId: userId,
      },
    });
    projectId = project.id;

    // Create test tasks with various statuses
    const taskData = [
      {
        title: 'Task 1 - Completed',
        status: 'COMPLETED' as const,
        priority: 'HIGH' as const,
        progressPct: 100,
      },
      {
        title: 'Task 2 - In Progress',
        status: 'IN_PROGRESS' as const,
        priority: 'NORMAL' as const,
        progressPct: 50,
      },
      {
        title: 'Task 3 - Planned',
        status: 'PLANNED' as const,
        priority: 'CRITICAL' as const,
        progressPct: 0,
      },
      {
        title: 'Task 4 - Blocked',
        status: 'BLOCKED' as const,
        priority: 'HIGH' as const,
        progressPct: 25,
      },
      {
        title: 'Task 5 - On Hold',
        status: 'ON_HOLD' as const,
        priority: 'LOW' as const,
        progressPct: 10,
      },
    ];

    for (const data of taskData) {
      const task = await prisma.task.create({
        data: {
          id: uuidv7(),
          ...data,
          description: `Description for ${data.title}`,
          projectId: project.id,
          ownerId: userId,
          plannedStart: new Date('2025-11-01'),
          plannedEnd: new Date('2025-11-30'),
          effortPlannedHours: 40,
          effortLoggedHours: 20,
        },
      });
      taskIds.push(task.id);
    }
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('POST /api/v1/export/tasks/excel', () => {
    test('should export tasks to Excel without filters', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          metadata: {
            title: 'All Tasks Report',
            author: 'Test User',
          },
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('tasks_');
      expect(res.headers['content-disposition']).toContain('.xlsx');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('should export tasks with project filter', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
          },
          metadata: {
            title: 'Project Tasks Report',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('should export tasks with status filter', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
            status: ['COMPLETED', 'IN_PROGRESS'],
          },
          metadata: {
            title: 'Active Tasks Report',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('should export tasks with priority filter', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
            priority: ['CRITICAL', 'HIGH'],
          },
          metadata: {
            title: 'High Priority Tasks',
            author: 'PMO Team',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('should export tasks with date range filter', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
            startDate: '2025-11-01T00:00:00.000Z',
            endDate: '2025-11-30T23:59:59.999Z',
          },
          metadata: {
            title: 'November Tasks',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('should handle empty result set', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: '00000000-0000-0000-0000-000000000000', // Valid UUID format, non-existent project
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('should validate invalid filters', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel').set('Authorization', `Bearer ${authToken}`).send({
          filters: {
            projectId: 'invalid-uuid',
          },
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/export/tasks/pdf', () => {
    test('should export tasks to PDF without filters', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          metadata: {
            title: 'All Tasks Report',
            author: 'Test User',
          },
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('tasks_');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
      // Check PDF magic number
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    test('should export tasks with A4 portrait layout', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
          },
          styling: {
            pageSize: 'A4',
            orientation: 'portrait',
          },
          metadata: {
            title: 'Tasks Report - A4 Portrait',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    test('should export tasks with landscape layout', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
          },
          styling: {
            pageSize: 'A4',
            orientation: 'landscape',
          },
          metadata: {
            title: 'Tasks Report - Landscape',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    test('should export tasks with Letter page size', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
          },
          styling: {
            pageSize: 'Letter',
            orientation: 'portrait',
          },
          metadata: {
            title: 'Tasks Report - Letter',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('should export tasks with all filters combined', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: {
            projectId: projectId,
            status: ['IN_PROGRESS', 'PLANNED'],
            priority: ['HIGH', 'CRITICAL'],
            startDate: '2025-11-01T00:00:00.000Z',
            endDate: '2025-11-30T23:59:59.999Z',
          },
          styling: {
            pageSize: 'A4',
            orientation: 'landscape',
          },
          metadata: {
            title: 'Filtered Tasks Report',
            author: 'PMO Team',
            subject: 'Active High Priority Tasks',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    });

    test('should handle invalid page size', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf').set('Authorization', `Bearer ${authToken}`).send({
          styling: {
            pageSize: 'Invalid',
            orientation: 'portrait',
          },
        });

      expect(res.status).toBe(400);
    });

    test('should handle invalid orientation', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf').set('Authorization', `Bearer ${authToken}`).send({
          styling: {
            pageSize: 'A4',
            orientation: 'invalid',
          },
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing request body', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send();

      // Should still work with empty body (no filters)
      expect(res.status).toBe(200);
    });

    test('should handle invalid JSON', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Content-Type', 'application/json')
        .send('invalid-json');

      expect(res.status).toBe(400);
    });

    test('should handle malformed date filters', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel').set('Authorization', `Bearer ${authToken}`).send({
          filters: {
            startDate: 'not-a-date',
            endDate: 'also-not-a-date',
          },
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Performance Tests', () => {
    test('Excel export should complete within reasonable time', async () => {
      const startTime = Date.now();

      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: { projectId },
        });

      const duration = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('PDF export should complete within reasonable time', async () => {
      const startTime = Date.now();

      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({
          filters: { projectId },
        });

      const duration = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(10000); // PDF takes longer (Puppeteer), 10 seconds max
    });
  });

  describe('Content Validation', () => {
    test('Excel export should have correct MIME type', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({ filters: { projectId } });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });

    test('PDF export should have valid PDF header', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .send({ filters: { projectId } });

      expect(res.status).toBe(200);
      const pdfHeader = res.body.toString('utf8', 0, 4);
      expect(pdfHeader).toBe('%PDF');
    });

    test('Excel export should have meaningful filename', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/excel').set('Authorization', `Bearer ${authToken}`).send({ filters: { projectId } });

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toMatch(/tasks_\d{8}_\d{6}\.xlsx/);
    });

    test('PDF export should have meaningful filename', async () => {
      const res = await httpClient
        .post('/api/v1/export/tasks/pdf').set('Authorization', `Bearer ${authToken}`).send({ filters: { projectId } });

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toMatch(/tasks_\d{8}_\d{6}\.pdf/);
    });
  });

  // ========================================
  // PORTFOLIO EXPORT TESTS (FR-45)
  // ========================================
  describe('Portfolio Export', () => {
    test('GET /export/portfolio/summary - should export portfolio summary', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/portfolio-summary-\d{4}-\d{2}-\d{2}\.xlsx/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('Portfolio export should require authentication', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary');

      expect(res.status).toBe(401);
    });

    test('Portfolio export should include accessible projects', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      
      // Verify Excel file structure by checking for signature
      const signature = res.body.toString('hex', 0, 4);
      expect(signature).toBe('504b0304'); // ZIP signature (Excel files are ZIP)
    });
  });

  // ========================================
  // KPI DASHBOARD EXPORT TESTS (Day 12)
  // ========================================
  describe('KPI Dashboard Export', () => {
    test('GET /export/kpi/dashboard - should export KPI dashboard', async () => {
      const res = await httpClient
        .get('/api/v1/export/kpi/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/kpi-dashboard-\d{4}-\d{2}-\d{2}\.xlsx/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('KPI dashboard export should require authentication', async () => {
      const res = await httpClient
        .get('/api/v1/export/kpi/dashboard');

      expect(res.status).toBe(401);
    });

    test('KPI dashboard export should have valid Excel structure', async () => {
      const res = await httpClient
        .get('/api/v1/export/kpi/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const signature = res.body.toString('hex', 0, 4);
      expect(signature).toBe('504b0304'); // ZIP signature
    });
  });

  // ========================================
  // SINGLE KPI EXPORT TESTS (Day 12)
  // ========================================
  describe('Single KPI Export', () => {
    let testKpiId: string;

    beforeAll(async () => {
      // Create a test KPI
      const kpiRes = await httpClient
        .post('/api/v1/kpis')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: 'TEST-KPI-001',
          name: 'Test KPI for Export',
          description: 'Test KPI for export testing',
          category: 'FINANCIAL',
          calculationFormula: 'SUM(values)',
          targetValue: 100,
          unit: 'units',
          thresholdWarning: 10,
          thresholdCritical: 20,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: userId,
          approverId: userId,
        });

      expect(kpiRes.status).toBe(201);
      expect(kpiRes.body.data).toHaveProperty('id');
      testKpiId = kpiRes.body.data.id;
      console.log(`✅ Test KPI created: ${testKpiId}`);
    });

    test('GET /export/kpi/:kpiId - should export single KPI', async () => {
      const res = await httpClient
        .get(`/api/v1/export/kpi/${testKpiId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/kpi-TEST-KPI-001-\d{4}-\d{2}-\d{2}\.xlsx/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('Single KPI export should require authentication', async () => {
      const res = await httpClient
        .get(`/api/v1/export/kpi/${testKpiId}`);

      expect(res.status).toBe(401);
    });

    test('Single KPI export should return 404 for non-existent KPI', async () => {
      const fakeKpiId = '00000000-0000-0000-0000-000000000000';
      const res = await httpClient
        .get(`/api/v1/export/kpi/${fakeKpiId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(404);
    });

    test('Single KPI export should have valid Excel structure', async () => {
      const res = await httpClient
        .get(`/api/v1/export/kpi/${testKpiId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const signature = res.body.toString('hex', 0, 4);
      expect(signature).toBe('504b0304'); // ZIP signature
    });
  });

  // ========================================
  // TASK METRICS EXPORT TESTS (Day 12)
  // ========================================
  describe('Task Metrics Export', () => {
    test('GET /export/task-metrics - should export task metrics', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/task-metrics-\d{4}-\d{2}-\d{2}\.xlsx/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('Task metrics export should require authentication', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics');

      expect(res.status).toBe(401);
    });

    test('Task metrics export should support filtering by project', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .query({ projectId })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('Task metrics export should support filtering by status', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .query({ status: 'PLANNED' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('Task metrics export should support filtering by priority', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .query({ priority: 'HIGH' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('Task metrics export should support date range filtering', async () => {
      const startDate = new Date('2025-01-01').toISOString();
      const endDate = new Date('2025-12-31').toISOString();
      
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .query({ startDate, endDate })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
    });

    test('Task metrics export should have valid Excel structure', async () => {
      const res = await httpClient
        .get('/api/v1/export/task-metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const signature = res.body.toString('hex', 0, 4);
      expect(signature).toBe('504b0304'); // ZIP signature
    });
  });

  // ===== DAY 13: PDF Export Tests =====
  describe('PDF Export Tests (Day 13)', () => {
    test('Portfolio Summary PDF should generate valid PDF file', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .query({ format: 'pdf' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      
      // Check PDF signature (%PDF)
      const signature = res.body.toString('ascii', 0, 4);
      expect(signature).toBe('%PDF');
      
      // Check file size is reasonable (>10KB)
      expect(res.body.length).toBeGreaterThan(10000);
    });

    test('Portfolio Summary PDF should have correct headers', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .query({ format: 'pdf' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="portfolio-summary-\d{4}-\d{2}-\d{2}\.pdf"$/);
    });

    test('Portfolio Summary PDF should require authentication', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .query({ format: 'pdf' })
        .expect(401);

      expect(res.body).toHaveProperty('errors');
    });

    test('KPI Dashboard PDF should generate valid PDF file', async () => {
      const res = await httpClient
        .get('/api/v1/export/kpi/dashboard')
        .query({ format: 'pdf' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Buffer);
      
      // Check PDF signature
      const signature = res.body.toString('ascii', 0, 4);
      expect(signature).toBe('%PDF');
      
      // Check file size
      expect(res.body.length).toBeGreaterThan(10000);
    });

    test('KPI Dashboard PDF should have correct MIME type', async () => {
      const res = await httpClient
        .get('/api/v1/export/kpi/dashboard')
        .query({ format: 'pdf' })
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="kpi-dashboard-\d{4}-\d{2}-\d{2}\.pdf"$/);
    });

    test('PDF exports should default to Excel when format is not specified', async () => {
      const res = await httpClient
        .get('/api/v1/export/portfolio/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      
      // Should be Excel (ZIP signature)
      const signature = res.body.toString('hex', 0, 4);
      expect(signature).toBe('504b0304');
      expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
  });
});

