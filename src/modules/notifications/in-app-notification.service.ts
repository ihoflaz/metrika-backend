import { PrismaClient, NotificationStatus } from '@prisma/client';

export interface CreateInAppNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ListNotificationsOptions {
  status?: NotificationStatus;
  page?: number;
  limit?: number;
}

export class InAppNotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateInAppNotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data ?? null,
      },
    });
  }

  async list(userId: string, options: ListNotificationsOptions = {}) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const where = {
      userId,
      ...(options.status ? { status: options.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, status: NotificationStatus.UNREAD },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  async archive(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: {
        status: NotificationStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
  }
}
