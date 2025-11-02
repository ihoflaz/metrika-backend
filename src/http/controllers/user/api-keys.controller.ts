import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../../../modules/users/api-key.service';
import { badRequestError } from '../../../common/errors';
import type { Logger } from 'pino';

export class ApiKeysController {
  constructor(
    private apiKeyService: ApiKeyService,
    private logger: Logger
  ) {}

  /**
   * @route   POST /api/v1/users/api-keys
   * @desc    Create a new API key
   * @access  Private
   */
  async createApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = res.locals.authUser;
      if (!authUser) {
        throw badRequestError('UNAUTHORIZED', 'Unauthorized', 'User not authenticated');
      }

      const { name, scopes, expiresInDays } = req.body;

      // Validation
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw badRequestError(
          'INVALID_NAME',
          'Invalid API key name',
          'API key name must be a non-empty string'
        );
      }

      if (!Array.isArray(scopes) || scopes.length === 0) {
        throw badRequestError(
          'INVALID_SCOPES',
          'Invalid scopes',
          'At least one scope must be provided'
        );
      }

      if (expiresInDays !== undefined && (typeof expiresInDays !== 'number' || expiresInDays < 1)) {
        throw badRequestError(
          'INVALID_EXPIRATION',
          'Invalid expiration',
          'Expiration must be a positive number of days'
        );
      }

      // Create API key
      const apiKey = await this.apiKeyService.create({
        name: name.trim(),
        userId: authUser.id,
        scopes,
        expiresInDays,
      });

      this.logger.info(
        {
          userId: authUser.id,
          apiKeyId: apiKey.id,
          scopes,
        },
        'API key created'
      );

      res.status(201).json({
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          key: apiKey.key, // Plain text key - only shown once!
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
        },
        warning: 'Save this API key securely. It will not be shown again.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/v1/users/api-keys
   * @desc    List user's API keys
   * @access  Private
   */
  async listApiKeys(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = res.locals.authUser;
      if (!authUser) {
        throw badRequestError('UNAUTHORIZED', 'Unauthorized', 'User not authenticated');
      }

      const apiKeys = await this.apiKeyService.list(authUser.id);

      // Get statistics
      const stats = await this.apiKeyService.getStats(authUser.id);

      res.json({
        apiKeys: apiKeys.map((key) => ({
          id: key.id,
          name: key.name,
          scopes: key.scopes,
          expiresAt: key.expiresAt,
          lastUsedAt: key.lastUsedAt,
          createdAt: key.createdAt,
          // keyHash is never exposed
        })),
        stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/v1/users/api-keys/:id
   * @desc    Get API key details
   * @access  Private
   */
  async getApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = res.locals.authUser;
      if (!authUser) {
        throw badRequestError('UNAUTHORIZED', 'Unauthorized', 'User not authenticated');
      }

      const { id } = req.params;

      const apiKey = await this.apiKeyService.getById(id, authUser.id);

      res.json({
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt,
          lastUsedAt: apiKey.lastUsedAt,
          createdAt: apiKey.createdAt,
          revokedAt: apiKey.revokedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   DELETE /api/v1/users/api-keys/:id
   * @desc    Revoke an API key
   * @access  Private
   */
  async revokeApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = res.locals.authUser;
      if (!authUser) {
        throw badRequestError('UNAUTHORIZED', 'Unauthorized', 'User not authenticated');
      }

      const { id } = req.params;

      const apiKey = await this.apiKeyService.revoke(id, authUser.id);

      this.logger.info(
        {
          userId: authUser.id,
          apiKeyId: id,
        },
        'API key revoked'
      );

      res.json({
        message: 'API key revoked successfully',
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          revokedAt: apiKey.revokedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/v1/users/api-keys/:id/regenerate
   * @desc    Regenerate an API key (revoke old, create new)
   * @access  Private
   */
  async regenerateApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const authUser = res.locals.authUser;
      if (!authUser) {
        throw badRequestError('UNAUTHORIZED', 'Unauthorized', 'User not authenticated');
      }

      const { id } = req.params;

      const newApiKey = await this.apiKeyService.regenerate(id, authUser.id);

      this.logger.info(
        {
          userId: authUser.id,
          oldKeyId: id,
          newKeyId: newApiKey.id,
        },
        'API key regenerated'
      );

      res.json({
        apiKey: {
          id: newApiKey.id,
          name: newApiKey.name,
          key: newApiKey.key, // Plain text key - only shown once!
          scopes: newApiKey.scopes,
          expiresAt: newApiKey.expiresAt,
          createdAt: newApiKey.createdAt,
        },
        warning: 'Save this API key securely. It will not be shown again.',
      });
    } catch (error) {
      next(error);
    }
  }
}
