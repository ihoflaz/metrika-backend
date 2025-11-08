import { PrismaClient, AuditActorType, type Prisma } from '@prisma/client';
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
  | 'AUTH_REFRESH_FAILED'
  | 'AUTH_LOGOUT'
  | 'AUTH_PASSWORD_CHANGE_SUCCESS'
  | 'AUTH_PASSWORD_CHANGE_FAILED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_CLOSED'
  | 'PROJECT_REOPENED'
  | 'PROJECT_CLONED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'TASK_DEPENDENCY_ADDED'
  | 'TASK_DEPENDENCY_REMOVED'
  | 'TASK_COMMENT_CREATED'
  | 'TASK_COMMENT_UPDATED'
  | 'TASK_COMMENT_DELETED'
  | 'DOCUMENT_CREATED'
  | 'DOCUMENT_VERSION_SUBMITTED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'DOCUMENT_LINKED_TASK'
  | 'DOCUMENT_UNLINKED_TASK';

export type ExportFormat = 'json' | 'csv';

export interface AuditExportFilters {
  startDate?: Date;
  endDate?: Date;
  actorId?: string;
  eventCode?: string;
  actorType?: AuditActorType;
}

export class AuditService {
  private readonly prisma: PrismaClient;

  private readonly logger: Logger;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async logAuthEvent(eventCode: AuditEventCode, payload: AuditEventPayload) {
    await this.logEvent(eventCode, payload);
  }

  async logEvent(eventCode: AuditEventCode, payload: AuditEventPayload) {
    try {
      const metadata: Prisma.InputJsonValue = {
        ...payload.metadata,
        email: payload.email,
        requestId: payload.context?.requestId ?? null,
      };

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

  /**
   * Export audit logs with filtering options
   * Supports JSON and CSV formats
   */
  async exportAuditLogs(filters: AuditExportFilters, format: ExportFormat = 'json'): Promise<string> {
    try {
      // Build where clause
      const where: Prisma.AuditLogWhereInput = {};

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) {
          where.createdAt.gte = filters.startDate;
        }
        if (filters.endDate) {
          where.createdAt.lte = filters.endDate;
        }
      }

      if (filters.actorId) {
        where.actorId = filters.actorId;
      }

      if (filters.eventCode) {
        where.eventCode = filters.eventCode;
      }

      if (filters.actorType) {
        where.actorType = filters.actorType;
      }

      // Fetch audit logs with user details
      const logs = await this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      });

      this.logger.info({ count: logs.length, format, filters }, 'Exporting audit logs');

      if (format === 'csv') {
        return this.convertToCSV(logs);
      }

      return JSON.stringify(logs, null, 2);
    } catch (error: unknown) {
      this.logger.error({ error, filters, format }, 'Failed to export audit logs');
      throw error;
    }
  }

  /**
   * Convert audit logs to CSV format
   */
  private convertToCSV(logs: any[]): string {
    if (logs.length === 0) {
      return 'id,actorType,actorId,actorEmail,actorName,eventCode,description,ipAddress,userAgent,createdAt\n';
    }

    const headers = [
      'id',
      'actorType',
      'actorId',
      'actorEmail',
      'actorName',
      'eventCode',
      'description',
      'ipAddress',
      'userAgent',
      'createdAt',
    ];

    const rows = logs.map((log) => {
      const actorName = log.user?.fullName || '';
      
      return [
        log.id,
        log.actorType,
        log.actorId || '',
        log.user?.email || '',
        actorName,
        log.eventCode,
        (log.description || '').replace(/"/g, '""'), // Escape quotes
        log.ipAddress || '',
        (log.userAgent || '').replace(/"/g, '""'), // Escape quotes
        log.createdAt.toISOString(),
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }
}
