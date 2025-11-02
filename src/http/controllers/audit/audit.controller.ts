import type { Request, Response } from 'express';
import type { AuditService, AuditExportFilters, ExportFormat } from '../../../modules/audit/audit.service';
import { AuditActorType } from '@prisma/client';
import type { Logger } from '../../../lib/logger';

export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly logger: Logger,
  ) {}

  /**
   * GET /api/v1/audit/export
   * Export audit logs with filtering
   * Query params:
   * - format: json | csv (default: json)
   * - startDate: ISO date string
   * - endDate: ISO date string
   * - actorId: UUID
   * - eventCode: string
   * - actorType: USER | SYSTEM
   */
  exportAuditLogs = async (req: Request, res: Response): Promise<void> => {
    const { format = 'json', startDate, endDate, actorId, eventCode, actorType } = req.query;

    // Validate format
    if (format !== 'json' && format !== 'csv') {
      res.status(400).json({
        errors: [
          {
            status: '400',
            code: 'INVALID_FORMAT',
            title: 'Invalid Format',
            detail: 'Format must be either "json" or "csv"',
          },
        ],
      });
      return;
    }

    // Build filters
    const filters: AuditExportFilters = {};

    if (startDate) {
      const parsedStartDate = new Date(startDate as string);
      if (isNaN(parsedStartDate.getTime())) {
        res.status(400).json({
          errors: [
            {
              status: '400',
              code: 'INVALID_START_DATE',
              title: 'Invalid Start Date',
              detail: 'startDate must be a valid ISO date string',
            },
          ],
        });
        return;
      }
      filters.startDate = parsedStartDate;
    }

    if (endDate) {
      const parsedEndDate = new Date(endDate as string);
      if (isNaN(parsedEndDate.getTime())) {
        res.status(400).json({
          errors: [
            {
              status: '400',
              code: 'INVALID_END_DATE',
              title: 'Invalid End Date',
              detail: 'endDate must be a valid ISO date string',
            },
          ],
        });
        return;
      }
      filters.endDate = parsedEndDate;
    }

    if (actorId) {
      filters.actorId = actorId as string;
    }

    if (eventCode) {
      filters.eventCode = eventCode as string;
    }

    if (actorType) {
      if (actorType !== 'USER' && actorType !== 'SYSTEM') {
        res.status(400).json({
          errors: [
            {
              status: '400',
              code: 'INVALID_ACTOR_TYPE',
              title: 'Invalid Actor Type',
              detail: 'actorType must be either "USER" or "SYSTEM"',
            },
          ],
        });
        return;
      }
      filters.actorType = actorType as AuditActorType;
    }

    try {
      this.logger.info({ format, filters }, 'Exporting audit logs');

      const exportContent = await this.auditService.exportAuditLogs(filters, format as ExportFormat);

      // Set appropriate content type and headers
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.json"`);
      }

      res.send(exportContent);
    } catch (error: unknown) {
      this.logger.error({ error, filters, format }, 'Failed to export audit logs');
      res.status(500).json({
        errors: [
          {
            status: '500',
            code: 'EXPORT_FAILED',
            title: 'Export Failed',
            detail: 'Failed to export audit logs',
          },
        ],
      });
    }
  };
}
