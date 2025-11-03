import { Router, RequestHandler } from 'express';
import { SystemSettingsController } from '../../../http/controllers/settings/system-settings.controller';

export function createSystemSettingsRoutes(
  controller: SystemSettingsController,
  authMiddleware: RequestHandler,
): Router {
  const router = Router();

  // Public endpoint - no auth required
  router.get('/public', controller.getPublicSettings);

  // All other routes require authentication
  router.use(authMiddleware);

  // List all settings (admin only - permission check in middleware)
  router.get('/', controller.listSettings);

  // Get settings by category
  router.get('/by-category', controller.getByCategory);

  // Clear cache (admin only)
  router.post('/clear-cache', controller.clearCache);

  // Bulk update (admin only)
  router.post('/bulk-update', controller.bulkUpdate);

  // Get specific setting
  router.get('/:key', controller.getSetting);

  // Create new setting (admin only)
  router.post('/', controller.createSetting);

  // Update setting (admin only)
  router.patch('/:key', controller.updateSetting);

  // Delete setting (admin only)
  router.delete('/:key', controller.deleteSetting);

  return router;
}
