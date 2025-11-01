import { Router } from 'express';
import type { KPIController } from '../../controllers/kpi/kpi.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

export function createKPIRouter(kpiController: KPIController): Router {
  const router = Router();

  /**
   * POST /api/v1/kpis
   * Create a new KPI definition
   * Permission: KPI_CREATE
   */
  router.post('/', requirePermissions(PERMISSIONS.KPI_CREATE), kpiController.create);

  /**
   * GET /api/v1/kpis
   * List KPI definitions with optional filters
   * Permission: KPI_READ
   */
  router.get('/', requirePermissions(PERMISSIONS.KPI_READ), kpiController.list);

  /**
   * GET /api/v1/kpis/:kpiId
   * Get a specific KPI definition with latest data point
   * Permission: KPI_READ
   */
  router.get('/:kpiId', requirePermissions(PERMISSIONS.KPI_READ), kpiController.getById);

  /**
   * PATCH /api/v1/kpis/:kpiId
   * Update a KPI definition (partial update)
   * Permission: KPI_WRITE
   */
  router.patch('/:kpiId', requirePermissions(PERMISSIONS.KPI_WRITE), kpiController.update);

  /**
   * POST /api/v1/kpis/:kpiId/retire
   * Retire a KPI definition
   * Permission: KPI_WRITE
   */
  router.post('/:kpiId/retire', requirePermissions(PERMISSIONS.KPI_WRITE), kpiController.retire);

  /**
   * POST /api/v1/kpis/:kpiId/values
   * Add a new data point to a KPI
   * Permission: KPI_WRITE
   */
  router.post('/:kpiId/values', requirePermissions(PERMISSIONS.KPI_WRITE), kpiController.addData);

  /**
   * GET /api/v1/kpis/:kpiId/trend
   * Get trend analysis for a KPI
   * Permission: KPI_READ
   */
  router.get('/:kpiId/trend', requirePermissions(PERMISSIONS.KPI_READ), kpiController.getTrend);

  /**
   * GET /api/v1/kpis/:kpiId/threshold-check
   * Check if current KPI value exceeds thresholds
   * Permission: KPI_READ
   */
  router.get('/:kpiId/threshold-check', requirePermissions(PERMISSIONS.KPI_READ), kpiController.checkThresholds);

  return router;
}
