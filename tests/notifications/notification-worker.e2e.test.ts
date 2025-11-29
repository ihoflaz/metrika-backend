import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { initializeEnv } from '../../src/config/env';
import { UserStatus, WebhookChannel } from '@prisma/client';
import { getQueueService } from '../../src/modules/automation/queue.service';
import { randomUUID } from 'crypto';
import { setupTestApp, teardownTestApp, type TestAppContext } from '../utils/test-app';

initializeEnv();

const queueService = getQueueService();

const waitFor = async <T>(check: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5000, intervalMs = 150) => {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T;
  do {
    lastValue = await check();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  throw new Error('Condition not met within timeout');
};

describe('NotificationWorker integration', () => {
  const originalFetch = global.fetch;
  let testContext: TestAppContext;
  let prisma: TestAppContext['prisma'];
  let startNotificationWorker: () => any;
  let stopNotificationWorker: () => Promise<void>;
  let testUser: { id: string; email: string };
  let webhookId: string | null = null;

  beforeAll(async () => {
    jest.setTimeout(30000);
    testContext = await setupTestApp();
    prisma = testContext.prisma;

    ({ startNotificationWorker, stopNotificationWorker } = await import('../../src/modules/automation/workers/notification.worker'));
    startNotificationWorker();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    }) as unknown as typeof fetch;

    testUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: 'notification-worker@test.com',
        fullName: 'Notification Worker User',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test$test',
        status: UserStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    if (webhookId) {
      await prisma.webhookSubscription.delete({ where: { id: webhookId } }).catch(() => undefined);
    }
    await prisma.notification.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await stopNotificationWorker();
    await teardownTestApp(testContext);
    if (originalFetch) {
      global.fetch = originalFetch;
    }
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({ where: { userId: testUser.id } });
    if (webhookId) {
      await prisma.webhookSubscription.delete({ where: { id: webhookId } }).catch(() => undefined);
      webhookId = null;
    }
    (global.fetch as jest.Mock).mockClear();
  });

  it('stores in-app notification records via queue jobs', async () => {
    await queueService.addNotificationJob({
      type: 'IN_APP',
      userId: testUser.id,
      template: 'task-delayed',
      payload: {
        title: 'Görev gecikti',
        message: 'Queue test görevi gecikti',
        data: { taskId: 'task-queue-1' },
      },
    });

    const record = await waitFor(
      () =>
        prisma.notification.findFirst({
          where: { userId: testUser.id, type: 'task-delayed' },
        }),
      (value) => Boolean(value),
    );

    expect(record?.title).toBe('Görev gecikti');
    expect(record?.message).toContain('Queue test');
    expect(record?.data).toMatchObject({ taskId: 'task-queue-1' });
  });

  it('delivers webhook jobs and records delivery metadata', async () => {
    const subscription = await prisma.webhookSubscription.create({
      data: {
        id: randomUUID(),
        name: 'Queue Test Webhook',
        url: 'https://hooks.example.com/metrika',
        secret: 'super-secret',
        events: ['task-delayed'],
        channel: WebhookChannel.GENERIC,
        createdBy: testUser.id,
        updatedBy: testUser.id,
      },
    });

    webhookId = subscription.id;

    await queueService.addNotificationJob({
      type: 'WEBHOOK',
      template: 'task-delayed',
      event: 'task-delayed',
      payload: {
        title: 'Webhook Gönderimi',
        message: 'Webhook testi',
        data: { taskId: 'task-webhook-1' },
      },
    });

    await waitFor(
      () =>
        prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        }),
      (value) => Boolean(value?.lastDeliveredAt),
    );

    expect(global.fetch).toHaveBeenCalledWith(
      subscription.url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Metrika-Event': 'task-delayed',
        }),
      }),
    );

    const updated = await prisma.webhookSubscription.findUnique({ where: { id: subscription.id } });
    expect(updated?.failureCount).toBe(0);
    expect(updated?.lastDeliveredAt).toBeTruthy();
  });
});
