import { Router } from 'express';
import multer from 'multer';
import type { DocumentsController } from '../../controllers/document/documents.controller';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';

const MAX_FILE_SIZE = 150 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

export const createProjectDocumentRouter = (controller: DocumentsController): Router => {
  const router = Router({ mergeParams: true });

  router.post(
    '/',
    requirePermissions(PERMISSIONS.DOCUMENT_WRITE),
    upload.single('file'),
    controller.create,
  );

  return router;
};

export const createDocumentRouter = (controller: DocumentsController): Router => {
  const router = Router();

  router.get('/', requirePermissions(PERMISSIONS.DOCUMENT_READ), controller.list);

  router.get('/:documentId', requirePermissions(PERMISSIONS.DOCUMENT_READ), controller.getById);

  router.get(
    '/:documentId/download',
    requirePermissions(PERMISSIONS.DOCUMENT_READ),
    controller.download,
  );

  router.post(
    '/:documentId/versions',
    requirePermissions(PERMISSIONS.DOCUMENT_WRITE),
    upload.single('file'),
    controller.createVersion,
  );

  router.post(
    '/:documentId/versions/:versionId/approve',
    requirePermissions(PERMISSIONS.DOCUMENT_WRITE),
    controller.approveVersion,
  );

  // Document-Task Linking
  router.post(
    '/:documentId/link-task',
    requirePermissions(PERMISSIONS.DOCUMENT_WRITE),
    controller.linkToTask,
  );

  router.delete(
    '/:documentId/unlink-task/:taskId',
    requirePermissions(PERMISSIONS.DOCUMENT_WRITE),
    controller.unlinkFromTask,
  );

  router.get(
    '/:documentId/tasks',
    requirePermissions(PERMISSIONS.DOCUMENT_READ),
    controller.getLinkedTasks,
  );

  return router;
};
