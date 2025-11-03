import { PrismaClient, UserStatus, TaskStatus, TaskPriority, DocumentType, DocumentClassification, DocumentRetentionPolicy } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

const createRoleUser = async (
  prisma: PrismaClient,
  roleCode: string,
  overrides: Partial<{ email: string; fullName: string; password: string }> = {},
) => {
  const password = overrides.password ?? 'SecurePass123!';
  const passwordHash = await hashPassword(password);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const userId = uuidv7();

  await prisma.user.create({
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

describe('Search E2E Tests', () => {
  let context!: TestAppContext;
  let prisma!: PrismaClient;
  let pmoToken!: string;
  let pmoUserId!: string;
  let projectId!: string;

  const login = async (email: string, password: string) => {
    const response = await context.httpClient.post('/api/v1/auth/login').send({ email, password });
    expect(response.status).toBe(200);
    return response.body.data.attributes.accessToken as string;
  };

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    // Create PMO user
    const pmoUser = await createRoleUser(prisma, ROLES.PMO, {
      email: 'pmo-search@metrika.local',
      password: 'PmoPassword123!',
    });
    pmoUserId = pmoUser.id;
    pmoToken = await login(pmoUser.email, pmoUser.password);

    // Create sponsor for project
    const sponsor = await createRoleUser(prisma, ROLES.SYSADMIN, {
      email: 'sponsor-search@metrika.local',
      password: 'SponsorPassword123!',
    });

    // Create a test project
    const project = await prisma.project.create({
      data: {
        id: uuidv7(),
        name: 'Test Project Alpha',
        description: 'Test project for search',
        code: 'TPA',
        sponsorId: sponsor.id,
        startDate: new Date('2025-01-01'),
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (context) {
      await teardownTestApp(context);
    }
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.task.deleteMany({
      where: { projectId },
    });
    await prisma.document.deleteMany({
      where: { projectId },
    });
  });

  describe('GET /api/v1/search - Exact Match', () => {
    it('should return task with exact title match', async () => {
      // Create test task
      const task = await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Implement User Authentication',
          description: 'Add JWT-based authentication system',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.HIGH,
          ownerId: pmoUserId,
        },
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'User Authentication' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const result = response.body.data.find((r: any) => r.id === task.id);
      expect(result).toBeDefined();
      expect(result.type).toBe('TASK');
      expect(result.title).toBe('Implement User Authentication');
      expect(result.relevanceScore).toBeGreaterThan(0.5);
    });

    it('should return project with exact name match', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Project Alpha' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const result = response.body.data.find((r: any) => r.id === projectId);
      expect(result).toBeDefined();
      expect(result.type).toBe('PROJECT');
      expect(result.relevanceScore).toBeGreaterThan(0.5);
    });
  });

  describe('GET /api/v1/search - Fuzzy Match with Typos', () => {
    it('should return results even with typos in search query', async () => {
      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Database Migration Script',
          description: 'Create migration for user table',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.NORMAL,
          ownerId: pmoUserId,
        },
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Databse Migraton' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const result = response.body.data.find((r: any) => r.title.includes('Database Migration'));
      expect(result).toBeDefined();
      expect(result.type).toBe('TASK');
      expect(result.relevanceScore).toBeGreaterThan(0.1);
    });

    it('should handle partial word matches', async () => {
      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'API Documentation Update',
          description: 'Update REST API documentation',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.LOW,
          ownerId: pmoUserId,
        },
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'API Doc' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const result = response.body.data.find((r: any) => r.title.includes('API Documentation'));
      expect(result).toBeDefined();
    });
  });

  describe('GET /api/v1/search - Relevance Ranking', () => {
    it('should rank results by relevance score', async () => {
      await prisma.task.createMany({
        data: [
          {
            id: uuidv7(),
            title: 'API Development',
            description: 'Build new API endpoints',
            projectId,
            status: TaskStatus.PLANNED,
            priority: TaskPriority.HIGH,
            ownerId: pmoUserId,
          },
          {
            id: uuidv7(),
            title: 'API Testing',
            description: 'Write tests for API',
            projectId,
            status: TaskStatus.PLANNED,
            priority: TaskPriority.NORMAL,
            ownerId: pmoUserId,
          },
          {
            id: uuidv7(),
            title: 'Frontend Development',
            description: 'Build UI and integrate with API',
            projectId,
            status: TaskStatus.PLANNED,
            priority: TaskPriority.LOW,
            ownerId: pmoUserId,
          },
        ],
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'API' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(2);

      const relevanceScores = response.body.data.map((r: any) => r.relevanceScore);
      for (let i = 1; i < relevanceScores.length; i++) {
        expect(relevanceScores[i - 1]).toBeGreaterThanOrEqual(relevanceScores[i]);
      }
    });
  });

  describe('GET /api/v1/search - Type Filters', () => {
    it('should filter results by entity type', async () => {
      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Implementation Task',
          description: 'Implement feature',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.HIGH,
          ownerId: pmoUserId,
        },
      });

      await prisma.document.create({
        data: {
          id: uuidv7(),
          title: 'Implementation Guide',
          storageKey: `docs/${uuidv7()}.pdf`,
          docType: DocumentType.REQUIREMENT,
          classification: DocumentClassification.INTERNAL,
          retentionPolicy: DocumentRetentionPolicy.DEFAULT,
          projectId,
          ownerId: pmoUserId,
        },
      });

      const taskResponse = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Implementation', type: 'TASK' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(taskResponse.body.data.length).toBeGreaterThan(0);
      taskResponse.body.data.forEach((result: any) => {
        expect(result.type).toBe('TASK');
      });

      const docResponse = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Implementation', type: 'DOCUMENT' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(docResponse.body.data.length).toBeGreaterThan(0);
      docResponse.body.data.forEach((result: any) => {
        expect(result.type).toBe('DOCUMENT');
      });
    });

    it('should support multiple type filters', async () => {
      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Testing Task',
          description: 'Write tests',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.NORMAL,
          ownerId: pmoUserId,
        },
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Testing', type: ['TASK', 'PROJECT'] })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      response.body.data.forEach((result: any) => {
        expect(['TASK', 'PROJECT']).toContain(result.type);
      });
    });
  });

  describe('GET /api/v1/search - Project Filter', () => {
    it('should filter results by projectId', async () => {
      const sponsor2 = await createRoleUser(prisma, ROLES.SYSADMIN, {
        email: 'sponsor2-search@metrika.local',
        password: 'Sponsor2Password123!',
      });

      const otherProject = await prisma.project.create({
        data: {
          id: uuidv7(),
          name: 'Other Project',
          description: 'Another test project',
          code: 'OTP',
          sponsorId: sponsor2.id,
          startDate: new Date('2025-01-01'),
        },
      });

      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Feature Development',
          description: 'Build feature',
          projectId,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.HIGH,
          ownerId: pmoUserId,
        },
      });

      await prisma.task.create({
        data: {
          id: uuidv7(),
          title: 'Feature Testing',
          description: 'Test feature',
          projectId: otherProject.id,
          status: TaskStatus.PLANNED,
          priority: TaskPriority.NORMAL,
          ownerId: pmoUserId,
        },
      });

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Feature', projectId })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      response.body.data.forEach((result: any) => {
        if (result.projectId) {
          expect(result.projectId).toBe(projectId);
        }
      });

      await prisma.task.deleteMany({ where: { projectId: otherProject.id } });
      await prisma.project.delete({ where: { id: otherProject.id } });
    });
  });

  describe('GET /api/v1/search - Pagination', () => {
    it('should limit results based on limit parameter', async () => {
      const taskPromises = Array.from({ length: 15 }, (_, i) =>
        prisma.task.create({
          data: {
            id: uuidv7(),
            title: `Search Task ${i + 1}`,
            description: 'Test task for search',
            projectId,
            status: TaskStatus.PLANNED,
            priority: TaskPriority.NORMAL,
            ownerId: pmoUserId,
          },
        })
      );
      await Promise.all(taskPromises);

      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Search Task', limit: 5 })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.meta.limit).toBe(5);
    });

    it('should use default limit when not specified', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'Task' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(200);

      expect(response.body.meta.limit).toBe(20);
    });
  });

  describe('GET /api/v1/search - Validation', () => {
    it('should return 400 when query is missing', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when query is empty string', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: '   ' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return 400 for invalid entity type', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'test', type: 'INVALID_TYPE' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid projectId UUID', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'test', projectId: 'not-a-uuid' })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return 400 for limit out of range', async () => {
      const response = await context.httpClient
        .get('/api/v1/search')
        .query({ q: 'test', limit: 101 })
        .set('Authorization', `Bearer ${pmoToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return 401 when not authenticated', async () => {
      await context.httpClient.get('/api/v1/search').query({ q: 'test' }).expect(401);
    });
  });
});
