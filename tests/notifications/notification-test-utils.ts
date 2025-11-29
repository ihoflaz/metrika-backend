import { jest } from '@jest/globals';
import type { Prisma, PrismaClient } from '@prisma/client';

type EnqueuedJob = {
  type: 'EMAIL' | 'IN_APP' | 'WEBHOOK';
  payload: Record<string, unknown>;
};

/**
 * Creates a lightweight mock QueueService that records notification jobs.
 * Tests can assert on `jobs` to verify NotificationService behaviour
 * without requiring a real Redis/BullMQ worker.
 */
export function createMockQueueService() {
  const jobs: EnqueuedJob[] = [];

  return {
    queueService: {
      addNotificationJob: jest.fn(async (job: EnqueuedJob) => {
        jobs.push(job);
        return { id: `job-${jobs.length}` };
      }),
    },
    jobs,
  };
}

/**
 * Returns a partial PrismaClient implementation that stores notifications in-memory.
 * Useful for NotificationWorker tests where only `notification.create` is required.
 */
export function createMockPrismaClient() {
  const notifications: Array<Prisma.NotificationCreateInput & { id: string }> = [];

  return {
    notification: {
      create: jest.fn(async ({ data }: Prisma.NotificationCreateArgs) => {
        const record = {
          id: `notif_${notifications.length + 1}`,
          ...data,
        };
        notifications.push(record);
        return record;
      }),
      findMany: jest.fn(async () => notifications),
      deleteMany: jest.fn(async () => {
        const count = notifications.length;
        notifications.length = 0;
        return { count };
      }),
    },
    _store: {
      notifications,
    },
  } as unknown as PrismaClient;
}
