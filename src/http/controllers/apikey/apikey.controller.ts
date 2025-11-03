import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiKeyService } from '../../../modules/apikeys/apikey.service';
import { validationError } from '../../../common/errors';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).min(1),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.string()).min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

export class ApiKeyController {
  constructor(private apiKeyService: ApiKeyService) {}

  /**
   * POST /api/v1/api-keys
   * Generate a new API key
   */
  generateKey = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const validation = createApiKeySchema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const { name, scopes, expiresInDays } = validation.data;

    const { plainKey, apiKey } = await this.apiKeyService.generateKey({
      name,
      userId,
      scopes,
      expiresInDays,
    });

    res.status(201).json({
      data: {
        type: 'api-key',
        id: apiKey.id,
        attributes: {
          name: apiKey.name,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt.toISOString(),
          createdAt: apiKey.createdAt.toISOString(),
        },
      },
      meta: {
        plainKey, // Only returned once on creation
        warning: 'Store this key securely. It will not be shown again.',
      },
    });
  };

  /**
   * GET /api/v1/api-keys
   * List all API keys for the authenticated user
   */
  listKeys = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const keys = await this.apiKeyService.listUserKeys(userId);

    res.status(200).json({
      data: keys.map((key: any) => ({
        type: 'api-key',
        id: key.id,
        attributes: {
          name: key.name,
          scopes: key.scopes,
          expiresAt: key.expiresAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          createdAt: key.createdAt.toISOString(),
        },
        meta: {
          isExpired: key.isExpired,
          isRevoked: key.isRevoked,
        },
      })),
      meta: {
        total: keys.length,
      },
    });
  };

  /**
   * GET /api/v1/api-keys/:keyId
   * Get a specific API key
   */
  getKey = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { keyId } = req.params;

    const apiKey = await this.apiKeyService.getKeyById(keyId, userId);

    const now = new Date();
    const isExpired = apiKey.expiresAt < now;
    const isRevoked = apiKey.revokedAt !== null;

    res.status(200).json({
      data: {
        type: 'api-key',
        id: apiKey.id,
        attributes: {
          name: apiKey.name,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt.toISOString(),
          lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
          createdAt: apiKey.createdAt.toISOString(),
          updatedAt: apiKey.updatedAt.toISOString(),
          revokedAt: apiKey.revokedAt?.toISOString() ?? null,
          isExpired,
          isRevoked,
        },
      },
    });
  };

  /**
   * PATCH /api/v1/api-keys/:keyId
   * Update an API key
   */
  updateKey = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { keyId } = req.params;

    const validation = updateApiKeySchema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const updates: any = {};
    if (validation.data.name) updates.name = validation.data.name;
    if (validation.data.scopes) updates.scopes = validation.data.scopes;
    if (validation.data.expiresAt) updates.expiresAt = new Date(validation.data.expiresAt);

    const apiKey = await this.apiKeyService.updateKey(keyId, userId, updates);

    res.status(200).json({
      data: {
        type: 'api-key',
        id: apiKey.id,
        attributes: {
          name: apiKey.name,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt.toISOString(),
          updatedAt: apiKey.updatedAt.toISOString(),
        },
      },
    });
  };

  /**
   * POST /api/v1/api-keys/:keyId/revoke
   * Revoke an API key
   */
  revokeKey = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { keyId } = req.params;

    const apiKey = await this.apiKeyService.revokeKey(keyId, userId);

    res.status(200).json({
      data: {
        type: 'api-key',
        id: apiKey.id,
        attributes: {
          name: apiKey.name,
          revokedAt: apiKey.revokedAt?.toISOString() ?? null,
        },
      },
      meta: {
        message: 'API key revoked successfully',
      },
    });
  };

  /**
   * DELETE /api/v1/api-keys/:keyId
   * Delete an API key permanently
   */
  deleteKey = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { keyId } = req.params;

    await this.apiKeyService.deleteKey(keyId, userId);

    res.status(200).json({
      meta: {
        message: 'API key deleted successfully',
      },
    });
  };
}
