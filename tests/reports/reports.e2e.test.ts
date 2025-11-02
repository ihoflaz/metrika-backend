import { uuidv7 } from 'uuidv7';
import { PrismaClient, ProjectStatus, TaskStatus, TaskPriority, KPIStatus } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('Reports API E2E Tests', () => {
  let context: TestAppContext;
  let authToken: string;
  let projectId1: string;
  let projectId2: string;

  beforeAll(async () => {
    context = await setupTestApp();
    const { prisma, httpClient } = context;

    // Login as admin (SYSADMIN has all permissions including REPORT_READ)
    const loginRes = await httpClient.post('/api/v1/auth/login').send({
      email: 'admin@metrika.local',
      password: 'ChangeMeNow123!',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.attributes.accessToken).toBeDefined();
    authToken = loginRes.body.data.attributes.accessToken;
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@metrika.local' },
    });
    const userId = adminUser.id;

    // Create test projects
    projectId1 = uuidv7();
    await prisma.project.create({
      data: {
        id: projectId1,
        name: 'Test Project 1',
        code: 'TP1',
        description: 'Test project for reporting',
        status: ProjectStatus.ACTIVE,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        budgetPlanned: 100000,
        sponsorId: userId,
      },
    });

    projectId2 = uuidv7();
    await prisma.project.create({
      data: {
        id: projectId2,
        name: 'Test Project 2',
        code: 'TP2',
        description: 'Another test project',
        status: ProjectStatus.ON_HOLD,
        startDate: new Date('2024-02-01'),
        endDate: new Date('2024-11-30'),
        budgetPlanned: 50000,
        sponsorId: userId,
      },
    });

    // Create test tasks
    await prisma.task.createMany({
      data: [
        {
          id: uuidv7(),
          projectId: projectId1,
          title: 'Task 1',
          description: 'Test task 1',
          status: TaskStatus.COMPLETED,
          priority: TaskPriority.HIGH,
          plannedStart: new Date('2024-01-15'),
          plannedEnd: new Date('2024-02-15'),
          actualStart: new Date('2024-01-15'),
          actualEnd: new Date('2024-02-10'),
          effortPlannedHours: 40,
          effortLoggedHours: 38,
          ownerId: userId,
        },
        {
          id: uuidv7(),
          projectId: projectId1,
          title: 'Task 2',
          description: 'Test task 2',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.NORMAL,
          plannedStart: new Date('2024-02-01'),
          plannedEnd: new Date('2024-03-01'),
          actualStart: new Date('2024-02-01'),
          effortPlannedHours: 80,
          effortLoggedHours: 30,
          ownerId: userId,
        },
        {
          id: uuidv7(),
          projectId: projectId1,
          title: 'Task 3',
          description: 'Test task 3 - delayed',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.CRITICAL,
          plannedStart: new Date('2024-02-15'),
          plannedEnd: new Date('2024-03-15'),
          actualStart: new Date('2024-02-20'),
          effortPlannedHours: 60,
          effortLoggedHours: 40,
          ownerId: userId,
        },
        {
          id: uuidv7(),
          projectId: projectId2,
          title: 'Task 4',
          description: 'Test task in project 2',
          status: TaskStatus.PLANNED,
          priority: TaskPriority.LOW,
          plannedStart: new Date('2024-03-01'),
          plannedEnd: new Date('2024-04-01'),
          effortPlannedHours: 20,
          ownerId: userId,
        },
      ],
    });

    // Create test KPIs
    await prisma.kPIDefinition.createMany({
      data: [
        {
          id: uuidv7(),
          code: 'BU01',
          name: 'Budget Utilization',
          description: 'Track budget usage',
          category: 'FINANCIAL',
          unit: 'percent',
          targetValue: 80,
          thresholdWarning: 5,
          thresholdCritical: 10,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          calculationFormula: 'actualValue',
          status: KPIStatus.BREACHED,
          stewardId: userId,
        },
        {
          id: uuidv7(),
          code: 'TC01',
          name: 'Task Completion',
          description: 'Track task completion rate',
          category: 'QUALITY',
          unit: 'percent',
          targetValue: 90,
          thresholdWarning: 10,
          thresholdCritical: 15,
          aggregationPeriod: 'MONTHLY',
          dataSourceType: 'MANUAL',
          calculationFormula: 'actualValue',
          status: KPIStatus.ACTIVE,
          stewardId: userId,
        },
        {
          id: uuidv7(),
          code: 'TV01',
          name: 'Team Velocity',
          description: 'Track team velocity',
          category: 'SCHEDULE',
          unit: 'points',
          targetValue: 100,
          thresholdWarning: 8,
          thresholdCritical: 10,
          aggregationPeriod: 'WEEKLY',
          dataSourceType: 'MANUAL',
          calculationFormula: 'actualValue',
          status: KPIStatus.ACTIVE,
          stewardId: userId,
        },
      ],
    });
  });

  afterAll(async () => {
    const { prisma } = context;
    // Cleanup test data only (not admin user)
    await prisma.kPIDefinition.deleteMany({ where: {
      code: { in: ['BU01', 'TC01', 'TV01'] }
    }});
    await prisma.task.deleteMany({ where: { projectId: { in: [projectId1, projectId2] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId1, projectId2] } } });
    await teardownTestApp(context);
  });

  describe('GET /api/v1/reports/portfolio-summary', () => {
    it('should return portfolio summary with correct aggregations', async () => {
      const { httpClient } = context;
      
      const res = await httpClient
        .get('/api/v1/reports/portfolio-summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data.type).toBe('portfolio-summary');
      expect(res.body.data.attributes).toMatchObject({
        totalProjects: 2,
        statusDistribution: expect.objectContaining({
          active: 1,
          onHold: 1,
        }),
        budgetSummary: {
          totalPlanned: 150000,
          averagePlanned: 75000,
          projectsWithBudget: 2,
        },
        healthMetrics: {
          onTrack: 0,
          atRisk: 0,
          delayed: 2,
        },
      });
    });

    it('should require authentication', async () => {
      const { httpClient } = context;
      await httpClient.get('/api/v1/reports/portfolio-summary').expect(401);
    });
  });

  describe('GET /api/v1/reports/kpi-dashboard', () => {
    it('should return KPI dashboard with correct aggregations', async () => {
      const { httpClient } = context;
      
      const res = await httpClient
        .get('/api/v1/reports/kpi-dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data.type).toBe('kpi-dashboard');
      expect(res.body.data.attributes).toMatchObject({
        totalKPIs: 3,
        statusDistribution: expect.objectContaining({
          active: 2,
          breached: 1,
        }),
        categoryDistribution: {
          FINANCIAL: 1,
          QUALITY: 1,
          SCHEDULE: 1,
        },
        thresholdSummary: {
          normal: 0,
          warning: 0,
          critical: 0,
          noData: 3,
        },
      });

      // Verify recent breaches
      const breaches = res.body.data.attributes.recentBreaches;
      expect(Array.isArray(breaches)).toBe(true);
    });

    it('should require authentication', async () => {
      const { httpClient } = context;
      await httpClient.get('/api/v1/reports/kpi-dashboard').expect(401);
    });
  });

  describe('GET /api/v1/reports/task-metrics', () => {
    it('should return task metrics for all projects', async () => {
      const { httpClient } = context;
      
      const res = await httpClient
        .get('/api/v1/reports/task-metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data.type).toBe('task-metrics');
      expect(res.body.data.id).toBe('all');
      expect(res.body.data.attributes).toMatchObject({
        totalTasks: 4,
        statusDistribution: expect.objectContaining({
          planned: 1,
          inProgress: 2,
          completed: 1,
        }),
        priorityDistribution: expect.objectContaining({
          low: 1,
          normal: 1,
          high: 1,
          critical: 1,
        }),
        completionMetrics: {
          completionRate: 25,
          averageProgress: 0,
          tasksOnTime: 1,
          tasksDelayed: 3,
        },
        effortMetrics: {
          totalPlannedHours: 200,
          totalLoggedHours: 108,
          utilizationRate: 54,
        },
      });
    });

    it('should return task metrics for specific project', async () => {
      const { httpClient } = context;
      
      const res = await httpClient
        .get(`/api/v1/reports/task-metrics?projectId=${projectId1}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data.type).toBe('task-metrics');
      expect(res.body.data.id).toBe(projectId1);
      expect(res.body.data.attributes).toMatchObject({
        totalTasks: 3,
        statusDistribution: expect.objectContaining({
          inProgress: 2,
          completed: 1,
        }),
        completionMetrics: expect.objectContaining({
          completionRate: expect.any(Number),
        }),
      });
    });

    it('should require authentication', async () => {
      const { httpClient } = context;
      await httpClient.get('/api/v1/reports/task-metrics').expect(401);
    });
  });
});
