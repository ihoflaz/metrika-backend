import { PrismaClient, ApiKey } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { notFoundError, conflictError, validationError } from '../../common/errors';

export interface CreateApiKeyDto {
  name: string;
  userId: string;
  scopes: string[];
  expiresInDays?: number;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  isExpired: boolean;
  isRevoked: boolean;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  reason?: string;
}

export class ApiKeyService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Generate a new API key for a user
   * Returns the plain key (only shown once) and the created API key record
   */
  async generateKey(dto: CreateApiKeyDto): Promise<{ plainKey: string; apiKey: ApiKey }> {
    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw notFoundError('User', dto.userId);
    }

    // Check for duplicate key name for this user
    const existingKey = await this.prisma.apiKey.findFirst({
      where: {
        userId: dto.userId,
        name: dto.name,
        revokedAt: null,
      },
    });

    if (existingKey) {
      throw conflictError(`API key with name "${dto.name}" already exists`);
    }

    // Generate random 32-byte key (256 bits)
    const plainKey = `mtk_${randomBytes(32).toString('base64url')}`;

    // Hash the key for storage (SHA-256)
    const keyHash = this.hashKey(plainKey);

    // Calculate expiration date
    const expiresInDays = dto.expiresInDays ?? 365; // Default 1 year
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create API key record
    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyHash,
        userId: dto.userId,
        scopes: dto.scopes,
        expiresAt,
      },
    });

    return { plainKey, apiKey };
  }

  /**
   * Validate an API key and return the associated record
   */
  async validateKey(plainKey: string): Promise<ApiKeyValidationResult> {
    if (!plainKey || !plainKey.startsWith('mtk_')) {
      return { valid: false, reason: 'Invalid key format' };
    }

    const keyHash = this.hashKey(plainKey);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
    });

    if (!apiKey) {
      return { valid: false, reason: 'Key not found' };
    }

    if (apiKey.revokedAt) {
      return { valid: false, reason: 'Key has been revoked' };
    }

    if (apiKey.expiresAt < new Date()) {
      return { valid: false, reason: 'Key has expired' };
    }

    if (apiKey.user.status !== 'ACTIVE') {
      return { valid: false, reason: 'User account is not active' };
    }

    // Update last used timestamp (fire and forget)
    this.updateLastUsed(apiKey.id).catch(() => {
      // Ignore errors - don't fail request if this update fails
    });

    return { valid: true, apiKey };
  }

  /**
   * List all API keys for a user
   */
  async listUserKeys(userId: string): Promise<ApiKeyListItem[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
      isExpired: key.expiresAt < now,
      isRevoked: key.revokedAt !== null,
    }));
  }

  /**
   * Get a specific API key by ID
   */
  async getKeyById(keyId: string, userId: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        id: keyId,
        userId,
      },
    });

    if (!apiKey) {
      throw notFoundError('NOT_FOUND', 'API key not found', `API key with ID ${keyId} not found`);
    }

    return apiKey;
  }

  /**
   * Revoke an API key
   */
  async revokeKey(keyId: string, userId: string): Promise<ApiKey> {
    const apiKey = await this.getKeyById(keyId, userId);

    if (apiKey.revokedAt) {
      throw validationError({
        detail: 'API key is already revoked',
        pointer: '/data/attributes/revokedAt',
      });
    }

    return await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Delete an API key permanently
   */
  async deleteKey(keyId: string, userId: string): Promise<void> {
    await this.getKeyById(keyId, userId); // Verify ownership

    await this.prisma.apiKey.delete({
      where: { id: keyId },
    });
  }

  /**
   * Update API key metadata (name, scopes, expiration)
   */
  async updateKey(
    keyId: string,
    userId: string,
    updates: {
      name?: string;
      scopes?: string[];
      expiresAt?: Date;
    },
  ): Promise<ApiKey> {
    await this.getKeyById(keyId, userId); // Verify ownership

    // If updating name, check for duplicates
    if (updates.name) {
      const existingKey = await this.prisma.apiKey.findFirst({
        where: {
          userId,
          name: updates.name,
          id: { not: keyId },
          revokedAt: null,
        },
      });

      if (existingKey) {
        throw conflictError(`API key with name "${updates.name}" already exists`);
      }
    }

    return await this.prisma.apiKey.update({
      where: { id: keyId },
      data: updates,
    });
  }

  /**
   * Clean up expired keys (admin function)
   */
  async cleanupExpiredKeys(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.apiKey.deleteMany({
      where: {
        expiresAt: {
          lt: cutoffDate,
        },
      },
    });

    return result.count;
  }

  /**
   * Hash an API key using SHA-256
   */
  private hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey).digest('hex');
  }

  /**
   * Update the last used timestamp for an API key
   */
  private async updateLastUsed(keyId: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  }
}
