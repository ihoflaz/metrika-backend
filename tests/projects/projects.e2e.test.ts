import { PrismaClient, UserStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/rbac/permissions';

describe('Project API', () => {
  let context!: TestAppContext;
  let prisma!: PrismaClient;
  let pmoToken!: string;
  let sponsorId!: string;

  const createUserWithRole = async (
    roleCode: string,
    overrides: Partial<{ email: string; fullName: string; password: string }> = {},
  ) => {
    const password = overrides.password ?? 'SecurePass123!';
    const passwordHash = await hashPassword(password);
    const userId = uuidv7();

    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

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

  const login = async (credentials: { email: string; password: string }) => {
    const response = await context.httpClient.post('/api/v1/auth/login').send(credentials);
    expect(response.status).toBe(200);
    return response.body.data.attributes.accessToken as string;
  };

  beforeAll(async () => {
    context = await setupTestApp();
    prisma = context.prisma;

    const pmoCredentials = await createUserWithRole(ROLES.PMO, {
      email: 'pmo@metrika.local',
      fullName: 'PMO User',
    });

    const sponsor = await createUserWithRole(ROLES.SYSADMIN, {
      email: 'sponsor@metrika.local',
      fullName: 'Sponsor User',
    });

    sponsorId = sponsor.id;

    pmoToken = await login(pmoCredentials);
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  const createProject = async (payload?: Record<string, unknown>) =>
    context.httpClient
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({
        name: 'Yeni Proje',
        sponsorId,
        startDate: '2025-01-01',
        endDate: '2025-06-30',
        budgetPlanned: 100000,
        metadata: { strategic: true },
        ...payload,
      });

  it('PMO kullanicisi yeni proje olusturur ve kod otomatik atanir', async () => {
    const response = await createProject();

    expect(response.status).toBe(201);
    expect(response.body.data.attributes.code).toMatch(/PRJ-\d{4}-\d{3}/);
    expect(response.body.data.attributes.name).toBe('Yeni Proje');
  });

  it('Proje listesi filtrelenmeden doner', async () => {
    await createProject({ name: 'Liste Projesi' });

    const response = await context.httpClient
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('Proje detayi ve guncellemesi yapilabilir', async () => {
    const createResponse = await createProject({ name: 'Guncellenecek Proje' });
    const projectId = createResponse.body.data.id as string;

    const detailResponse = await context.httpClient
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${pmoToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.attributes.name).toBe('Guncellenecek Proje');

    const updateResponse = await context.httpClient
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send({ description: 'Guncellenmis aciklama' });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.attributes.description).toBe('Guncellenmis aciklama');
  });

  it('Proje kapatma islemi yapilabilir', async () => {
    const createResponse = await createProject({ name: 'Kapatilacak Proje' });
    const projectId = createResponse.body.data.id as string;

    const closeResponse = await context.httpClient
      .post(`/api/v1/projects/${projectId}/close`)
      .set('Authorization', `Bearer ${pmoToken}`)
      .send();

    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.data.attributes.status).toBe('CLOSED');
  });
});
