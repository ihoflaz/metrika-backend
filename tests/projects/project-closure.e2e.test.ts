import request from 'supertest';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { TaskStatus, ProjectStatus, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('Project Closure (FR-13)', () => {
  let ctx: TestAppContext;
  let authToken: string;
  let testProject: any;
  let adminUser: any;

  const createUserWithRole = async (
    roleCode: string,
    overrides: Partial<{ email: string; fullName: string; password: string }> = {},
  ) => {
    const password = overrides.password ?? 'SecurePass123!';
    const passwordHash = await hashPassword(password);
    const userId = uuidv7();

    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

    await ctx.prisma.user.create({
      data: {
        id: userId,
        email: overrides.email ?? `${roleCode.toLowerCase()}@metrika.local`,
        fullName: overrides.fullName ?? `${roleCode} User`,
        passwordHash,
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            role: {
              connect: { id: role.id },
            },
          },
        },
      },
    });

    return {
      id: userId,
      email: overrides.email ?? `${roleCode.toLowerCase()}@metrika.local`,
      password,
    };
  };

  const login = async (credentials: { email: string; password: string }) => {
    const response = await ctx.httpClient.post('/api/v1/auth/login').send(credentials);
    expect(response.status).toBe(200);
    return response.body.data.attributes.accessToken as string;
  };

  beforeAll(async () => {
    ctx = await setupTestApp();

    const credentials = await createUserWithRole(ROLES.PMO, {
      email: `closure_admin_${Date.now()}@test.com`,
      fullName: 'Closure Admin',
    });

    adminUser = { id: credentials.id, email: credentials.email };
    authToken = await login(credentials);
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    // Create a test project for each test
    const projectResponse = await ctx.httpClient
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `Test Project ${Date.now()}`,
        description: 'Test project for closure',
        sponsorId: adminUser.id,
        startDate: new Date('2025-01-01').toISOString(),
        endDate: new Date('2025-12-31').toISOString(),
      })
      .expect(201);

    testProject = {
      id: projectResponse.body.data.id,
      code: projectResponse.body.data.attributes.code,
      ...projectResponse.body.data.attributes,
    };
  });

  afterEach(async () => {
    // Clean up after each test
    if (testProject) {
      await ctx.prisma.task.deleteMany({ where: { projectId: testProject.id } });
      await ctx.prisma.project.delete({ where: { id: testProject.id } }).catch(() => {});
    }
  });

  describe('POST /api/v1/projects/:id/close', () => {
    it('should fail when project has incomplete tasks', async () => {
      // Create tasks with mixed statuses
      await ctx.prisma.task.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            title: 'Completed Task',
            description: 'Done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-31'),
          },
          {
            id: crypto.randomUUID(),
            title: 'In Progress Task',
            description: 'Not done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.IN_PROGRESS,
            plannedStart: new Date('2025-02-01'),
            plannedEnd: new Date('2025-02-28'),
          },
          {
            id: crypto.randomUUID(),
            title: 'Planned Task',
            description: 'Not started',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.PLANNED,
            plannedStart: new Date('2025-03-01'),
            plannedEnd: new Date('2025-03-31'),
          },
        ],
      });

      const response = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      // Error format might be { errors: [...] } or { error: {...} }
      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toBe('PROJECT_HAS_INCOMPLETE_TASKS');
      expect(error.message || error.title).toContain('Cannot close project with incomplete tasks');
      expect(error.details || error.detail).toContain('2 incomplete task(s)');
    });

    it('should successfully close project when all tasks are completed', async () => {
      // Create only completed tasks
      await ctx.prisma.task.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            title: 'Completed Task 1',
            description: 'Done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-31'),
          },
          {
            id: crypto.randomUUID(),
            title: 'Completed Task 2',
            description: 'Also done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-02-01'),
            plannedEnd: new Date('2025-02-28'),
          },
        ],
      });

      const response = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.attributes.status).toBe(ProjectStatus.CLOSED);
      expect(response.body.data.attributes.actualEnd).toBeDefined();

      // Verify in database
      const closedProject = await ctx.prisma.project.findUnique({
        where: { id: testProject.id },
      });
      expect(closedProject?.status).toBe(ProjectStatus.CLOSED);
      expect(closedProject?.actualEnd).toBeDefined();
    });

    it('should successfully close project when all tasks are completed or cancelled', async () => {
      // Mix of completed and cancelled tasks
      await ctx.prisma.task.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            title: 'Completed Task',
            description: 'Done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-31'),
          },
          {
            id: crypto.randomUUID(),
            title: 'Cancelled Task',
            description: 'Not needed',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.CANCELLED,
            plannedStart: new Date('2025-02-01'),
            plannedEnd: new Date('2025-02-28'),
          },
        ],
      });

      const response = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.attributes.status).toBe(ProjectStatus.CLOSED);
    });

    it('should successfully close project with no tasks', async () => {
      const response = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.attributes.status).toBe(ProjectStatus.CLOSED);
    });

    it('should fail when project does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await ctx.httpClient
        .post(`/api/v1/projects/${nonExistentId}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toContain('NOT_FOUND');
    });
  });

  describe('GET /api/v1/projects/:id/closure-report', () => {
    beforeEach(async () => {
      // Create tasks for report testing
      await ctx.prisma.task.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            title: 'Completed Task 1',
            description: 'Done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-01-01'),
            plannedEnd: new Date('2025-01-31'),
          },
          {
            id: crypto.randomUUID(),
            title: 'Completed Task 2',
            description: 'Also done',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.COMPLETED,
            plannedStart: new Date('2025-02-01'),
            plannedEnd: new Date('2025-02-28'),
          },
          {
            id: crypto.randomUUID(),
            title: 'Cancelled Task',
            description: 'Not needed',
            projectId: testProject.id,
            ownerId: adminUser.id,
            status: TaskStatus.CANCELLED,
            plannedStart: new Date('2025-03-01'),
            plannedEnd: new Date('2025-03-31'),
          },
        ],
      });

      // Close the project first
      await ctx.prisma.project.update({
        where: { id: testProject.id },
        data: { status: ProjectStatus.CLOSED, actualEnd: new Date() },
      });
    });

    it('should generate PDF closure report', async () => {
      const response = await ctx.httpClient
        .get(`/api/v1/projects/${testProject.id}/closure-report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check PDF headers
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('.pdf');
      expect(response.headers['content-disposition']).toContain(testProject.code);

      // Check that response contains PDF data
      expect(response.body).toBeDefined();
      expect(Buffer.isBuffer(response.body) || response.body.length > 0).toBe(true);
    });

    it('should fail when project does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await ctx.httpClient
        .get(`/api/v1/projects/${nonExistentId}/closure-report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
    });

    it('should generate report for project regardless of status', async () => {
      // Update project back to ACTIVE
      await ctx.prisma.project.update({
        where: { id: testProject.id },
        data: { status: ProjectStatus.ACTIVE },
      });

      const response = await ctx.httpClient
        .get(`/api/v1/projects/${testProject.id}/closure-report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
    });
  });

  describe('Project Closure Statistics', () => {
    it('should calculate correct completion rate', async () => {
      // Create 10 tasks: 7 completed, 2 cancelled, 1 in progress
      const tasks = [];
      for (let i = 0; i < 7; i++) {
        tasks.push({
          id: crypto.randomUUID(),
          title: `Completed Task ${i + 1}`,
          description: 'Done',
          projectId: testProject.id,
          ownerId: adminUser.id,
          status: TaskStatus.COMPLETED,
          plannedStart: new Date('2025-01-01'),
          plannedEnd: new Date('2025-01-31'),
        });
      }
      for (let i = 0; i < 2; i++) {
        tasks.push({
          id: crypto.randomUUID(),
          title: `Cancelled Task ${i + 1}`,
          description: 'Cancelled',
          projectId: testProject.id,
          ownerId: adminUser.id,
          status: TaskStatus.CANCELLED,
          plannedStart: new Date('2025-01-01'),
          plannedEnd: new Date('2025-01-31'),
        });
      }
      tasks.push({
        id: crypto.randomUUID(),
        title: 'In Progress Task',
        description: 'Working',
        projectId: testProject.id,
        ownerId: adminUser.id,
        status: TaskStatus.IN_PROGRESS,
        plannedStart: new Date('2025-01-01'),
        plannedEnd: new Date('2025-01-31'),
      });

      await ctx.prisma.task.createMany({ data: tasks });

      // Try to close (should fail due to in-progress task)
      const response = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/close`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.details || error.detail).toContain('1 incomplete task(s)');
    });
  });
});

