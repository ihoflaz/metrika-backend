import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { PrismaClient, KPIStatus, TaskStatus, TaskPriority } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { uuidv7 } from 'uuidv7';
import { ROLES } from '../../src/modules/rbac/permissions';

let context: TestAppContext;
let prisma: PrismaClient;
let httpClient: ReturnType<typeof request>;

describe('KPI Breach Detection & Corrective Actions (Day 14)', () => {
  let authToken: string;
  let testUserId: string;
  let testProjectId: string;
  let testKpiId: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    httpClient = context.httpClient;

    // Create test user with role
    testUserId = uuidv7();
    const password = 'TestPass123!';
    const passwordHash = await hashPassword(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.PMO } });

    const email = `kpi-breach-${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email,
        fullName: 'KPI Breach Tester',
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

    if (!authToken) {
      throw new Error('Failed to obtain auth token');
    }
    console.log('✅ Auth token obtained for KPI breach tests');

    // Create test project
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        code: 'BREACH-TEST',
        name: 'KPI Breach Test Project',
        description: 'Project for testing KPI breach detection',
        status: 'ACTIVE',
        sponsorId: testUserId,
        pmoOwnerId: testUserId,
        startDate: new Date('2025-01-01'),
      },
    });
    testProjectId = project.id;

    console.log('✅ Test setup complete');
  });

  afterAll(async () => {
    // Clean up test data
    if (testKpiId) {
      await prisma.kPISeries.deleteMany({ where: { kpiId: testKpiId } });
      await prisma.kPIDefinition.deleteMany({ where: { id: testKpiId } });
    }
    await prisma.task.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.userRole.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });

    await teardownTestApp(context);
  });

  beforeEach(async () => {
    // Clean up any existing test KPIs before each test
    if (testKpiId) {
      await prisma.kPISeries.deleteMany({ where: { kpiId: testKpiId } });
      await prisma.kPIDefinition.deleteMany({ where: { id: testKpiId } });
    }
    // Clean up any corrective action tasks
    await prisma.task.deleteMany({
      where: {
        projectId: testProjectId,
        title: { startsWith: 'Corrective Action:' },
      },
    });
  });

  describe('Breach Detection', () => {
    test('should detect CRITICAL breach when value exceeds critical threshold', async () => {
      // Create KPI with thresholds
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-CRITICAL-001',
          name: 'Test Critical Breach KPI',
          description: 'KPI for testing critical breach detection',
          category: 'FINANCIAL',
          calculationFormula: 'SUM(values)',
          targetValue: 100,
          unit: 'USD',
          thresholdWarning: 80,
          thresholdCritical: 60,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add series data that breaches critical threshold (value = 50 < critical = 60)
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 50,
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Check breach status
      const response = await httpClient
        .get(`/api/v1/kpis/${testKpiId}/breach-status`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.breached).toBe(true);
      expect(response.body.data.breachType).toBe('CRITICAL');
      expect(response.body.data.currentValue).toBe(50);
      expect(response.body.data.thresholdCritical).toBe(60);
      expect(response.body.data.deviation).toBeLessThan(0);

      console.log('✅ Critical breach detected correctly');
    });

    test('should detect WARNING breach when value exceeds warning but not critical threshold', async () => {
      // Create KPI with thresholds
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-WARNING-001',
          name: 'Test Warning Breach KPI',
          description: 'KPI for testing warning breach detection',
          category: 'QUALITY',
          calculationFormula: 'AVG(values)',
          targetValue: 100,
          unit: '%',
          thresholdWarning: 85,
          thresholdCritical: 70,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add series data that breaches warning but not critical (value = 80, warning = 85, critical = 70)
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-07'),
          actualValue: 80,
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Check breach status
      const response = await httpClient
        .get(`/api/v1/kpis/${testKpiId}/breach-status`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.breached).toBe(true);
      expect(response.body.data.breachType).toBe('WARNING');
      expect(response.body.data.currentValue).toBe(80);
      expect(response.body.data.thresholdWarning).toBe(85);

      console.log('✅ Warning breach detected correctly');
    });

    test('should return no breach when value is within acceptable range', async () => {
      // Create KPI with thresholds
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-NOBREACH-001',
          name: 'Test No Breach KPI',
          description: 'KPI for testing no breach scenario',
          category: 'SCHEDULE',
          calculationFormula: 'COUNT(values)',
          targetValue: 100,
          unit: 'tasks',
          thresholdWarning: 90,
          thresholdCritical: 80,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'SYSTEM',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add series data within acceptable range (value = 95, warning = 90)
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 95,
          valueSource: 'API_INGEST',
          verificationStatus: 'VERIFIED',
        },
      });

      // Check breach status
      const response = await httpClient
        .get(`/api/v1/kpis/${testKpiId}/breach-status`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.breached).toBe(false);
      expect(response.body.data).toBeNull();

      console.log('✅ No breach detected correctly');
    });
  });

  describe('Corrective Task Creation', () => {
    test('should create corrective action task when breach is detected', async () => {
      // Create KPI with critical breach
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-TASK-001',
          name: 'Test Task Creation KPI',
          description: 'KPI for testing corrective task creation',
          category: 'RESOURCE',
          calculationFormula: 'SUM(values)',
          targetValue: 1000,
          unit: 'hours',
          thresholdWarning: 900,
          thresholdCritical: 800,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add breached series data
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 750, // Below critical threshold
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Trigger corrective action
      const response = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(true);
      expect(response.body.data.taskId).toBeDefined();
      expect(response.body.data.breachType).toBe('CRITICAL');

      // Verify task was created in database
      const task = await prisma.task.findUnique({
        where: { id: response.body.data.taskId },
      });

      expect(task).not.toBeNull();
      expect(task!.title).toContain('Corrective Action:');
      expect(task!.title).toContain('Test Task Creation KPI');
      expect(task!.status).toBe(TaskStatus.PLANNED);
      expect(task!.priority).toBe(TaskPriority.HIGH); // Critical breach = HIGH priority
      expect(task!.ownerId).toBe(testUserId); // Assigned to steward
      expect(task!.projectId).toBe(testProjectId);
      expect(task!.linkedKpiIds).toContain(testKpiId);
      expect(task!.code).toContain('CORRECTIVE');

      // Verify KPI status updated to BREACHED
      const updatedKpi = await prisma.kPIDefinition.findUnique({
        where: { id: testKpiId },
      });
      expect(updatedKpi!.status).toBe(KPIStatus.BREACHED);

      console.log('✅ Corrective task created successfully');
    });

    test('should create NORMAL priority task for WARNING breach', async () => {
      // Create KPI with warning breach
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-PRIORITY-001',
          name: 'Test Priority KPI',
          description: 'KPI for testing task priority based on breach type',
          category: 'COMPLIANCE',
          calculationFormula: 'COUNT(values)',
          targetValue: 100,
          unit: 'checks',
          thresholdWarning: 90,
          thresholdCritical: 80,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add warning-level breach (85, between warning 90 and critical 80)
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-07'),
          actualValue: 85,
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Trigger corrective action
      const response = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.data.breachType).toBe('WARNING');

      // Verify task priority is NORMAL (not HIGH)
      const task = await prisma.task.findUnique({
        where: { id: response.body.data.taskId },
      });

      expect(task!.priority).toBe(TaskPriority.NORMAL);

      console.log('✅ Task priority set correctly for WARNING breach');
    });
  });

  describe('Duplicate Prevention', () => {
    test('should not create duplicate corrective task if one already exists', async () => {
      // Create KPI with breach
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-DUP-001',
          name: 'Test Duplicate Prevention KPI',
          description: 'KPI for testing duplicate task prevention',
          category: 'FINANCIAL',
          calculationFormula: 'SUM(values)',
          targetValue: 500,
          unit: 'USD',
          thresholdWarning: 450,
          thresholdCritical: 400,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add breached series
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 350,
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // First corrective action - should create task
      const firstResponse = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.data.created).toBe(true);
      const firstTaskId = firstResponse.body.data.taskId;

      // Second corrective action - should NOT create duplicate
      const secondResponse = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.data.created).toBe(false);
      expect(secondResponse.body.data.reason).toContain('already exists');
      expect(secondResponse.body.data.taskId).toBe(firstTaskId); // Same task ID

      // Verify only one task exists
      const tasks = await prisma.task.findMany({
        where: {
          projectId: testProjectId,
          linkedKpiIds: { has: testKpiId },
          title: { startsWith: 'Corrective Action:' },
        },
      });

      expect(tasks.length).toBe(1);

      console.log('✅ Duplicate prevention working correctly');
    });

    test('should create new task if previous corrective task is completed', async () => {
      // Create KPI
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'TEST-COMPLETE-001',
          name: 'Test Completed Task KPI',
          description: 'KPI for testing new task creation after completion',
          category: 'QUALITY',
          calculationFormula: 'AVG(values)',
          targetValue: 90,
          unit: '%',
          thresholdWarning: 85,
          thresholdCritical: 80,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      // Add breached series
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-07'),
          actualValue: 75,
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Create first task
      const firstResponse = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(firstResponse.body.data.created).toBe(true);
      const firstTaskId = firstResponse.body.data.taskId;

      // Mark first task as COMPLETED
      await prisma.task.update({
        where: { id: firstTaskId },
        data: { status: TaskStatus.COMPLETED },
      });

      // Create second task - should succeed since first is completed
      const secondResponse = await httpClient
        .post(`/api/v1/kpis/${testKpiId}/corrective-action`)
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.data.created).toBe(true);
      expect(secondResponse.body.data.taskId).not.toBe(firstTaskId); // Different task

      // Verify two tasks exist (one completed, one active)
      const tasks = await prisma.task.findMany({
        where: {
          projectId: testProjectId,
          linkedKpiIds: { has: testKpiId },
        },
      });

      expect(tasks.length).toBe(2);

      console.log('✅ New task created after previous completion');
    });
  });

  describe('Bulk Breach Processing', () => {
    test('should process all breached KPIs and create corrective tasks', async () => {
      // Create multiple KPIs with breaches
      const kpi1 = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'BULK-001',
          name: 'Bulk Test KPI 1',
          category: 'FINANCIAL',
          calculationFormula: 'SUM(values)',
          targetValue: 100,
          unit: 'USD',
          thresholdCritical: 80,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });

      const kpi2 = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'BULK-002',
          name: 'Bulk Test KPI 2',
          category: 'QUALITY',
          calculationFormula: 'AVG(values)',
          targetValue: 90,
          unit: '%',
          thresholdWarning: 85,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });

      // Add breached series for both
      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: kpi1.id,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 70, // Below critical
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: kpi2.id,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-07'),
          actualValue: 80, // Below warning
          valueSource: 'MANUAL_ENTRY',
          verificationStatus: 'VERIFIED',
        },
      });

      // Process all breaches
      const response = await httpClient
        .post('/api/v1/kpis/breaches/process')
        .set('Authorization', `Bearer ${authToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalBreaches).toBe(2);
      expect(response.body.data.tasksCreated).toBe(2);
      expect(response.body.data.tasksDuplicate).toBe(0);

      // Verify tasks created
      const tasks = await prisma.task.findMany({
        where: {
          projectId: testProjectId,
          title: { startsWith: 'Corrective Action:' },
        },
      });

      expect(tasks.length).toBe(2);

      // Clean up
      await prisma.kPISeries.deleteMany({ where: { kpiId: { in: [kpi1.id, kpi2.id] } } });
      await prisma.kPIDefinition.deleteMany({ where: { id: { in: [kpi1.id, kpi2.id] } } });

      console.log('✅ Bulk breach processing successful');
    });
  });

  describe('Get Breached KPIs List', () => {
    test('should return list of all currently breached KPIs', async () => {
      // Create breached KPI
      const kpi = await prisma.kPIDefinition.create({
        data: {
          id: uuidv7(),
          code: 'LIST-001',
          name: 'List Test KPI',
          category: 'SCHEDULE',
          calculationFormula: 'COUNT(values)',
          targetValue: 50,
          unit: 'tasks',
          thresholdCritical: 40,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'SYSTEM',
          stewardId: testUserId,
          status: KPIStatus.ACTIVE,
          privacyLevel: 'INTERNAL',
          linkedProjectIds: [testProjectId],
        },
      });
      testKpiId = kpi.id;

      await prisma.kPISeries.create({
        data: {
          id: uuidv7(),
          kpiId: testKpiId,
          periodStart: new Date('2025-01-01'),
          periodEnd: new Date('2025-01-31'),
          actualValue: 35,
          valueSource: 'API_INGEST',
          verificationStatus: 'VERIFIED',
        },
      });

      // Get breached KPIs
      const response = await httpClient
        .get('/api/v1/kpis/breaches')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      
      const breach = response.body.data.find((b: any) => b.kpiId === testKpiId);
      expect(breach).toBeDefined();
      expect(breach.breachType).toBe('CRITICAL');
      expect(breach.currentValue).toBe(35);

      console.log('✅ Breached KPIs list retrieved successfully');
    });
  });
});

