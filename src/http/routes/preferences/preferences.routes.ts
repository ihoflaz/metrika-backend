import { Router, RequestHandler } from 'express';
import { UserPreferencesController } from '../../../http/controllers/preferences/user-preferences.controller';

export function createUserPreferencesRoutes(
  controller: UserPreferencesController,
  authMiddleware: RequestHandler,
): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);

  // Get notification preferences
  router.get('/notifications', controller.getNotificationPreferences);

  // Get UI preferences
  router.get('/ui', controller.getUIPreferences);

  // Export preferences
  router.get('/export', controller.exportPreferences);

  // Import preferences
  router.post('/import', controller.importPreferences);

  // Bulk set preferences
  router.post('/bulk', controller.bulkSetPreferences);

  // Get all preferences or filtered by keys
  router.get('/', controller.getAllPreferences);

  // Delete all preferences
  router.delete('/', controller.deleteAllPreferences);

  // Get specific preference
  router.get('/:key', controller.getPreference);

  // Set specific preference
  router.put('/:key', controller.setPreference);

  // Delete specific preference
  router.delete('/:key', controller.deletePreference);

  return router;
}
