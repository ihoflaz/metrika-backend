import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import {
  PrismaClient,
  ProjectStatus,
  TaskStatus,
  KPICategory,
  KPIAggregationPeriod,
  KPIDataSourceType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { getQueueService } from '../../src/modules/automation/queue.service';
import { QueueName } from '../../src/config/queue.config';
import { KPIMonitoringWorker } from '../../src/modules/automation/kpi-monitoring.worker';

describe('KPI Monitoring Worker E2E Tests', () => {
  let context: TestAppContext;
  let prisma: PrismaClient;
  let queueService: ReturnType<typeof getQueueService>;
  let worker: KPIMonitoringWorker;
  let stewardUser: { id: string; email: string };
  let sponsorUser: { id: string; email: string };
  let testProject: { id: string; code: string };
  let createdKpiIds: string[] = [];

  const notificationQueue = () => queueService.getQueue(QueueName.NOTIFICATION);

  const createTestUser = async (email: string, fullName: string) => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        fullName,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test$test',
        status: UserStatus.ACTIVE,
      },
    });
    return { id: user.id, email: user.email };
  };

  const createKpiDefinition = async (overrides: Partial<Parameters<typeof prisma.kPIDefinition.create>[0]['data']> = {}) => {
    const kpi = await prisma.kPIDefinition.create({
      data: {
        id: randomUUID(),
        code: `KPI-TST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: 'Schedule Adherence',
        description: 'Test KPI for monitoring worker',
        category: KPICategory.SCHEDULE,
        calculationFormula: 'completion_rate',
        targetValue: new Prisma.Decimal(95),
        unit: '%',
        aggregationPeriod: KPIAggregationPeriod.MONTHLY,
        dataSourceType: KPIDataSourceType.MANUAL,
        stewardId: stewardUser.id,
        status: 'ACTIVE',
        linkedProjectIds: [testProject.id],
        thresholdWarning: new Prisma.Decimal(85),
        thresholdCritical: new Prisma.Decimal(70),
        ...overrides,
      },
    });

    createdKpiIds.push(kpi.id);
    return kpi;
  };

  const createKpiSeries = async (kpiId: string, actualValue: number) =>
    prisma.kPISeries.create({
      data: {
        id: randomUUID(),
        kpiId,
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        actualValue: new Prisma.Decimal(actualValue),
        valueSource: 'MANUAL_ENTRY',
        collectedBy: stewardUser.id,
        verificationStatus: 'VERIFIED',
      },
    });

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    queueService = getQueueService();
    worker = new KPIMonitoringWorker(prisma);

    stewardUser = await createTestUser('kpi.steward@test.com', 'KPI Steward');
    sponsorUser = await createTestUser('kpi.sponsor@test.com', 'KPI Sponsor');

    testProject = await prisma.project.create({
      data: {
        id: randomUUID(),
        code: `KPI-${Date.now()}`,
        name: 'KPI Automation Project',
        description: 'Project used for KPI monitoring worker tests',
        status: ProjectStatus.ACTIVE,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        sponsorId: sponsorUser.id,
      },
    });
  }, 60000);

  afterAll(async () => {
    await notificationQueue().drain(true);
    await notificationQueue().clean(0, 'completed');
    await notificationQueue().clean(0, 'failed');
    await prisma.kPISeries.deleteMany({
      where: { kpiId: { in: createdKpiIds } },
    });
    await prisma.kPIDefinition.deleteMany({
      where: { id: { in: createdKpiIds } },
    });
    await prisma.task.deleteMany({ where: { projectId: testProject.id } });
    await prisma.project.deleteMany({ where: { id: testProject.id } });
    await prisma.user.deleteMany({ where: { email: { in: [stewardUser.email, sponsorUser.email] } } });
    await worker.close();
    await teardownTestApp(context);
  }, 60000);

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { projectId: testProject.id } });
    await prisma.kPISeries.deleteMany({
      where: { kpiId: { in: createdKpiIds } },
    });
    await prisma.kPIDefinition.deleteMany({
      where: { id: { in: createdKpiIds } },
    });
    createdKpiIds = [];

    await notificationQueue().drain(true);
    await notificationQueue().clean(0, 'completed');
    await notificationQueue().clean(0, 'failed');
  });

  describe('CALCULATE_PROJECT_HEALTH', () => {
    it('should calculate project health with mixed task states', async () => {
      const now = new Date();
      const beforeNow = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const afterNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      await prisma.task.createMany({
        data: [
          {
            id: randomUUID(),
            title: 'Completed On Time',
            projectId: testProject.id,
            ownerId: stewardUser.id,
            status: TaskStatus.COMPLETED,
            plannedEnd: beforeNow,
            actualEnd: beforeNow,
            kanbanPosition: 0,
          },
          {
            id: randomUUID(),
            title: 'Completed Late',
            projectId: testProject.id,
            ownerId: stewardUser.id,
            status: TaskStatus.COMPLETED,
            plannedEnd: beforeNow,
            actualEnd: now,
            kanbanPosition: 1,
          },
          {
            id: randomUUID(),
            title: 'Blocked Task',
            projectId: testProject.id,
            ownerId: stewardUser.id,
            status: TaskStatus.BLOCKED,
            plannedEnd: afterNow,
            kanbanPosition: 2,
          },
          {
            id: randomUUID(),
            title: 'In Progress',
            projectId: testProject.id,
            ownerId: stewardUser.id,
            status: TaskStatus.IN_PROGRESS,
            plannedEnd: afterNow,
            kanbanPosition: 3,
          },
        ],
      });

      await expect((worker as any).calculateProjectHealth(testProject.id)).resolves.toBeUndefined();
    }, 30000);

    it('should exit gracefully when project has no tasks', async () => {
      await expect((worker as any).calculateProjectHealth(testProject.id)).resolves.toBeUndefined();
    }, 30000);
  });

  describe('CALCULATE_ALL', () => {
    it('should iterate over all active projects', async () => {
      await prisma.task.create({
        data: {
          id: randomUUID(),
          title: 'All-project health seed',
          projectId: testProject.id,
          ownerId: stewardUser.id,
          status: TaskStatus.PLANNED,
          plannedEnd: new Date('2025-12-31'),
          kanbanPosition: 0,
        },
      });

      await expect((worker as any).calculateAllMetrics()).resolves.toBeUndefined();
    }, 30000);
  });

  describe('CHECK_KPI_BREACH', () => {
    it('should detect warning threshold breaches and enqueue notification job', async () => {
      const kpi = await createKpiDefinition();
      await createKpiSeries(kpi.id, 80); // below warning, above critical

      const sendEmailSpy = jest.spyOn(queueService as any, 'sendTemplateEmail');
      try {
        await expect((worker as any).checkKPIBreaches(testProject.id)).resolves.toBeUndefined();
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        const [options] = sendEmailSpy.mock.calls[0];
        expect(options.template).toBe('kpi-breach');
        expect(options.to).toContain(sponsorUser.email);
        const payload = options.data as any;
        expect(payload.projectCode).toBe(testProject.code);
        expect(payload.breaches?.[0]?.severity).toBe('WARNING');
      } finally {
        sendEmailSpy.mockRestore();
      }
    }, 30000);

    it('should escalate to critical severity and include breach data', async () => {
      const kpi = await createKpiDefinition({
        thresholdWarning: new Prisma.Decimal(85),
        thresholdCritical: new Prisma.Decimal(75),
      });
      await createKpiSeries(kpi.id, 60); // below critical

      const sendEmailSpy = jest.spyOn(queueService as any, 'sendTemplateEmail');
      try {
        await expect((worker as any).checkKPIBreaches(testProject.id)).resolves.toBeUndefined();
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);
        const [options] = sendEmailSpy.mock.calls[0];
        const payload = options.data as any;
        expect(payload.breaches?.[0]?.severity).toBe('CRITICAL');
        expect(payload.breaches?.[0]?.name).toBeDefined();
      } finally {
        sendEmailSpy.mockRestore();
      }
    }, 30000);

    it('should not enqueue notifications when KPI value meets targets', async () => {
      const kpi = await createKpiDefinition();
      await createKpiSeries(kpi.id, 96); // above target

      const sendEmailSpy = jest.spyOn(queueService as any, 'sendTemplateEmail');
      try {
        await expect((worker as any).checkKPIBreaches(testProject.id)).resolves.toBeUndefined();
        expect(sendEmailSpy).not.toHaveBeenCalled();
      } finally {
        sendEmailSpy.mockRestore();
      }
    }, 30000);
  });
});
