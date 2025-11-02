import { Router, RequestHandler } from 'express';
import type { AuditController } from '../../controllers/audit/audit.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export function createAuditRouter(
  auditController: AuditController,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.get(
    '/export',
    authenticate,
    requirePermissions(PERMISSIONS.AUDIT_READ),
    auditController.exportAuditLogs,
  );

  return router;
}
