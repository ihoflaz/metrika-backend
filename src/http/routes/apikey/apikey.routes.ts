import { Router } from 'express';
import { ApiKeyController } from '../../../http/controllers/apikey/apikey.controller';

export function createApiKeyRoutes(apiKeyController: ApiKeyController): Router {
  const router = Router();

  // All routes require authentication (applied in app.ts mount)

  // Generate new API key
  router.post('/', apiKeyController.generateKey);

  // List user's API keys
  router.get('/', apiKeyController.listKeys);

  // Get specific API key
  router.get('/:keyId', apiKeyController.getKey);

  // Update API key
  router.patch('/:keyId', apiKeyController.updateKey);

  // Revoke API key
  router.post('/:keyId/revoke', apiKeyController.revokeKey);

  // Delete API key
  router.delete('/:keyId', apiKeyController.deleteKey);

  return router;
}
