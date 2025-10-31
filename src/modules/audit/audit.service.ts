import { PrismaClient, AuditActorType } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import type { Logger } from '../../lib/logger';

export interface AuditContext {
  requestId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEventPayload {
  actorId: string | null;
  detail?: string;
  context?: AuditContext;
  email?: string;
  metadata?: Record<string, unknown>;
}

export type AuditEventCode =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOGIN_BLOCKED'
  | 'AUTH_REFRESH_SUCCESS'
  | 'AUTH_REFRESH_FAILED';

export class AuditService {
  private readonly prisma: PrismaClient;

  private readonly logger: Logger;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async logAuthEvent(eventCode: AuditEventCode, payload: AuditEventPayload) {
    try {
      const metadata = {
        ...payload.metadata,
        email: payload.email,
        requestId: payload.context?.requestId,
      } as Record<string, unknown>;

      await this.prisma.auditLog.create({
        data: {
          id: uuidv7(),
          actorType: payload.actorId ? AuditActorType.USER : AuditActorType.SYSTEM,
          actorId: payload.actorId ?? undefined,
          eventCode,
          description: payload.detail,
          ipAddress: payload.context?.ipAddress,
          userAgent: payload.context?.userAgent,
          metadata,
        },
      });
    } catch (error: unknown) {
      this.logger.error({ error, eventCode, payload }, 'Failed to write audit log');
    }
  }
}
