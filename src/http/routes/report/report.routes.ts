import { Router } from 'express';
import type { ReportsController } from '../../controllers/report/reports.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export function createReportsRouter(reportsController: ReportsController): Router {
  const router = Router();

  router.get(
    '/portfolio-summary',
    requirePermissions(PERMISSIONS.REPORT_READ, PERMISSIONS.PROJECT_READ),
    reportsController.getPortfolioSummary,
  );

  router.get(
    '/kpi-dashboard',
    requirePermissions(PERMISSIONS.REPORT_READ, PERMISSIONS.KPI_READ),
    reportsController.getKPIDashboard,
  );

  router.get(
    '/task-metrics',
    requirePermissions(PERMISSIONS.REPORT_READ, PERMISSIONS.TASK_READ),
    reportsController.getTaskMetrics,
  );

  return router;
}
