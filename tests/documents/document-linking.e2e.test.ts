import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { DocumentType, DocumentClassification, DocumentRetentionPolicy, TaskStatus, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('Document-Task Linking (FR-33)', () => {
  let ctx: TestAppContext;
  let authToken: string;
  let pmUser: any;
  let testProject: any;
  let testDocument: any;
  let testTask: any;

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

    // Use PROJECT_MANAGER role since PMO doesn't have TASK_WRITE permission
    const credentials = await createUserWithRole(ROLES.PROJECT_MANAGER, {
      email: `linking_pm_${Date.now()}@test.com`,
      fullName: 'Linking Project Manager',
    });

    pmUser = { id: credentials.id, email: credentials.email };
    authToken = await login(credentials);

    // Create test project
    const projectResponse = await ctx.httpClient
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `Test Project ${Date.now()}`,
        description: 'Test project for linking',
        sponsorId: pmUser.id,
        startDate: new Date('2025-01-01').toISOString(),
        endDate: new Date('2025-12-31').toISOString(),
      })
      .expect(201);

    testProject = {
      id: projectResponse.body.data.id,
      ...projectResponse.body.data.attributes,
    };

    // Create test task
    const taskResponse = await ctx.httpClient
      .post(`/api/v1/projects/${testProject.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Test Task for Linking',
        description: 'Task to link documents to',
        ownerId: pmUser.id,
        status: TaskStatus.PLANNED,
        plannedStart: new Date('2025-02-01').toISOString(),
        plannedEnd: new Date('2025-02-28').toISOString(),
      })
      .expect(201);

    testTask = taskResponse.body.data;

    // Create test document
    const buffer = Buffer.from('Test document content');
    const documentResponse = await ctx.httpClient
      .post(`/api/v1/projects/${testProject.id}/documents`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('title', 'Test Document for Linking')
      .field('docType', DocumentType.REPORT)
      .field('classification', DocumentClassification.INTERNAL)
      .field('ownerId', pmUser.id)
      .field('retentionPolicy', DocumentRetentionPolicy.DEFAULT)
      .attach('file', buffer, 'test.txt')
      .expect(201);

    testDocument = documentResponse.body.data;
  });

  afterAll(async () => {
    // Cleanup
    if (testTask) {
      await ctx.prisma.documentTask.deleteMany({ where: { taskId: testTask.id } });
    }
    if (testDocument) {
      await ctx.prisma.documentTask.deleteMany({ where: { documentId: testDocument.id } });
      await ctx.prisma.documentVersion.deleteMany({ where: { documentId: testDocument.id } });
      await ctx.prisma.document.delete({ where: { id: testDocument.id } }).catch(() => {});
    }
    if (testTask) {
      await ctx.prisma.task.delete({ where: { id: testTask.id } }).catch(() => {});
    }
    if (testProject) {
      await ctx.prisma.project.delete({ where: { id: testProject.id } }).catch(() => {});
    }
    await teardownTestApp(ctx);
  });

  describe('POST /api/v1/documents/:documentId/link-task', () => {
    it('should successfully link document to task', async () => {
      const response = await ctx.httpClient
        .post(`/api/v1/documents/${testDocument.id}/link-task`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskId: testTask.id })
        .expect(201);

      expect(response.body.data.type).toBe('document-task-link');
      expect(response.body.data.attributes.documentId).toBe(testDocument.id);
      expect(response.body.data.attributes.taskId).toBe(testTask.id);
      expect(response.body.data.attributes.linkedBy).toBe(pmUser.id);
      expect(response.body.data.attributes.linkedAt).toBeDefined();
      expect(response.body.data.attributes.document).toBeDefined();
      expect(response.body.data.attributes.task).toBeDefined();
    });

    it('should fail to link same document to same task twice', async () => {
      const response = await ctx.httpClient
        .post(`/api/v1/documents/${testDocument.id}/link-task`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskId: testTask.id })
        .expect(400);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toBe('LINK_ALREADY_EXISTS');
    });

    it('should fail when task does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await ctx.httpClient
        .post(`/api/v1/documents/${testDocument.id}/link-task`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskId: nonExistentId })
        .expect(404);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toContain('NOT_FOUND');
    });

    it('should fail when document does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const response = await ctx.httpClient
        .post(`/api/v1/documents/${nonExistentId}/link-task`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskId: testTask.id })
        .expect(404);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
    });

    it('should fail when task and document are in different projects', async () => {
      // Create another project
      const otherProjectResponse = await ctx.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Other Project ${Date.now()}`,
          description: 'Another project',
          sponsorId: pmUser.id,
          startDate: new Date('2025-01-01').toISOString(),
          endDate: new Date('2025-12-31').toISOString(),
        })
        .expect(201);

      const otherProject = {
        id: otherProjectResponse.body.data.id,
      };

      // Create task in other project
      const otherTaskResponse = await ctx.httpClient
        .post(`/api/v1/projects/${otherProject.id}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Task in Other Project',
          ownerId: pmUser.id,
          plannedStart: new Date('2025-02-01').toISOString(),
          plannedEnd: new Date('2025-02-28').toISOString(),
        })
        .expect(201);

      const otherTask = otherTaskResponse.body.data;

      const response = await ctx.httpClient
        .post(`/api/v1/documents/${testDocument.id}/link-task`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskId: otherTask.id })
        .expect(400);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toBe('PROJECT_MISMATCH');

      // Cleanup
      await ctx.prisma.task.delete({ where: { id: otherTask.id } }).catch(() => {});
      await ctx.prisma.project.delete({ where: { id: otherProject.id } }).catch(() => {});
    });
  });

  describe('GET /api/v1/tasks/:taskId/documents', () => {
    it('should retrieve all documents linked to a task', async () => {
      const response = await ctx.httpClient
        .get(`/api/v1/tasks/${testTask.id}/documents`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);

      const link = response.body.data[0];
      expect(link.type).toBe('document-task-link');
      expect(link.attributes.document).toBeDefined();
      expect(link.attributes.document.id).toBe(testDocument.id);
      expect(link.attributes.linkedBy).toBeDefined();
      expect(link.attributes.linkedAt).toBeDefined();
    });

    it('should return empty array for task with no linked documents', async () => {
      // Create a new task without documents
      const newTaskResponse = await ctx.httpClient
        .post(`/api/v1/projects/${testProject.id}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Task Without Documents',
          ownerId: pmUser.id,
          plannedStart: new Date('2025-03-01').toISOString(),
          plannedEnd: new Date('2025-03-31').toISOString(),
        })
        .expect(201);

      const newTask = newTaskResponse.body.data;

      const response = await ctx.httpClient
        .get(`/api/v1/tasks/${newTask.id}/documents`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(0);

      // Cleanup
      await ctx.prisma.task.delete({ where: { id: newTask.id } }).catch(() => {});
    });
  });

  describe('GET /api/v1/documents/:documentId/tasks', () => {
    it('should retrieve all tasks linked to a document', async () => {
      const response = await ctx.httpClient
        .get(`/api/v1/documents/${testDocument.id}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);

      const link = response.body.data[0];
      expect(link.type).toBe('document-task-link');
      expect(link.attributes.task).toBeDefined();
      expect(link.attributes.task.id).toBe(testTask.id);
      expect(link.attributes.linkedBy).toBeDefined();
    });
  });

  describe('DELETE /api/v1/documents/:documentId/unlink-task/:taskId', () => {
    it('should successfully unlink document from task', async () => {
      const response = await ctx.httpClient
        .delete(`/api/v1/documents/${testDocument.id}/unlink-task/${testTask.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.attributes.success).toBe(true);
      expect(response.body.data.attributes.linkId).toBeDefined();

      // Verify link is removed
      const links = await ctx.prisma.documentTask.findMany({
        where: {
          documentId: testDocument.id,
          taskId: testTask.id,
        },
      });

      expect(links.length).toBe(0);
    });

    it('should fail to unlink when link does not exist', async () => {
      const response = await ctx.httpClient
        .delete(`/api/v1/documents/${testDocument.id}/unlink-task/${testTask.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      const error = response.body.error || response.body.errors?.[0];
      expect(error).toBeDefined();
      expect(error.code).toContain('NOT_FOUND');
    });
  });
});
