import { uuidv7 } from 'uuidv7';
import { PrismaClient, UserStatus } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { ROLES, PERMISSIONS } from '../../src/modules/rbac/permissions';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

const createTeamMember = async (prisma: PrismaClient) => {
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLES.TEAM_MEMBER } });
  const password = 'MemberPass123!';
  const passwordHash = await hashPassword(password);
  const userId = uuidv7();

  await prisma.user.create({
    data: {
      id: userId,
      email: 'member@metrika.local',
      fullName: 'Team Member',
      passwordHash,
      status: UserStatus.ACTIVE,
      roles: {
        create: {
          role: {
            connect: { id: memberRole.id },
          },
        },
      },
    },
  });

  return { email: 'member@metrika.local', password };
};

describe('Auth API', () => {
  let context: TestAppContext;
  let memberCredentials: { email: string; password: string };

  beforeAll(async () => {
    context = await setupTestApp();
    memberCredentials = await createTeamMember(context.prisma);
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  it('logs in with valid admin credentials', async () => {
    const { status, body } = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    expect(status).toBe(200);
    expect(body.data.attributes.accessToken).toEqual(expect.any(String));
    expect(body.data.attributes.refreshToken).toEqual(expect.any(String));
    expect(body.data.relationships.user.attributes.roles).toContain('SYSADMIN');
  });

  it('rejects invalid credentials', async () => {
    const { status, body } = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: 'WrongPassword!',
    });

    expect(status).toBe(401);
    expect(body.errors[0].code).toBe('AUTH_UNAUTHORIZED');
  });

  it('issues new tokens via refresh flow and revokes old token', async () => {
    const { body: loginBody } = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    const { refreshToken } = loginBody.data.attributes;

    const { status: refreshStatus, body: refreshBody } = await context.httpClient
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshStatus).toBe(200);
    expect(refreshBody.data.attributes.refreshToken).toEqual(expect.any(String));
    expect(refreshBody.data.attributes.refreshToken).not.toEqual(refreshToken);

    const { status: reuseStatus } = await context.httpClient
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(reuseStatus).toBe(401);
  });

  it('allows access to protected route with required permission', async () => {
    const { body: loginBody } = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    const { accessToken } = loginBody.data.attributes;

    const { status: meStatus, body: meBody } = await context.httpClient
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meStatus).toBe(200);
    expect(meBody.data.attributes.email).toBe(ADMIN_EMAIL);
  });

  it('denies access when permission is missing', async () => {
    const { body: memberLoginBody } = await context.httpClient.post('/api/v1/auth/login').send({
      email: memberCredentials.email,
      password: memberCredentials.password,
    });

    const { accessToken } = memberLoginBody.data.attributes;

    const { status, body } = await context.httpClient
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(status).toBe(403);
    expect(body.errors[0].code).toBe('ACCESS_DENIED');
    expect(body.errors[0].meta.missing).toContain(PERMISSIONS.USER_READ);
  });

  it('rejects unauthenticated access', async () => {
    const { status } = await context.httpClient.get('/api/v1/users/me');
    expect(status).toBe(401);
  });
});
