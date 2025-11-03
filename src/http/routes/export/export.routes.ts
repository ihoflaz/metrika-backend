import { Router } from 'express';
import * as exportController from '../../controllers/export/export.controller';

export function createExportRouter(): Router {
  const router = Router();

  // Export Portfolio Summary
  router.get(
    '/portfolio/summary',
    exportController.exportPortfolioSummary
  );

  // Export KPI Dashboard
  router.get(
    '/kpi/dashboard',
    exportController.exportKPIDashboard
  );

  // Export Single KPI
  router.get(
    '/kpi/:kpiId',
    exportController.exportSingleKPI
  );

  // Export Task Metrics
  router.get(
    '/task-metrics',
    exportController.exportTaskMetrics
  );

  // Export tasks to Excel
  router.post(
    '/tasks/excel',
    exportController.exportTasksToExcel
  );

  // Export tasks to PDF
  router.post(
    '/tasks/pdf',
    exportController.exportTasksToPDF
  );

  return router;
}

export default createExportRouter;
