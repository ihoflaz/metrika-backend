/**
 * Kanban API E2E Tests
 * 
 * Test scenarios:
 * 1. GET /projects/:id/kanban - Kanban board'u getir
 * 2. PUT /projects/:id/kanban/move - Task'ı farklı kolona taşı
 * 3. PUT /projects/:id/kanban/move - Aynı kolon içinde sırala
 * 4. PUT /projects/:id/kanban/reorder - Kolon sıralamasını değiştir
 * 5. GET /projects/:id/gantt - Gantt chart verisi getir
 */

import request from 'supertest';
import { PrismaClient, TaskStatus } from '@prisma/client';
import type { KanbanBoard } from '../../src/modules/projects/kanban.service';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { uuidv7 } from 'uuidv7';
import { ROLES } from '../../src/modules/rbac/permissions';

let context: TestAppContext;
let prisma: PrismaClient;
let httpClient: ReturnType<typeof request>;

describe('Kanban API E2E Tests', () => {
  let projectId: string;
  let userId: string;
  let authToken: string;
  let taskIds: string[] = [];

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    httpClient = context.httpClient;

    // Create test user with role
    userId = uuidv7();
    const password = 'TestPass123!';
    const passwordHash = await hashPassword(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.PROJECT_MANAGER } });

    const email = `kanban-test-${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email,
        fullName: 'Kanban Test User',
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

    // Test project oluştur
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        code: `KANBAN-TEST-${Date.now()}`,
        name: 'Kanban Test Project',
        sponsorId: userId,
        status: 'ACTIVE',
        startDate: new Date(),
      },
    });
    projectId = project.id;

    // 5 test task oluştur (farklı status'lerde)
    const task1 = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Task 1 - Draft',
        status: 'DRAFT',
        priority: 'NORMAL',
        ownerId: userId,
        kanbanPosition: 0,
      },
    });

    const task2 = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Task 2 - Planned',
        status: 'PLANNED',
        priority: 'NORMAL',
        ownerId: userId,
        kanbanPosition: 0,
      },
    });

    const task3 = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Task 3 - In Progress',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        ownerId: userId,
        kanbanPosition: 0,
      },
    });

    const task4 = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Task 4 - In Progress (2nd)',
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
        ownerId: userId,
        kanbanPosition: 1,
      },
    });

    const task5 = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Task 5 - Completed',
        status: 'COMPLETED',
        priority: 'LOW',
        ownerId: userId,
        actualEnd: new Date(),
        progressPct: 100,
        kanbanPosition: 0,
      },
    });

    taskIds = [task1.id, task2.id, task3.id, task4.id, task5.id];
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  // TEST 1: Kanban Board Getir
  it('should return kanban board with tasks grouped by status', async () => {
    const response = await httpClient
      .get(`/api/v1/projects/${projectId}/kanban`).set('Authorization', `Bearer ${authToken}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const board: KanbanBoard = response.body.data;

    expect(board.projectId).toBe(projectId);
    expect(board.columns).toHaveLength(7); // 7 status kolonu
    expect(board.totalTasks).toBe(5);

    // DRAFT kolonu
    const draftColumn = board.columns.find((c) => c.status === 'DRAFT');
    expect(draftColumn).toBeDefined();
    expect(draftColumn!.count).toBe(1);
    expect(draftColumn!.tasks[0].title).toContain('Task 1');

    // IN_PROGRESS kolonu (2 task)
    const inProgressColumn = board.columns.find((c) => c.status === 'IN_PROGRESS');
    expect(inProgressColumn).toBeDefined();
    expect(inProgressColumn!.count).toBe(2);
    expect(inProgressColumn!.tasks[0].title).toContain('Task 3'); // Position 0
    expect(inProgressColumn!.tasks[1].title).toContain('Task 4'); // Position 1
  });

  // TEST 2: Task'ı Farklı Kolona Taşı
  it('should move task to different status column', async () => {
    const response = await httpClient
      .put(`/api/v1/projects/${projectId}/kanban/move`).set('Authorization', `Bearer ${authToken}`)
      .send({
        taskId: taskIds[0], // Task 1 (DRAFT)
        targetStatus: 'PLANNED',
        targetPosition: 0,
      })
      .expect(200);

    const updatedTask = response.body.data;
    expect(updatedTask.status).toBe('PLANNED');
    expect(updatedTask.kanbanPosition).toBe(0);

    // Verify board state
    const boardRes = await httpClient
      .get(`/api/v1/projects/${projectId}/kanban`)
      .set('Authorization', `Bearer ${authToken}`);
    const board: KanbanBoard = boardRes.body.data;
    const plannedColumn = board.columns.find((c: any) => c.status === 'PLANNED');
    expect(plannedColumn!.count).toBe(2); // Task 1 + Task 2
  });

  // TEST 3: Aynı Kolon İçinde Sırala
  it('should reorder task within same column', async () => {
    // IN_PROGRESS kolonunda 2 task var: Task 3 (pos=0), Task 4 (pos=1)
    // Task 4'ü position 0'a taşı (Task 3'ün üstüne)
    const response = await httpClient
      .put(`/api/v1/projects/${projectId}/kanban/move`).set('Authorization', `Bearer ${authToken}`)
      .send({
        taskId: taskIds[3], // Task 4
        targetStatus: 'IN_PROGRESS',
        targetPosition: 0,
      })
      .expect(200);

    const updatedTask = response.body.data;
    expect(updatedTask.kanbanPosition).toBe(0);

    // Verify Task 3 shifted down
    const task3 = await prisma.task.findUnique({ where: { id: taskIds[2] } });
    expect(task3!.kanbanPosition).toBe(1);
  });

  // TEST 4: Kolon Sıralamasını Değiştir
  it('should reorder all tasks in a column', async () => {
    // IN_PROGRESS kolonunu tersine çevir
    const boardRes1 = await httpClient
      .get(`/api/v1/projects/${projectId}/kanban`)
      .set('Authorization', `Bearer ${authToken}`);
    const board: KanbanBoard = boardRes1.body.data;
    const inProgressColumn = board.columns.find((c: any) => c.status === 'IN_PROGRESS');
    const taskIdsInColumn = inProgressColumn!.tasks.map((t: any) => t.id).reverse();

    await httpClient
      .put(`/api/v1/projects/${projectId}/kanban/reorder`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        status: 'IN_PROGRESS',
        taskIds: taskIdsInColumn,
      })
      .expect(200);

    // Verify new order
    const boardRes2 = await httpClient
      .get(`/api/v1/projects/${projectId}/kanban`)
      .set('Authorization', `Bearer ${authToken}`);
    const updatedBoard: KanbanBoard = boardRes2.body.data;
    const updatedColumn = updatedBoard.columns.find((c: any) => c.status === 'IN_PROGRESS');
    expect(updatedColumn!.tasks[0].id).toBe(taskIdsInColumn[0]);
    expect(updatedColumn!.tasks[1].id).toBe(taskIdsInColumn[1]);
  });

  // TEST 5: Gantt Chart Verisi Getir
  it('should return gantt chart data with hierarchical structure', async () => {
    // Parent-child task oluştur
    const parentTask = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        title: 'Parent Task',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        ownerId: userId,
        plannedStart: new Date('2025-01-01'),
        plannedEnd: new Date('2025-12-31'),
        progressPct: 50,
      },
    });

    const childTask = await prisma.task.create({
      data: {
        id: uuidv7(),
        projectId,
        parentTaskId: parentTask.id,
        title: 'Child Task',
        status: 'COMPLETED',
        priority: 'NORMAL',
        ownerId: userId,
        plannedStart: new Date('2025-01-01'),
        plannedEnd: new Date('2025-06-30'),
        actualEnd: new Date(),
        progressPct: 100,
      },
    });

    const response = await httpClient
      .get(`/api/v1/projects/${projectId}/kanban/gantt`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const ganttData = response.body.data;
    expect(Array.isArray(ganttData)).toBe(true);

    // Parent task'ı bul
    const parentGantt = ganttData.find((t: any) => t.id === parentTask.id);
    expect(parentGantt).toBeDefined();
    expect(parentGantt.children).toBeDefined();
    expect(parentGantt.children).toHaveLength(1);
    expect(parentGantt.children[0].id).toBe(childTask.id);

    // Cleanup
    await prisma.task.deleteMany({ where: { parentTaskId: parentTask.id } });
    await prisma.task.delete({ where: { id: parentTask.id } });
  });
});

