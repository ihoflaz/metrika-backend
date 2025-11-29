import { NotificationStatus } from '@prisma/client';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';

const ADMIN_EMAIL = 'admin@metrika.local';
const ADMIN_PASSWORD = 'ChangeMeNow123!';

describe('In-app Notifications API', () => {
  let context: TestAppContext;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    context = await setupTestApp();

    const loginResponse = await context.httpClient.post('/api/v1/auth/login').send({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    authToken = loginResponse.body.data.attributes.accessToken;
    userId = loginResponse.body.data.relationships.user.id;
  });

  afterAll(async () => {
    await teardownTestApp(context);
  });

  beforeEach(async () => {
    await context.prisma.notification.deleteMany();
    await context.prisma.notification.createMany({
      data: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          userId,
          type: 'task-assigned',
          title: 'Görev atandı',
          message: 'Yeni görev atandı',
          status: NotificationStatus.UNREAD,
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          userId,
          type: 'task-completed',
          title: 'Görev tamamlandı',
          message: 'Görev tamamlandı',
          status: NotificationStatus.UNREAD,
        },
      ],
    });
  });

  it('lists notifications for current user', async () => {
    const response = await context.httpClient
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].type).toBe('notification');
  });

  it('marks a notification as read', async () => {
    const response = await context.httpClient
      .post('/api/v1/notifications/11111111-1111-1111-1111-111111111111/read')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);

    const record = await context.prisma.notification.findUnique({
      where: { id: '11111111-1111-1111-1111-111111111111' },
    });
    expect(record?.status).toBe(NotificationStatus.READ);
    expect(record?.readAt).toBeTruthy();
  });

  it('marks all notifications as read', async () => {
    const response = await context.httpClient
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);

    const totalRead = await context.prisma.notification.count({
      where: { userId, status: NotificationStatus.READ },
    });
    expect(totalRead).toBe(2);
  });

  it('archives a notification', async () => {
    const response = await context.httpClient
      .post('/api/v1/notifications/22222222-2222-2222-2222-222222222222/archive')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);

    const record = await context.prisma.notification.findUnique({
      where: { id: '22222222-2222-2222-2222-222222222222' },
    });
    expect(record?.status).toBe(NotificationStatus.ARCHIVED);
    expect(record?.archivedAt).toBeTruthy();
  });

  it('supports status filters and pagination metadata', async () => {
    await context.prisma.notification.createMany({
      data: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          userId,
          type: 'task-comment',
          title: 'Yorum eklendi',
          message: 'Göreve yorum eklendi',
          status: NotificationStatus.READ,
        },
        {
          id: '44444444-4444-4444-4444-444444444444',
          userId,
          type: 'task-comment',
          title: 'İkinci yorum',
          message: 'Bir yorum daha',
          status: NotificationStatus.READ,
        },
        {
          id: '55555555-5555-5555-5555-555555555555',
          userId,
          type: 'task-comment',
          title: 'Arşiv deneme',
          message: 'Arşive atılacak',
          status: NotificationStatus.ARCHIVED,
        },
      ],
    });

    const { status, body } = await context.httpClient
      .get('/api/v1/notifications?status=READ&limit=1&page=2')
      .set('Authorization', `Bearer ${authToken}`);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].attributes.status).toBe('READ');
    expect(body.meta.pagination).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('returns 422 for invalid query parameters', async () => {
    const { status, body } = await context.httpClient
      .get('/api/v1/notifications?status=INVALID&page=0&limit=500')
      .set('Authorization', `Bearer ${authToken}`);

    expect(status).toBe(422);
    expect(body.errors?.[0]?.code).toBe('VALIDATION_FAILED');
  });
});
