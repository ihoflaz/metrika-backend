import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { initializeEnv } from '../../src/config/env';
initializeEnv();

import { NotificationService } from '../../src/modules/notifications/notification.service';

jest.mock('../../src/modules/automation/queue.service', () => {
  const queueServiceMock = {
    addNotificationJob: jest.fn(),
  };
  return {
    getQueueService: () => queueServiceMock,
    __queueServiceMock: queueServiceMock,
  };
});

jest.mock('@prisma/client', () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    PrismaClient: jest.fn().mockImplementation(() => prismaMock),
    __prismaMock: prismaMock,
  };
});

const queueServiceModule = jest.requireMock('../../src/modules/automation/queue.service') as {
  __queueServiceMock: { addNotificationJob: jest.Mock };
};

const prismaModule = jest.requireMock('@prisma/client') as {
  __prismaMock: { user: { findUnique: jest.Mock } };
};

const queueServiceMock = queueServiceModule.__queueServiceMock;
const prismaMock = prismaModule.__prismaMock;

jest.mock('../../src/modules/notifications/email.service', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendTemplateEmail: jest.fn(),
    close: jest.fn(),
  })),
}));

describe('NotificationService secondary channels', () => {
  const sampleNotification = {
    type: 'task-delayed' as const,
    taskId: 'task-1',
    taskTitle: 'Delay',
    projectName: 'Project X',
    ownerName: 'Owner',
    ownerEmail: 'owner@example.com',
    delayDays: 3,
    taskUrl: 'http://localhost/tasks/task-1',
  };

  const templateData = {
    taskTitle: 'Delay',
    projectName: 'Project X',
    delayDays: 3,
  };

  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    queueServiceMock.addNotificationJob.mockResolvedValue(undefined);
    queueServiceMock.addNotificationJob.mockClear();
    prismaMock.user.findUnique.mockReset();
    service = new NotificationService();
  });

  it('enqueues IN_APP and WEBHOOK jobs when user exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-123' });

    await (service as any).dispatchSecondaryChannels(
      'owner@example.com',
      sampleNotification,
      templateData,
    );

    expect(queueServiceMock.addNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'IN_APP',
        userId: 'user-123',
        template: sampleNotification.type,
      }),
    );

    expect(queueServiceMock.addNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WEBHOOK',
        event: sampleNotification.type,
      }),
    );
  });

  it('skips IN_APP when user is missing but still enqueues webhook job', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await (service as any).dispatchSecondaryChannels(
      'ghost@example.com',
      sampleNotification,
      templateData,
    );

    expect(
      queueServiceMock.addNotificationJob.mock.calls.filter((call) => call[0].type === 'IN_APP'),
    ).toHaveLength(0);

    expect(queueServiceMock.addNotificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WEBHOOK',
        template: sampleNotification.type,
      }),
    );
  });

  it('swallows queue errors and continues gracefully', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-123' });
    queueServiceMock.addNotificationJob.mockRejectedValueOnce(new Error('Queue down'));

    await expect(
      (service as any).dispatchSecondaryChannels(
        'owner@example.com',
        sampleNotification,
        templateData,
      ),
    ).resolves.toBeUndefined();
  });
});
