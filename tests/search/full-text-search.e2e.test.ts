import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient, ProjectStatus, TaskStatus, TaskPriority, DocumentType, DocumentClassification, DocumentRetentionPolicy } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { uuidv7 } from 'uuidv7';
import { ROLES } from '../../src/modules/rbac/permissions';

let context: TestAppContext;
let prisma: PrismaClient;
let httpClient: ReturnType<typeof import('supertest')>;

describe('Full-Text Search (Day 15)', () => {
  let authToken: string;
  let testUserId: string;
  let testProjectId: string;
  let testTaskId: string;
  let testDocumentId: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;
    httpClient = context.httpClient;

    // Create test user with PMO role
    testUserId = uuidv7();
    const password = 'TestSearch123!';
    const passwordHash = await hashPassword(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.PMO } });

    const email = `search-test-${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email,
        fullName: 'Search Test User',
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
    console.log('✅ Auth token obtained for search tests');

    // Create test project with searchable content
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        code: 'SEARCH-PROJECT',
        name: 'Full-Text Search Test Project',
        description: 'This project contains searchable keywords like analytics dashboard reporting',
        status: ProjectStatus.ACTIVE,
        sponsorId: testUserId,
        pmoOwnerId: testUserId,
        startDate: new Date('2025-01-01'),
      },
    });
    testProjectId = project.id;

    // Create test task with searchable content
    const task = await prisma.task.create({
      data: {
        id: uuidv7(),
        code: 'SEARCH-TASK-001',
        title: 'Implement authentication system',
        description: 'Create JWT authentication with OAuth integration and multi-factor support',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        projectId: testProjectId,
        ownerId: testUserId,
        reporterId: testUserId,
        plannedStart: new Date('2025-01-15'),
        plannedEnd: new Date('2025-02-15'),
      },
    });
    testTaskId = task.id;

    // Create test document with searchable content
    const doc = await prisma.document.create({
      data: {
        id: uuidv7(),
        projectId: testProjectId,
        title: 'Technical Architecture Documentation',
        docType: DocumentType.PLAN,
        classification: DocumentClassification.INTERNAL,
        ownerId: testUserId,
        storageKey: 'test/architecture-doc.pdf',
        tags: ['architecture', 'microservices', 'kubernetes', 'scalability'],
        retentionPolicy: DocumentRetentionPolicy.DEFAULT,
      },
    });
    testDocumentId = doc.id;

    // Force update search vectors (triggers should handle this automatically)
    await prisma.$executeRawUnsafe(`UPDATE "Project" SET "updatedAt" = NOW() WHERE "id" = '${testProjectId}'`);
    await prisma.$executeRawUnsafe(`UPDATE "Task" SET "updatedAt" = NOW() WHERE "id" = '${testTaskId}'`);
    await prisma.$executeRawUnsafe(`UPDATE "Document" SET "updatedAt" = NOW() WHERE "id" = '${testDocumentId}'`);

    console.log('✅ Test setup complete with searchable data');
  });

  afterAll(async () => {
    // Clean up test data
    if (testDocumentId) {
      await prisma.document.deleteMany({ where: { id: testDocumentId } });
    }
    if (testTaskId) {
      await prisma.task.deleteMany({ where: { id: testTaskId } });
    }
    if (testProjectId) {
      await prisma.project.deleteMany({ where: { id: testProjectId } });
    }
    await prisma.userRole.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });

    await teardownTestApp(context);
  });

  describe('Document Search', () => {
    test('should find documents by title keywords', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: 'architecture documentation', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundDoc = res.body.data.find((d: any) => d.id === testDocumentId);
      expect(foundDoc).toBeDefined();
      expect(foundDoc.attributes.title).toContain('Architecture');
      expect(foundDoc.attributes.rank).toBeGreaterThan(0);

      console.log('✅ Document search by title working');
    });

    test('should find documents by tags', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: 'kubernetes microservices', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundDoc = res.body.data.find((d: any) => d.id === testDocumentId);
      expect(foundDoc).toBeDefined();
      expect(foundDoc.attributes.tags).toContain('kubernetes');
      expect(foundDoc.attributes.tags).toContain('microservices');

      console.log('✅ Document search by tags working');
    });

    test('should filter documents by projectId', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: 'architecture', projectId: testProjectId, limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.query).toBe('architecture');
      
      res.body.data.forEach((doc: any) => {
        expect(doc.attributes.projectId).toBe(testProjectId);
      });

      console.log('✅ Document search with projectId filter working');
    });

    test('should return empty array when no matches found', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: 'nonexistent completely random gibberish text 98765', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(0);

      console.log('✅ Document search with no results handled correctly');
    });
  });

  describe('Task Search', () => {
    test('should find tasks by title keywords', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'authentication system', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundTask = res.body.data.find((t: any) => t.id === testTaskId);
      expect(foundTask).toBeDefined();
      expect(foundTask.attributes.title).toContain('authentication');
      expect(foundTask.attributes.rank).toBeGreaterThan(0);

      console.log('✅ Task search by title working');
    });

    test('should find tasks by description keywords', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'OAuth multi-factor', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundTask = res.body.data.find((t: any) => t.id === testTaskId);
      expect(foundTask).toBeDefined();
      expect(foundTask.attributes.description).toContain('OAuth');

      console.log('✅ Task search by description working');
    });

    test('should find tasks by code', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'SEARCH-TASK-001', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundTask = res.body.data.find((t: any) => t.id === testTaskId);
      expect(foundTask).toBeDefined();
      expect(foundTask.attributes.code).toBe('SEARCH-TASK-001');

      console.log('✅ Task search by code working');
    });

    test('should filter tasks by status', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'authentication', status: TaskStatus.IN_PROGRESS, limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);

      res.body.data.forEach((task: any) => {
        expect(task.attributes.status).toBe(TaskStatus.IN_PROGRESS);
      });

      console.log('✅ Task search with status filter working');
    });

    test('should filter tasks by projectId', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'authentication', projectId: testProjectId, limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);

      res.body.data.forEach((task: any) => {
        expect(task.attributes.projectId).toBe(testProjectId);
      });

      console.log('✅ Task search with projectId filter working');
    });
  });

  describe('Project Search', () => {
    test('should find projects by name keywords', async () => {
      const res = await httpClient
        .get('/api/v1/projects/search')
        .query({ q: 'full-text search project', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundProject = res.body.data.find((p: any) => p.id === testProjectId);
      expect(foundProject).toBeDefined();
      expect(foundProject.attributes.name).toContain('Search');
      expect(foundProject.attributes.rank).toBeGreaterThan(0);

      console.log('✅ Project search by name working');
    });

    test('should find projects by description keywords', async () => {
      const res = await httpClient
        .get('/api/v1/projects/search')
        .query({ q: 'analytics dashboard reporting', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundProject = res.body.data.find((p: any) => p.id === testProjectId);
      expect(foundProject).toBeDefined();
      expect(foundProject.attributes.description).toContain('analytics');

      console.log('✅ Project search by description working');
    });

    test('should find projects by code', async () => {
      const res = await httpClient
        .get('/api/v1/projects/search')
        .query({ q: 'SEARCH-PROJECT', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const foundProject = res.body.data.find((p: any) => p.id === testProjectId);
      expect(foundProject).toBeDefined();
      expect(foundProject.attributes.code).toBe('SEARCH-PROJECT');

      console.log('✅ Project search by code working');
    });

    test('should filter projects by status', async () => {
      const res = await httpClient
        .get('/api/v1/projects/search')
        .query({ q: 'search', status: ProjectStatus.ACTIVE, limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);

      res.body.data.forEach((project: any) => {
        expect(project.attributes.status).toBe(ProjectStatus.ACTIVE);
      });

      console.log('✅ Project search with status filter working');
    });
  });

  describe('Search Validation', () => {
    test('should reject empty search query', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: '', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      const error = res.body.errors?.[0];
      expect(error?.code).toBe('INVALID_SEARCH_QUERY');

      console.log('✅ Empty query validation working');
    });

    test('should reject invalid limit values', async () => {
      const res = await httpClient
        .get('/api/v1/tasks/search')
        .query({ q: 'test', limit: 200 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      const error = res.body.errors?.[0];
      expect(error?.code).toBe('INVALID_LIMIT');

      console.log('✅ Limit validation working');
    });

    test('should handle special characters in search query', async () => {
      const res = await httpClient
        .get('/api/v1/projects/search')
        .query({ q: 'search & test | query', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);

      console.log('✅ Special characters handled correctly');
    });

    test('should handle multi-word search queries with ranking', async () => {
      const res = await httpClient
        .get('/api/v1/documents/search')
        .query({ q: 'architecture kubernetes', limit: 10 })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);

      if (res.body.data.length > 1) {
        // Verify ranking order (higher rank first)
        const ranks = res.body.data.map((d: any) => d.attributes.rank);
        for (let i = 1; i < ranks.length; i++) {
          expect(ranks[i - 1]).toBeGreaterThanOrEqual(ranks[i]);
        }
      }

      console.log('✅ Multi-word search with ranking working');
    });
  });
});
