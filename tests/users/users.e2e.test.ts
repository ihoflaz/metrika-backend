import { uuidv7 } from 'uuidv7';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';

describe('User Management API', () => {
  let context: TestAppContext;
  let adminAccessToken: string;

  beforeAll(async () => {
    context = await setupTestApp();

    const loginResponse = await context.httpClient.post('/api/v1/auth/login').send({
      email: 'admin@metrika.local',
      password: 'ChangeMeNow123!',
    });

    adminAccessToken = loginResponse.body.data.attributes.accessToken as string;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  it('allows SYSADMIN to manage users end-to-end', async () => {
    const newUserEmail = `new.user.${uuidv7()}@metrika.local`;

    const createResponse = await context.httpClient
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        email: newUserEmail,
        fullName: 'New Project Manager',
        password: 'SecurePass123!',
        roles: ['PROJECT_MANAGER'],
      });

    expect(createResponse.status).toBe(201);
    const createdUserId = createResponse.body.data.id as string;
    expect(createResponse.body.data.attributes.roles).toContain('PROJECT_MANAGER');

    const listResponse = await context.httpClient
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(listResponse.status).toBe(200);
    const ids = listResponse.body.data.map((item: { id: string }) => item.id);
    expect(ids).toContain(createdUserId);

    const getResponse = await context.httpClient
      .get(`/api/v1/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.attributes.email).toBe(newUserEmail);

    const updateResponse = await context.httpClient
      .patch(`/api/v1/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        fullName: 'Updated Project Manager',
        roles: ['PMO'],
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.attributes.fullName).toBe('Updated Project Manager');
    expect(updateResponse.body.data.attributes.roles).toContain('PMO');

    const deactivateResponse = await context.httpClient
      .delete(`/api/v1/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.data.attributes.status).toBe('SUSPENDED');

    const activateResponse = await context.httpClient
      .post(`/api/v1/users/${createdUserId}/activate`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(activateResponse.status).toBe(200);
    expect(activateResponse.body.data.attributes.status).toBe('ACTIVE');
  });

  it('denies access to user listing for non privileged members', async () => {
    const memberEmail = `member.${uuidv7()}@metrika.local`;
    const memberPassword = 'MemberPass123!';

    await context.httpClient
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        email: memberEmail,
        fullName: 'Team Member',
        password: memberPassword,
        roles: ['TEAM_MEMBER'],
      });

    const memberLogin = await context.httpClient.post('/api/v1/auth/login').send({
      email: memberEmail,
      password: memberPassword,
    });

    const memberAccessToken = memberLogin.body.data.attributes.accessToken as string;

    const listResponse = await context.httpClient
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${memberAccessToken}`);

    expect(listResponse.status).toBe(403);
  });
});
