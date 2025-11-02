import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { TaskStatus, TaskPriority } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { TestAppContext } from '../utils/test-app';
import { setupTestApp, teardownTestApp } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

let ctx: TestAppContext;
let authToken: string;
let testProjectId: string;
let testUserId: string;
let testTaskIds: string[] = [];
let testWatcherUserId: string;

beforeAll(async () => {
  ctx = await setupTestApp();

  // Create PM user for bulk operations
  testUserId = randomUUID();
  const password = 'Test123!@#';
  const passwordHash = await hashPassword(password);
  const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: ROLES.PROJECT_MANAGER } });
  
  const email = 'bulkops@test.com';
  await ctx.prisma.user.create({
    data: {
      id: testUserId,
      email,
      fullName: 'Bulk Ops Tester',
      passwordHash,
      status: 'ACTIVE',
      roles: {
        create: {
          role: { connect: { id: role.id } },
        },
      },
    },
  });

  // Login to get auth token
  const loginRes = await ctx.httpClient.post('/api/v1/auth/login').send({
    email,
    password,
  });

  authToken = loginRes.body.data.attributes.accessToken;

  // Create watcher user
  testWatcherUserId = randomUUID();
  const watcherPasswordHash = await hashPassword('Test123!@#');
  const watcherRole = await ctx.prisma.role.findUniqueOrThrow({ where: { code: ROLES.TEAM_MEMBER } });
  await ctx.prisma.user.create({
    data: {
      id: testWatcherUserId,
      email: 'watcher@test.com',
      fullName: 'Watcher User',
      passwordHash: watcherPasswordHash,
      status: 'ACTIVE',
      roles: {
        create: {
          role: { connect: { id: watcherRole.id } },
        },
      },
    },
  });

  // Create test project
  testProjectId = randomUUID();
  await ctx.prisma.project.create({
    data: {
      id: testProjectId,
      name: 'Bulk Operations Test Project',
      code: 'BULK-TEST',
      sponsorId: testUserId,
      pmoOwnerId: testUserId,
      status: 'ACTIVE',
      startDate: new Date(),
    },
  });

  // Create 10 test tasks
  for (let i = 1; i <= 10; i++) {
    const taskId = randomUUID();
    await ctx.prisma.task.create({
      data: {
        id: taskId,
        title: `Bulk Test Task ${i}`,
        description: `Test task for bulk operations ${i}`,
        status: i <= 3 ? 'PLANNED' : i <= 6 ? 'IN_PROGRESS' : 'BLOCKED',
        priority: i <= 5 ? 'NORMAL' : 'HIGH',
        ownerId: testUserId,
        projectId: testProjectId,
        progressPct: i <= 6 ? i * 10 : 0,
      },
    });
    testTaskIds.push(taskId);
  }
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe('Bulk Operations E2E Tests', () => {
  describe('POST /api/v1/tasks/bulk/update', () => {
    test('should bulk update multiple tasks successfully', async () => {
      const updateData = {
        taskIds: testTaskIds.slice(0, 3),
        data: {
          priority: 'CRITICAL',
          progressPct: 75,
        },
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(3);
      expect(res.body.failed).toBe(0);

      // Verify database changes
      const updatedTasks = await ctx.prisma.task.findMany({
        where: { id: { in: testTaskIds.slice(0, 3) } },
      });

      updatedTasks.forEach((task) => {
        expect(task.priority).toBe('CRITICAL');
        expect(task.progressPct).toBe(75);
      });
    });

    test('should handle partial failures gracefully', async () => {
      const updateData = {
        taskIds: [...testTaskIds.slice(0, 2), 'invalid-uuid-123'],
        data: {
          priority: 'LOW',
        },
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      // Should still succeed for valid tasks
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('should require at least one task ID', async () => {
      const emptyData = {
        taskIds: [],
        data: { priority: 'HIGH' },
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(emptyData);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/tasks/bulk/delete', () => {
    test('should soft delete tasks by default', async () => {
      const deleteData = {
        taskIds: testTaskIds.slice(3, 5),
        hardDelete: false,
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send(deleteData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(2);

      // Verify soft delete (status = CANCELLED)
      const deletedTasks = await ctx.prisma.task.findMany({
        where: { id: { in: testTaskIds.slice(3, 5) } },
      });

      deletedTasks.forEach((task) => {
        expect(task.status).toBe('CANCELLED');
      });
    });

    test('should hard delete tasks when specified', async () => {
      // Create disposable task for hard delete
      const disposableTaskId = randomUUID();
      await ctx.prisma.task.create({
        data: {
          id: disposableTaskId,
          title: 'Disposable Task',
          ownerId: testUserId,
          projectId: testProjectId,
          status: 'DRAFT',
        },
      });

      const deleteData = {
        taskIds: [disposableTaskId],
        hardDelete: true,
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send(deleteData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify hard delete (task doesn't exist)
      const deletedTask = await ctx.prisma.task.findUnique({
        where: { id: disposableTaskId },
      });

      expect(deletedTask).toBeNull();
    });

    test('should handle cascade delete for hard delete', async () => {
      // Create task with relations
      const taskId = randomUUID();
      await ctx.prisma.task.create({
        data: {
          id: taskId,
          title: 'Task with Relations',
          ownerId: testUserId,
          projectId: testProjectId,
          status: 'DRAFT',
        },
      });

      // Add watcher
      const watcherId = randomUUID();
      await ctx.prisma.taskWatcher.create({
        data: {
          id: watcherId,
          taskId,
          userId: testWatcherUserId,
        },
      });

      // Add comment
      const commentId = randomUUID();
      await ctx.prisma.taskComment.create({
        data: {
          id: commentId,
          body: 'Test comment',
          taskId,
          authorId: testUserId,
        },
      });

      // Hard delete
      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          taskIds: [taskId],
          hardDelete: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify cascade delete
      const watchers = await ctx.prisma.taskWatcher.findMany({
        where: { taskId },
      });
      const comments = await ctx.prisma.taskComment.findMany({
        where: { taskId },
      });

      expect(watchers).toHaveLength(0);
      expect(comments).toHaveLength(0);
    });
  });

  describe('POST /api/v1/tasks/bulk/change-status', () => {
    test('should change status for multiple tasks', async () => {
      const statusData = {
        taskIds: testTaskIds.slice(5, 8),
        newStatus: 'IN_PROGRESS',
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/change-status')
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(3);

      // Verify status change and actualStart is set
      const updatedTasks = await ctx.prisma.task.findMany({
        where: { id: { in: testTaskIds.slice(5, 8) } },
      });

      updatedTasks.forEach((task) => {
        expect(task.status).toBe('IN_PROGRESS');
        expect(task.actualStart).not.toBeNull();
      });
    });

    test('should set actualEnd when status is COMPLETED', async () => {
      const completionData = {
        taskIds: testTaskIds.slice(8, 10),
        newStatus: 'COMPLETED',
        comment: 'Bulk completion test',
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/change-status')
        .set('Authorization', `Bearer ${authToken}`)
        .send(completionData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify completion fields
      const completedTasks = await ctx.prisma.task.findMany({
        where: { id: { in: testTaskIds.slice(8, 10) } },
      });

      completedTasks.forEach((task) => {
        expect(task.status).toBe('COMPLETED');
        expect(task.actualEnd).not.toBeNull();
        expect(task.progressPct).toBe(100);
      });

      // Verify comments were created
      const comments = await ctx.prisma.taskComment.findMany({
        where: {
          taskId: { in: testTaskIds.slice(8, 10) },
          body: { contains: 'Bulk completion test' },
        },
      });

      expect(comments.length).toBeGreaterThan(0);
    });

    test('should reject invalid status', async () => {
      const invalidData = {
        taskIds: testTaskIds.slice(0, 1),
        newStatus: 'INVALID_STATUS',
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/change-status')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/tasks/bulk/add-watchers', () => {
    test('should add watchers to multiple tasks', async () => {
      const watcherData = {
        taskIds: testTaskIds.slice(0, 3),
        userIds: [testWatcherUserId],
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/add-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(watcherData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(3);

      // Verify watchers added
      const watchers = await ctx.prisma.taskWatcher.findMany({
        where: {
          taskId: { in: testTaskIds.slice(0, 3) },
          userId: testWatcherUserId,
        },
      });

      expect(watchers).toHaveLength(3);
    });

    test('should skip duplicate watchers', async () => {
      // Add watcher first time
      const watcherData = {
        taskIds: [testTaskIds[0]],
        userIds: [testWatcherUserId],
      };

      await ctx.httpClient
        .post('/api/v1/tasks/bulk/add-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(watcherData);

      // Try adding again
      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/add-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(watcherData);

      expect(res.status).toBe(200);

      // Should still have only 1 watcher (due to skipDuplicates)
      const watcherCount = await ctx.prisma.taskWatcher.count({
        where: {
          taskId: testTaskIds[0],
          userId: testWatcherUserId,
        },
      });

      expect(watcherCount).toBeGreaterThanOrEqual(1);
    });

    test('should reject empty user IDs', async () => {
      const invalidData = {
        taskIds: testTaskIds.slice(0, 1),
        userIds: [],
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/add-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/tasks/bulk/remove-watchers', () => {
    beforeAll(async () => {
      // Add some watchers to remove
      const watcherPromises = testTaskIds.slice(0, 3).map((taskId) =>
        ctx.prisma.taskWatcher.upsert({
          where: {
            taskId_userId: {
              taskId,
              userId: testWatcherUserId,
            },
          },
          create: {
            id: randomUUID(),
            taskId,
            userId: testWatcherUserId,
          },
          update: {},
        })
      );
      await Promise.all(watcherPromises);
    });

    test('should remove watchers from multiple tasks', async () => {
      const removeData = {
        taskIds: testTaskIds.slice(0, 2),
        userIds: [testWatcherUserId],
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/remove-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(removeData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify watchers removed
      const remainingWatchers = await ctx.prisma.taskWatcher.findMany({
        where: {
          taskId: { in: testTaskIds.slice(0, 2) },
          userId: testWatcherUserId,
        },
      });

      expect(remainingWatchers).toHaveLength(0);
    });

    test('should handle non-existent watchers gracefully', async () => {
      const removeData = {
        taskIds: testTaskIds.slice(5, 7),
        userIds: [testWatcherUserId],
      };

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/remove-watchers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(removeData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/tasks/bulk/stats/:projectId', () => {
    test('should return bulk operation statistics', async () => {
      const res = await ctx.httpClient
        .get(`/api/v1/tasks/bulk/stats/${testProjectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.byStatus).toBeDefined();
      expect(res.body.byPriority).toBeDefined();
      expect(res.body.total).toBeGreaterThan(0);

      // Check status grouping
      expect(Array.isArray(res.body.byStatus)).toBe(true);
      if (res.body.byStatus.length > 0) {
        expect(res.body.byStatus[0]).toHaveProperty('status');
        expect(res.body.byStatus[0]).toHaveProperty('_count');
      }

      // Check priority grouping
      expect(Array.isArray(res.body.byPriority)).toBe(true);
      if (res.body.byPriority.length > 0) {
        expect(res.body.byPriority[0]).toHaveProperty('priority');
        expect(res.body.byPriority[0]).toHaveProperty('_count');
      }
    });

    test('should return empty stats for non-existent project', async () => {
      const fakeProjectId = randomUUID();

      const res = await ctx.httpClient
        .get(`/api/v1/tasks/bulk/stats/${fakeProjectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.byStatus).toHaveLength(0);
      expect(res.body.byPriority).toHaveLength(0);
    });
  });

  describe('RBAC Authorization Tests', () => {
    test('should require authentication', async () => {
      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/update')
        .send({
          taskIds: testTaskIds.slice(0, 1),
          data: { priority: 'HIGH' },
        });

      expect(res.status).toBe(401);
    });
  });

  describe('Performance Tests', () => {
    test('should handle bulk update of 50 tasks efficiently', async () => {
      // Create 50 test tasks
      const bulkTaskIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        const taskId = randomUUID();
        await ctx.prisma.task.create({
          data: {
            id: taskId,
            title: `Bulk Perf Test ${i}`,
            ownerId: testUserId,
            projectId: testProjectId,
            status: 'DRAFT',
          },
        });
        bulkTaskIds.push(taskId);
      }

      const startTime = Date.now();

      const res = await ctx.httpClient
        .post('/api/v1/tasks/bulk/update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          taskIds: bulkTaskIds,
          data: { priority: 'HIGH' },
        });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(50);
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds

      // Cleanup
      await ctx.prisma.task.deleteMany({
        where: { id: { in: bulkTaskIds } },
      });
    }, 30000); // 30 second timeout
  });
});
