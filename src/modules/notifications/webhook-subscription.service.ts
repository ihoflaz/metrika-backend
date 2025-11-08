import { randomBytes, createHmac } from 'node:crypto';
import { PrismaClient, WebhookChannel } from '@prisma/client';

export interface CreateWebhookInput {
  name: string;
  url: string;
  events: string[];
  channel?: WebhookChannel;
  secret?: string;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  events?: string[];
  channel?: WebhookChannel;
  isActive?: boolean;
  rotateSecret?: boolean;
}

export class WebhookSubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    return this.prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: CreateWebhookInput, actorId: string) {
    const secret = input.secret ?? this.generateSecret();

    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        name: input.name,
        url: input.url,
        events: input.events,
        channel: input.channel ?? WebhookChannel.GENERIC,
        secret,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    return { subscription, secret };
  }

  async update(id: string, input: UpdateWebhookInput, actorId: string) {
    const updateData: any = {
      updatedBy: actorId,
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.url !== undefined) updateData.url = input.url;
    if (input.events) updateData.events = input.events;
    if (input.channel) updateData.channel = input.channel;
    if (typeof input.isActive === 'boolean') updateData.isActive = input.isActive;
    if (input.rotateSecret) updateData.secret = this.generateSecret();

    const subscription = await this.prisma.webhookSubscription.update({
      where: { id },
      data: updateData,
    });

    return {
      subscription,
      rotatedSecret: input.rotateSecret ? subscription.secret : undefined,
    };
  }

  async remove(id: string) {
    await this.prisma.webhookSubscription.delete({ where: { id } });
  }

  async getActiveForEvent(event: string) {
    return this.prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
    });
  }

  async recordDeliveryResult(id: string, success: boolean) {
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: success
        ? {
            failureCount: 0,
            lastDeliveredAt: new Date(),
          }
        : {
            failureCount: { increment: 1 },
            lastDeliveredAt: new Date(),
          },
    });
  }

  signPayload(secret: string, payload: string) {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private generateSecret() {
    return `wh_${randomBytes(24).toString('hex')}`;
  }
}
