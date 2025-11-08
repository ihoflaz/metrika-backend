import type { Request, Response } from 'express';
import { z } from 'zod';
import { WebhookChannel } from '@prisma/client';
import type { WebhookSubscriptionService } from '../../../modules/notifications/webhook-subscription.service';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const subscriptionSchema = z.object({
  name: z.string().trim().min(3),
  url: z.string().url(),
  events: z.array(z.string().trim()).min(1),
  channel: z.nativeEnum(WebhookChannel).optional(),
  secret: z.string().min(16).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(3).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string().trim()).min(1).optional(),
  channel: z.nativeEnum(WebhookChannel).optional(),
  isActive: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

export class WebhookController {
  constructor(private readonly webhookService: WebhookSubscriptionService) {}

  list = async (_req: Request, res: Response) => {
    const subscriptions = await this.webhookService.list();

    res.status(200).json({
      data: subscriptions.map((sub) => ({
        type: 'webhook',
        id: sub.id,
        attributes: {
          name: sub.name,
          url: sub.url,
          events: sub.events,
          channel: sub.channel,
          isActive: sub.isActive,
          failureCount: sub.failureCount,
          lastDeliveredAt: sub.lastDeliveredAt,
          createdAt: sub.createdAt,
          updatedAt: sub.updatedAt,
        },
      })),
      meta: { requestId: getRequestId(res) },
    });
  };

  create = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.webhookService.create(parsed.data, authUser.id);

    res.status(201).json({
      data: {
        type: 'webhook',
        id: result.subscription.id,
        attributes: {
          name: result.subscription.name,
          url: result.subscription.url,
          events: result.subscription.events,
          channel: result.subscription.channel,
          isActive: result.subscription.isActive,
          failureCount: result.subscription.failureCount,
          createdAt: result.subscription.createdAt,
        },
      },
      meta: {
        secret: result.secret,
        requestId: getRequestId(res),
      },
    });
  };

  update = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.webhookService.update(req.params.webhookId, parsed.data, authUser.id);

    res.status(200).json({
      data: {
        type: 'webhook',
        id: result.subscription.id,
        attributes: {
          name: result.subscription.name,
          url: result.subscription.url,
          events: result.subscription.events,
          channel: result.subscription.channel,
          isActive: result.subscription.isActive,
          failureCount: result.subscription.failureCount,
          updatedAt: result.subscription.updatedAt,
        },
      },
      meta: {
        rotatedSecret: result.rotatedSecret,
        requestId: getRequestId(res),
      },
    });
  };

  delete = async (req: Request, res: Response) => {
    await this.webhookService.remove(req.params.webhookId);
    res.status(204).send();
  };
}
