import { Router } from 'express';
import * as exportController from '../../controllers/export/export.controller';

export function createExportRouter(): Router {
  const router = Router();

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
