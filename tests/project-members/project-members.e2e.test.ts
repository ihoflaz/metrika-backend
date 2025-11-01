import { PrismaClient, UserStatus, ProjectMemberRole } from '@prisma/client';
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
      email: overrides.email ?? `${roleCode.toLowerCase()}-member@metrika.local`,
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
    email: overrides.email ?? `${roleCode.toLowerCase()}-member@metrika.local`,
    password,
  };
};

const login = async (context: TestAppContext, credentials: { email: string; password: string }) => {
  const response = await context.httpClient.post('/api/v1/auth/login').send(credentials);
  expect(response.status).toBe(200);
  return response.body.data.attributes.accessToken as string;
};

describe('Project Member API', () => {
  let context: TestAppContext;
  let prisma: PrismaClient;
  let pmoToken: string;
  let pmToken: string;
  let sponsorId: string;
  let teamMember1Id: string;
  let teamMember2Id: string;
  let projectId: string;

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    const pmoUser = await createRoleUser(prisma, ROLES.PMO, {
      email: 'pmo-member@metrika.local',
      fullName: 'PMO Member',
    });

    const pmUser = await createRoleUser(prisma, ROLES.PROJECT_MANAGER, {
      email: 'pm-member@metrika.local',
      fullName: 'Project Manager Member',
    });

    const sponsor = await createRoleUser(prisma, ROLES.SYSADMIN, {
      email: 'sponsor-member@metrika.local',
      fullName: 'Member Sponsor',
    });

    const teamMember1 = await createRoleUser(prisma, ROLES.TEAM_MEMBER, {
      email: 'member1@metrika.local',
      fullName: 'Team Member 1',
    });

    const teamMember2 = await createRoleUser(prisma, ROLES.TEAM_MEMBER, {
      email: 'member2@metrika.local',
      fullName: 'Team Member 2',
    });

    sponsorId = sponsor.id;
    teamMember1Id = teamMember1.id;
    teamMember2Id = teamMember2.id;

    pmoToken = await login(context, { email: pmoUser.email, password: pmoUser.password });
    pmToken = await login(context, { email: pmUser.email, password: pmUser.password });

    const projectResponse = await context.httpClient
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        name: 'Uyelik Projesi',
        sponsorId,
        startDate: '2025-04-01',
      });

    expect(projectResponse.status).toBe(201);
    projectId = projectResponse.body.data.id as string;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  it('Projeye ekip uyesi ekler ve listeler', async () => {
    // Add first member as CONTRIBUTOR
    const addResponse1 = await context.httpClient
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: teamMember1Id,
        role: ProjectMemberRole.CONTRIBUTOR,
        allocationPct: 80,
      });

    expect(addResponse1.status).toBe(201);
    expect(addResponse1.body.data.attributes.role).toBe(ProjectMemberRole.CONTRIBUTOR);
    expect(addResponse1.body.data.attributes.allocationPct).toBe(80);

    // Add second member as LEAD
    const addResponse2 = await context.httpClient
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: teamMember2Id,
        role: ProjectMemberRole.LEAD,
        allocationPct: 100,
      });

    expect(addResponse2.status).toBe(201);
    expect(addResponse2.body.data.attributes.role).toBe(ProjectMemberRole.LEAD);

    // List members
    const listResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.length).toBe(2);
    expect(listResponse.body.meta.total).toBe(2);
  });

  it('Uye rolunu gunceller', async () => {
    // First get the member
    const listResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    const member = listResponse.body.data.find(
      (m: { relationships: { user: { id: string } } }) => m.relationships.user.id === teamMember1Id,
    );
    expect(member).toBeDefined();

    const memberId = member.id as string;

    // Update role and allocation
    const updateResponse = await context.httpClient
      .patch(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        role: ProjectMemberRole.REVIEWER,
        allocationPct: 50,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.attributes.role).toBe(ProjectMemberRole.REVIEWER);
    expect(updateResponse.body.data.attributes.allocationPct).toBe(50);
  });

  it('Bir kullaniciya ayni projede birden fazla rol atar', async () => {
    // Team member 1 is already REVIEWER, add them as CONTRIBUTOR too
    const addResponse = await context.httpClient
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: teamMember1Id,
        role: ProjectMemberRole.PM,
        allocationPct: 20,
      });

    expect(addResponse.status).toBe(201);
    expect(addResponse.body.data.attributes.role).toBe(ProjectMemberRole.PM);

    // List members - should now have 3 entries (2 roles for member1, 1 for member2)
    const listResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.length).toBe(3);
  });

  it('Ayni rol ile duplicate uye eklemeyi onler', async () => {
    const addResponse = await context.httpClient
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: teamMember1Id,
        role: ProjectMemberRole.PM, // Already exists
        allocationPct: 20,
      });

    expect(addResponse.status).toBe(409);
    expect(addResponse.body.errors[0].code).toBe('RESOURCE_CONFLICT');
  });

  it('Uyelik detayini getirir', async () => {
    const listResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    const memberId = listResponse.body.data[0].id as string;

    const detailResponse = await context.httpClient
      .get(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.id).toBe(memberId);
    expect(detailResponse.body.data.relationships.project).toBeDefined();
    expect(detailResponse.body.data.relationships.user).toBeDefined();
  });

  it('Uyeligi siler (soft delete)', async () => {
    const listResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    const memberId = listResponse.body.data[0].id as string;

    const deleteResponse = await context.httpClient
      .delete(`/api/v1/members/${memberId}`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(deleteResponse.status).toBe(204);

    // Verify member is not in active list anymore
    const listAfterDelete = await context.httpClient
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(listAfterDelete.body.data.length).toBe(2); // One less than before
  });

  it('Olmayan projeye uye eklemeyi reddeder', async () => {
    const fakeProjectId = uuidv7();

    const addResponse = await context.httpClient
      .post(`/api/v1/projects/${fakeProjectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: teamMember1Id,
        role: ProjectMemberRole.CONTRIBUTOR,
      });

    expect(addResponse.status).toBe(404);
    expect(addResponse.body.errors[0].code).toBe('PROJECT_NOT_FOUND');
  });

  it('Olmayan kullaniciyi uye olarak eklemeyi reddeder', async () => {
    const fakeUserId = uuidv7();

    const addResponse = await context.httpClient
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        userId: fakeUserId,
        role: ProjectMemberRole.CONTRIBUTOR,
      });

    expect(addResponse.status).toBe(404);
    expect(addResponse.body.errors[0].code).toBe('USER_NOT_FOUND');
  });
});
