import { PrismaClient, TaskStatus, ProjectStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { setupTestApp, teardownTestApp, TestAppContext } from '../utils/test-app';
import { getQueueService } from '../../src/modules/automation/queue.service';
import { QueueName } from '../../src/config/queue.config';

describe('Task Automation Worker Integration Tests', () => {
  let testContext: TestAppContext;
  let prisma: PrismaClient;
  let testUser: any;
  let testProject: any;
  let testTask: any;
  let sponsorUser: any;
  const queueService = getQueueService();

  beforeAll(async () => {
    testContext = await setupTestApp();
    prisma = testContext.prisma;

    // Create test users directly in DB
    testUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: 'taskworker@test.com',
        passwordHash: '$2b$10$test',
        fullName: 'Task Worker',
      },
    });

    sponsorUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: 'sponsor@test.com',
        passwordHash: '$2b$10$test',
        fullName: 'Project Sponsor',
      },
    });

    // Create test project
    testProject = await prisma.project.create({
      data: {
        id: randomUUID(),
        code: `ATP-${Date.now()}`,
        name: 'Automation Test Project',
        description: 'Test project for automation',
        status: ProjectStatus.ACTIVE,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        sponsorId: sponsorUser.id,
      },
    });
  }, 60000);

  afterAll(async () => {
    // Cleanup
    await prisma.task.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.project.deleteMany({
      where: { id: testProject.id },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ['taskworker@test.com', 'sponsor@test.com'] },
      },
    });
    
    await teardownTestApp(testContext);
  }, 60000);

  afterEach(async () => {
    // Clean up tasks after each test
    if (testTask) {
      await prisma.task.deleteMany({
        where: { id: testTask.id },
      });
      testTask = null;
    }
  });

  describe('Task Automation Queue - Job Processing', () => {
    it('should queue CHECK_OVERDUE job successfully', async () => {
      // Create an overdue task
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      testTask = await prisma.task.create({
        data: {
          id: randomUUID(),
          title: 'Overdue Test Task',
          description: 'This task is overdue',
          projectId: testProject.id,
          ownerId: testUser.id,
          status: TaskStatus.IN_PROGRESS,
          plannedEnd: threeDaysAgo,
          kanbanPosition: 0,
        },
      });

      // Queue CHECK_OVERDUE job
      const job = await queueService.addTaskAutomationJob({
        action: 'CHECK_OVERDUE',
      });

      // Verify job was queued
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('CHECK_OVERDUE');
      
      // Verify queue metrics
      const metrics = await queueService.getQueueMetrics(QueueName.TASK_AUTOMATION);
      expect(metrics.waiting + metrics.active).toBeGreaterThan(0);
    }, 30000);

    it('should queue CHECK_DELAY job successfully', async () => {
      // Create task with approaching deadline
      const twelveHoursLater = new Date();
      twelveHoursLater.setHours(twelveHoursLater.getHours() + 12);

      testTask = await prisma.task.create({
        data: {
          id: randomUUID(),
          title: 'Deadline Approaching Task',
          description: 'Task with approaching deadline',
          projectId: testProject.id,
          ownerId: testUser.id,
          status: TaskStatus.IN_PROGRESS,
          plannedEnd: twelveHoursLater,
          kanbanPosition: 0,
        },
      });

      // Queue CHECK_DELAY job
      const job = await queueService.addTaskAutomationJob({
        action: 'CHECK_DELAY',
      });

      // Verify job was queued
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('CHECK_DELAY');
    }, 30000);

    it('should queue SEND_REMINDER job for specific task', async () => {
      testTask = await prisma.task.create({
        data: {
          id: randomUUID(),
          title: 'Manual Reminder Task',
          description: 'Task for manual reminder',
          projectId: testProject.id,
          ownerId: testUser.id,
          status: TaskStatus.IN_PROGRESS,
          plannedEnd: new Date('2025-12-31'),
          kanbanPosition: 0,
        },
      });

      // Queue SEND_REMINDER job
      const job = await queueService.addTaskAutomationJob({
        action: 'SEND_REMINDER',
        taskId: testTask.id,
      });

      // Verify job was queued with correct task ID
      expect(job).toBeDefined();
      expect(job.id).toContain(testTask.id);
      expect(job.data.taskId).toBe(testTask.id);
    }, 30000);

    it('should queue AUTO_UPDATE_STATUS job successfully', async () => {
      testTask = await prisma.task.create({
        data: {
          id: randomUUID(),
          title: 'Status Update Task',
          description: 'Task for status update',
          projectId: testProject.id,
          ownerId: testUser.id,
          status: TaskStatus.DRAFT,
          plannedEnd: new Date('2025-12-31'),
          kanbanPosition: 0,
        },
      });

      // Queue AUTO_UPDATE_STATUS job
      const job = await queueService.addTaskAutomationJob({
        action: 'AUTO_UPDATE_STATUS',
        taskId: testTask.id,
        newStatus: TaskStatus.IN_PROGRESS,
      });

      // Verify job was queued with correct parameters
      expect(job).toBeDefined();
      expect(job.data.taskId).toBe(testTask.id);
      expect(job.data.newStatus).toBe(TaskStatus.IN_PROGRESS);
    }, 30000);

    it('should verify queue service metrics', async () => {
      // Get queue metrics
      const metrics = await queueService.getQueueMetrics(QueueName.TASK_AUTOMATION);

      // Verify metrics structure
      expect(metrics).toBeDefined();
      expect(metrics.queueName).toBe(QueueName.TASK_AUTOMATION);
      expect(typeof metrics.waiting).toBe('number');
      expect(typeof metrics.active).toBe('number');
      expect(typeof metrics.completed).toBe('number');
      expect(typeof metrics.failed).toBe('number');
      expect(typeof metrics.delayed).toBe('number');
      expect(typeof metrics.total).toBe('number');
    }, 30000);
  });
});
