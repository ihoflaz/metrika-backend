import request from 'supertest';
import { PrismaClient, TaskStatus, ProjectStatus, KPIType } from '@prisma/client';
import { app } from '../utils/test-app';
import { getQueueService } from '../../src/modules/automation/queue.service';

const prisma = new PrismaClient();
const queueService = getQueueService();

describe('KPI Monitoring Worker E2E Tests', () => {
  let authToken: string;
  let testUser: any;
  let sponsorUser: any;
  let testProject: any;
  let testKpiDefinition: any;

  beforeAll(async () => {
    // Create test users
    const userRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'kpiworker@test.com',
        password: 'Test123!@#',
        firstName: 'KPI',
        lastName: 'Worker',
      });

    testUser = userRes.body.user;
    authToken = userRes.body.token;

    // Create sponsor user
    const sponsorRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'kpisponsor@test.com',
        password: 'Test123!@#',
        firstName: 'KPI',
        lastName: 'Sponsor',
      });

    sponsorUser = sponsorRes.body.user;

    // Create test project
    testProject = await prisma.project.create({
      data: {
        name: 'KPI Test Project',
        code: 'KPI-001',
        description: 'Test project for KPI monitoring',
        status: ProjectStatus.ACTIVE,
        plannedStart: new Date('2025-01-01'),
        plannedEnd: new Date('2025-12-31'),
        actualStart: new Date('2025-01-01'),
        sponsorId: sponsorUser.id,
        healthScore: 85.0,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.task.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.kPISeries.deleteMany({
      where: { definitionId: testKpiDefinition?.id },
    });
    await prisma.kPIDefinition.deleteMany({
      where: { id: testKpiDefinition?.id },
    });
    await prisma.project.deleteMany({
      where: { id: testProject.id },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ['kpiworker@test.com', 'kpisponsor@test.com'] },
      },
    });
    await prisma.$disconnect();
  });

  describe('CALCULATE_PROJECT_HEALTH - Project Health Calculation', () => {
    it('should calculate project health with all metrics', async () => {
      // Create tasks with various statuses
      const tasks = await Promise.all([
        // Completed on time
        prisma.task.create({
          data: {
            title: 'Completed Task 1',
            code: 'TASK-KPI-001',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-15'),
            actualStart: new Date('2025-01-01'),
            actualEnd: new Date('2025-01-14'),
            kanbanPosition: 0,
          },
        }),
        // Completed late
        prisma.task.create({
          data: {
            title: 'Completed Late Task',
            code: 'TASK-KPI-002',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-15'),
            actualStart: new Date('2025-01-01'),
            actualEnd: new Date('2025-01-20'),
            kanbanPosition: 1,
          },
        }),
        // In progress (on time)
        prisma.task.create({
          data: {
            title: 'In Progress Task',
            code: 'TASK-KPI-003',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.IN_PROGRESS,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-12-31'),
            actualStart: new Date('2025-01-01'),
            kanbanPosition: 2,
          },
        }),
        // Overdue task
        prisma.task.create({
          data: {
            title: 'Overdue Task',
            code: 'TASK-KPI-004',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.IN_PROGRESS,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-10'),
            actualStart: new Date('2025-01-01'),
            kanbanPosition: 3,
          },
        }),
        // Blocked task
        prisma.task.create({
          data: {
            title: 'Blocked Task',
            code: 'TASK-KPI-005',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.BLOCKED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-12-31'),
            actualStart: new Date('2025-01-01'),
            kanbanPosition: 4,
          },
        }),
      ]);

      // Trigger CALCULATE_PROJECT_HEALTH job
      const job = await queueService.addKpiAutomationJob({
        action: 'CALCULATE_PROJECT_HEALTH',
        projectId: testProject.id,
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify job result contains metrics
      const jobResult = job.returnvalue;
      expect(jobResult).toBeDefined();
      expect(jobResult.completionRate).toBeGreaterThan(0);
      expect(jobResult.onTimeRate).toBeGreaterThan(0);
      expect(jobResult.overdueRate).toBeGreaterThan(0);
      expect(jobResult.blockedRate).toBeGreaterThan(0);
      expect(jobResult.healthScore).toBeGreaterThan(0);
      expect(jobResult.healthScore).toBeLessThanOrEqual(100);

      // Cleanup
      await prisma.task.deleteMany({
        where: { id: { in: tasks.map((t) => t.id) } },
      });
    }, 30000);

    it('should handle project with no tasks gracefully', async () => {
      // Create empty project
      const emptyProject = await prisma.project.create({
        data: {
          name: 'Empty KPI Project',
          code: 'KPI-002',
          description: 'Project with no tasks',
          status: ProjectStatus.PLANNING,
          plannedStart: new Date('2025-01-01'),
          plannedEnd: new Date('2025-12-31'),
          sponsorId: sponsorUser.id,
          healthScore: 0,
        },
      });

      // Trigger CALCULATE_PROJECT_HEALTH job
      const job = await queueService.addKpiAutomationJob({
        action: 'CALCULATE_PROJECT_HEALTH',
        projectId: emptyProject.id,
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify job handles empty project
      const jobResult = job.returnvalue;
      expect(jobResult).toBeDefined();
      expect(jobResult.completionRate).toBe(0);
      expect(jobResult.healthScore).toBe(0);

      // Cleanup
      await prisma.project.delete({
        where: { id: emptyProject.id },
      });
    }, 30000);
  });

  describe('CALCULATE_ALL - All Projects Health Calculation', () => {
    it('should calculate health for all active projects', async () => {
      // Create additional project
      const project2 = await prisma.project.create({
        data: {
          name: 'KPI Test Project 2',
          code: 'KPI-003',
          description: 'Second test project',
          status: ProjectStatus.ACTIVE,
          plannedStart: new Date('2025-01-01'),
          plannedEnd: new Date('2025-12-31'),
          actualStart: new Date('2025-01-01'),
          sponsorId: sponsorUser.id,
          healthScore: 90.0,
        },
      });

      // Create tasks for both projects
      await Promise.all([
        prisma.task.create({
          data: {
            title: 'Project 1 Task',
            code: 'TASK-ALL-001',
            projectId: testProject.id,
            ownerId: testUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-15'),
            actualEnd: new Date('2025-01-15'),
            kanbanPosition: 0,
          },
        }),
        prisma.task.create({
          data: {
            title: 'Project 2 Task',
            code: 'TASK-ALL-002',
            projectId: project2.id,
            ownerId: testUser.id,
            status: TaskStatus.IN_PROGRESS,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-12-31'),
            kanbanPosition: 0,
          },
        }),
      ]);

      // Trigger CALCULATE_ALL job
      const job = await queueService.addKpiAutomationJob({
        action: 'CALCULATE_ALL',
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify job processed multiple projects
      const jobResult = job.returnvalue;
      expect(jobResult).toBeDefined();
      expect(Array.isArray(jobResult)).toBe(true);
      expect(jobResult.length).toBeGreaterThanOrEqual(2);

      // Cleanup
      await prisma.task.deleteMany({
        where: { projectId: { in: [testProject.id, project2.id] } },
      });
      await prisma.project.delete({
        where: { id: project2.id },
      });
    }, 30000);
  });

  describe('CHECK_KPI_BREACH - KPI Threshold Monitoring', () => {
    it('should detect KPI warning threshold breach', async () => {
      // Create KPI definition with thresholds
      testKpiDefinition = await prisma.kPIDefinition.create({
        data: {
          name: 'Test Completion Rate',
          type: KPIType.PROJECT,
          unit: '%',
          description: 'Project completion rate KPI',
          linkedProjectIds: [testProject.id],
          thresholdWarning: 70.0,
          thresholdCritical: 50.0,
        },
      });

      // Create KPI series with value below warning threshold
      const kpiSeries = await prisma.kPISeries.create({
        data: {
          definitionId: testKpiDefinition.id,
          timestamp: new Date(),
          value: 65.0, // Below warning threshold (70)
        },
      });

      // Trigger CHECK_KPI_BREACH job
      const job = await queueService.addKpiAutomationJob({
        action: 'CHECK_KPI_BREACH',
        projectId: testProject.id,
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify alert was queued
      const notificationQueue = queueService.getQueue('notification');
      const jobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      
      const alertEmailJob = jobs.find(
        (j) =>
          j.data.action === 'SEND_TEMPLATE_EMAIL' &&
          j.data.template === 'kpi-breach' &&
          j.data.data.kpiName === 'Test Completion Rate'
      );

      expect(alertEmailJob).toBeDefined();
      expect(alertEmailJob?.data.to).toContain(sponsorUser.email);
      expect(alertEmailJob?.data.data.breachLevel).toBe('warning');

      // Cleanup
      await prisma.kPISeries.delete({
        where: { id: kpiSeries.id },
      });
    }, 30000);

    it('should detect KPI critical threshold breach', async () => {
      // Create KPI definition with thresholds
      const criticalKpi = await prisma.kPIDefinition.create({
        data: {
          name: 'Test Budget Utilization',
          type: KPIType.PROJECT,
          unit: '%',
          description: 'Budget utilization KPI',
          linkedProjectIds: [testProject.id],
          thresholdWarning: 80.0,
          thresholdCritical: 90.0,
        },
      });

      // Create KPI series with value above critical threshold
      const kpiSeries = await prisma.kPISeries.create({
        data: {
          definitionId: criticalKpi.id,
          timestamp: new Date(),
          value: 95.0, // Above critical threshold (90)
        },
      });

      // Trigger CHECK_KPI_BREACH job
      const job = await queueService.addKpiAutomationJob({
        action: 'CHECK_KPI_BREACH',
        projectId: testProject.id,
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify critical alert was queued
      const notificationQueue = queueService.getQueue('notification');
      const jobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      
      const criticalEmailJob = jobs.find(
        (j) =>
          j.data.action === 'SEND_TEMPLATE_EMAIL' &&
          j.data.template === 'kpi-breach' &&
          j.data.data.kpiName === 'Test Budget Utilization'
      );

      expect(criticalEmailJob).toBeDefined();
      expect(criticalEmailJob?.data.data.breachLevel).toBe('critical');

      // Cleanup
      await prisma.kPISeries.delete({
        where: { id: kpiSeries.id },
      });
      await prisma.kPIDefinition.delete({
        where: { id: criticalKpi.id },
      });
    }, 30000);

    it('should not alert when KPI is within acceptable range', async () => {
      // Create KPI definition with thresholds
      const goodKpi = await prisma.kPIDefinition.create({
        data: {
          name: 'Test Quality Score',
          type: KPIType.PROJECT,
          unit: '%',
          description: 'Quality score KPI',
          linkedProjectIds: [testProject.id],
          thresholdWarning: 60.0,
          thresholdCritical: 40.0,
        },
      });

      // Create KPI series with value above warning threshold
      const kpiSeries = await prisma.kPISeries.create({
        data: {
          definitionId: goodKpi.id,
          timestamp: new Date(),
          value: 85.0, // Above warning threshold (60)
        },
      });

      // Get initial notification count
      const notificationQueue = queueService.getQueue('notification');
      const initialJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const initialKpiAlerts = initialJobs.filter(
        (j) =>
          j.data.action === 'SEND_TEMPLATE_EMAIL' &&
          j.data.template === 'kpi-breach' &&
          j.data.data.kpiName === 'Test Quality Score'
      ).length;

      // Trigger CHECK_KPI_BREACH job
      const job = await queueService.addKpiAutomationJob({
        action: 'CHECK_KPI_BREACH',
        projectId: testProject.id,
      });

      await job.waitUntilFinished(queueService.queueEvents);

      // Verify no new alert was queued
      const finalJobs = await notificationQueue.getJobs(['waiting', 'active', 'completed']);
      const finalKpiAlerts = finalJobs.filter(
        (j) =>
          j.data.action === 'SEND_TEMPLATE_EMAIL' &&
          j.data.template === 'kpi-breach' &&
          j.data.data.kpiName === 'Test Quality Score'
      ).length;

      expect(finalKpiAlerts).toBe(initialKpiAlerts);

      // Cleanup
      await prisma.kPISeries.delete({
        where: { id: kpiSeries.id },
      });
      await prisma.kPIDefinition.delete({
        where: { id: goodKpi.id },
      });
    }, 30000);
  });
});
