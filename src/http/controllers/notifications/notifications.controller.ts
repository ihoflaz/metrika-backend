import type { Request, Response } from 'express';
import { z } from 'zod';
import { NotificationStatus } from '@prisma/client';
import type { InAppNotificationService } from '../../../modules/notifications/in-app-notification.service';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const listQuerySchema = z.object({
  status: z.nativeEnum(NotificationStatus).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class UserNotificationsController {
  constructor(private readonly notificationService: InAppNotificationService) {}

  list = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.notificationService.list(authUser.id, parsed.data);

    res.status(200).json({
      data: result.items.map((item) => ({
        type: 'notification',
        id: item.id,
        attributes: {
          type: item.type,
          title: item.title,
          message: item.message,
          status: item.status,
          data: item.data,
          readAt: item.readAt,
          archivedAt: item.archivedAt,
          createdAt: item.createdAt,
        },
      })),
      meta: {
        requestId: getRequestId(res),
        pagination: result.pagination,
      },
    });
  };

  markRead = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    await this.notificationService.markAsRead(authUser.id, req.params.notificationId);

    res.status(204).send();
  };

  markAllRead = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    await this.notificationService.markAllAsRead(authUser.id);
    res.status(204).send();
  };

  archive = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    await this.notificationService.archive(authUser.id, req.params.notificationId);
    res.status(204).send();
  };
}
