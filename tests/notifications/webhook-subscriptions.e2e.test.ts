import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

describe('Webhook subscriptions API', () => {
  let context: TestAppContext;
  let authToken: string;

  beforeAll(async () => {
    context = await setupTestApp();

    const loginResponse = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    authToken = loginResponse.body.data.attributes.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  it('creates, lists, updates and deletes webhook subscriptions', async () => {
    const createResponse = await context.httpClient
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Slack Alerts',
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
        events: ['task-assigned'],
        channel: 'SLACK',
      });

    expect(createResponse.status).toBe(201);
    const webhookId = createResponse.body.data.id;
    expect(createResponse.body.meta.secret).toMatch(/^wh_/);

    const listResponse = await context.httpClient
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${authToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);

    const updateResponse = await context.httpClient
      .patch(`/api/v1/webhooks/${webhookId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        events: ['task-assigned', 'task-delayed'],
        rotateSecret: true,
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.meta.rotatedSecret).toMatch(/^wh_/);

    const deleteResponse = await context.httpClient
      .delete(`/api/v1/webhooks/${webhookId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(deleteResponse.status).toBe(204);

    const remaining = await context.prisma.webhookSubscription.count();
    expect(remaining).toBe(0);
  });
});
