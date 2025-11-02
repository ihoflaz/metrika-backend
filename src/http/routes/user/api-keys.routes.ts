import { Router } from 'express';
import { ApiKeysController } from '../../controllers/user/api-keys.controller';
import type { AppDependencies } from '../../../di/container';

export function createApiKeysRouter(deps: AppDependencies): Router {
  const router = Router();
  const controller = deps.apiKeysController;

  /**
   * @route   POST /api/v1/users/api-keys
   * @desc    Create a new API key
   * @access  Private (authentication middleware applied by parent router)
   */
  router.post('/', (req, res, next) => controller.createApiKey(req, res, next));

  /**
   * @route   GET /api/v1/users/api-keys
   * @desc    List user's API keys
   * @access  Private
   */
  router.get('/', (req, res, next) => controller.listApiKeys(req, res, next));

  /**
   * @route   GET /api/v1/users/api-keys/:id
   * @desc    Get API key details
   * @access  Private
   */
  router.get('/:id', (req, res, next) => controller.getApiKey(req, res, next));

  /**
   * @route   DELETE /api/v1/users/api-keys/:id
   * @desc    Revoke an API key
   * @access  Private
   */
  router.delete('/:id', (req, res, next) => controller.revokeApiKey(req, res, next));

  /**
   * @route   POST /api/v1/users/api-keys/:id/regenerate
   * @desc    Regenerate an API key (revoke old, create new)
   * @access  Private
   */
  router.post('/:id/regenerate', (req, res, next) => controller.regenerateApiKey(req, res, next));

  return router;
}
