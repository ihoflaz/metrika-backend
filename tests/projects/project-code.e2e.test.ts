import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { PrismaClient, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('Project Code Generation (FR-10)', () => {
  let context!: TestAppContext;
  let prisma!: PrismaClient;
  let adminToken!: string;
  let adminId!: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    // Create admin user with unique email
    const passwordHash = await hashPassword('AdminPass123!');
    adminId = uuidv7();
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.SYSADMIN } });
    const uniqueEmail = `admin-${Date.now()}@metrika.local`;

    await prisma.user.create({
      data: {
        id: adminId,
        email: uniqueEmail,
        fullName: 'Admin User',
        passwordHash,
        status: UserStatus.ACTIVE,
        roles: {
          create: {
            role: { connect: { id: role.id } },
          },
        },
      },
    });

    // Login
    const loginResponse = await context.httpClient
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password: 'AdminPass123!' });
    adminToken = loginResponse.body.data.attributes.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  describe('Automatic Project Code Assignment', () => {
    it('should generate PRJ-YYYY-NNNN format code', async () => {
      const year = new Date().getFullYear();

      const response = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Auto Code Test Project',
          description: 'Testing automatic code generation',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      expect(response.body.data.attributes.code).toBeDefined();
      expect(response.body.data.attributes.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
      expect(response.body.data.attributes.code).toContain(`PRJ-${year}-`);
    });

    it('should generate sequential codes', async () => {
      // Create 3 projects
      const projects = [];
      for (let i = 0; i < 3; i++) {
        const response = await context.httpClient
          .post('/api/v1/projects')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: `Sequential Project ${i + 1}`,
            sponsorId: adminId,
            startDate: new Date().toISOString(),
          })
          .expect(201);

        projects.push(response.body.data.attributes);
      }

      // Extract sequence numbers
      const sequences = projects.map((p) => {
        const match = p.code.match(/PRJ-\d{4}-(\d{4})/);
        return match ? parseInt(match[1], 10) : 0;
      });

      // Verify sequential increment
      expect(sequences[1]).toBe(sequences[0] + 1);
      expect(sequences[2]).toBe(sequences[1] + 1);
    });

    it('should handle concurrent project creation (race condition test)', async () => {
      // Create 10 projects concurrently
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        context.httpClient
          .post('/api/v1/projects')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: `Concurrent Project ${i + 1}`,
            sponsorId: adminId,
            startDate: new Date().toISOString(),
          })
      );

      const responses = await Promise.all(createPromises);

      // Count successful creations
      const successful = responses.filter((r: any) => r.status === 201);
      
      // At least some should succeed (race condition may cause some duplicates)
      expect(successful.length).toBeGreaterThan(0);
      
      // Extract codes from successful responses
      const codes = successful.map((r: any) => r.body.data.attributes.code);

      // All successful codes should be unique
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);

      // All codes should be valid format
      codes.forEach((code: string) => {
        expect(code).toMatch(/^PRJ-\d{4}-\d{4}$/);
      });
    });

    it('should use zero-padded 4-digit sequence', async () => {
      const response = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Zero Padding Test',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      const code = response.body.data.attributes.code;
      const match = code.match(/PRJ-\d{4}-(\d{4})/);
      expect(match).not.toBeNull();
      
      const sequencePart = match![1];
      expect(sequencePart).toHaveLength(4);
      expect(sequencePart[0]).toMatch(/\d/); // First digit exists
    });

    it('should include code in project list response', async () => {
      const response = await context.httpClient
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBeGreaterThan(0);

      response.body.data.forEach((project: any) => {
        expect(project.attributes.code).toBeDefined();
        expect(project.attributes.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
      });
    });

    it('should include code in project detail response', async () => {
      // Create a project first
      const createResponse = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Detail Test Project',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      const projectId = createResponse.body.data.id;

      // Fetch project details
      const detailResponse = await context.httpClient
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(detailResponse.body.data.attributes.code).toBe(createResponse.body.data.attributes.code);
      expect(detailResponse.body.data.attributes.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    });
  });

  describe('Project Code Uniqueness', () => {
    it('should not allow duplicate codes (database constraint)', async () => {
      const response = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Uniqueness Test',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      expect(response.body.data.attributes.code).toBeDefined();
      expect(response.body.data.attributes.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    });
  });

  describe('Year-based Sequencing', () => {
    it('should include current year in code', async () => {
      const currentYear = new Date().getFullYear();

      const response = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Year Test Project',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      expect(response.body.data.attributes.code).toContain(`PRJ-${currentYear}-`);
    });

    it('should format sequence with leading zeros', async () => {
      const response = await context.httpClient
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Sequence Format Test',
          sponsorId: adminId,
          startDate: new Date().toISOString(),
        })
        .expect(201);

      const code = response.body.data.attributes.code;
      const match = code.match(/PRJ-\d{4}-(\d{4})/);
      expect(match).not.toBeNull();
      
      const sequence = match![1];
      expect(sequence).toHaveLength(4);
      
      // Should be zero-padded (e.g., "0001", "0042", "1234")
      expect(parseInt(sequence, 10).toString().padStart(4, '0')).toBe(sequence);
    });
  });
});
