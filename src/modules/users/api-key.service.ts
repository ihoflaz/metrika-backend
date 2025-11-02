import { randomBytes, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { notFoundError, badRequestError } from '../../common/errors';

/**
 * API Key creation data
 */
export interface CreateApiKeyDto {
  name: string;
  userId: string;
  scopes: string[];
  expiresInDays?: number; // Default: 365 days
}

/**
 * API Key type (simplified from Prisma)
 */
export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

/**
 * API Key with plain text key (only returned on creation)
 */
export interface ApiKeyWithPlainKey extends Omit<ApiKey, 'keyHash'> {
  key: string; // Plain text API key (only shown once)
}

/**
 * API Key validation result
 */
export interface ApiKeyValidation {
  valid: boolean;
  apiKey?: any; // Will include user relation
  error?: string;
}

/**
 * API Key Service
 * Handles CRUD operations for API keys with security best practices
 */
export class ApiKeyService {
  constructor(private prisma: PrismaClient) {}
  /**
   * Generate a secure random API key
   */
  private generateApiKey(): string {
    // Format: mk_live_<32 random hex chars>
    // mk = Metrika, live = environment
    const randomPart = randomBytes(24).toString('hex'); // 48 chars
    return `mk_live_${randomPart}`;
  }

  /**
   * Hash an API key for storage
   */
  private hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Create a new API key
   * Returns the plain text key only once - must be saved by user
   */
  async create(data: CreateApiKeyDto): Promise<ApiKeyWithPlainKey> {
    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw notFoundError('USER_NOT_FOUND', 'User not found', `User with ID ${data.userId} does not exist`);
    }

    // Generate API key and hash
    const plainKey = this.generateApiKey();
    const keyHash = this.hashApiKey(plainKey);

    // Calculate expiration date
    const expiresInDays = data.expiresInDays || 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create API key
    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: data.name,
        keyHash,
        userId: data.userId,
        scopes: data.scopes,
        expiresAt,
      },
    });

    // Return API key with plain text key (only time it's shown)
    return {
      ...apiKey,
      key: plainKey,
    };
  }

  /**
   * List user's API keys
   */
  async list(userId: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: {
        userId,
        revokedAt: null, // Only active keys
      },
      orderBy: {
        createdAt: 'desc',
      },
    }) as Promise<ApiKey[]>;
  }

  /**
   * Get API key by ID
   */
  async getById(id: string, userId: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!apiKey) {
      throw notFoundError('API_KEY_NOT_FOUND', 'API key not found', `API key with ID ${id} does not exist or does not belong to user`);
    }

    return apiKey;
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string, userId: string): Promise<ApiKey> {
    // Check ownership
    const apiKey = await this.getById(id, userId);

    if (apiKey.revokedAt) {
      throw badRequestError('API_KEY_ALREADY_REVOKED', 'API key already revoked', 'This API key has already been revoked');
    }

    // Revoke key
    return this.prisma.apiKey.update({
      where: { id },
      data: {
        revokedAt: new Date(),
      },
    }) as Promise<ApiKey>;
  }

  /**
   * Validate an API key
   */
  async validate(plainKey: string): Promise<ApiKeyValidation> {
    // Hash the provided key
    const keyHash = this.hashApiKey(plainKey);

    // Find API key
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

    // Key not found
    if (!apiKey) {
      return {
        valid: false,
        error: 'Invalid API key',
      };
    }

    // Key revoked
    if (apiKey.revokedAt) {
      return {
        valid: false,
        error: 'API key has been revoked',
      };
    }

    // Key expired
    if (apiKey.expiresAt < new Date()) {
      return {
        valid: false,
        error: 'API key has expired',
      };
    }

    // User inactive
    if (apiKey.user.status !== 'ACTIVE') {
      return {
        valid: false,
        error: 'User account is not active',
      };
    }

    // Update last used timestamp
    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        lastUsedAt: new Date(),
      },
    });

    return {
      valid: true,
      apiKey,
    };
  }

  /**
   * Check if API key has required scope
   */
  hasScope(apiKey: ApiKey, requiredScope: string): boolean {
    // Wildcard scope grants all permissions
    if (apiKey.scopes.includes('*')) {
      return true;
    }

    // Check exact scope match
    if (apiKey.scopes.includes(requiredScope)) {
      return true;
    }

    // Check wildcard patterns (e.g., "tasks:*" matches "tasks:read")
    return apiKey.scopes.some((scope: string) => {
      if (scope.endsWith(':*')) {
        const prefix = scope.slice(0, -2);
        return requiredScope.startsWith(prefix);
      }
      return false;
    });
  }

  /**
   * Regenerate an API key (revoke old, create new with same settings)
   */
  async regenerate(id: string, userId: string): Promise<ApiKeyWithPlainKey> {
    // Get existing key
    const oldKey = await this.getById(id, userId);

    // Revoke old key
    await this.revoke(id, userId);

    // Calculate remaining days until expiration
    const now = new Date();
    const daysRemaining = Math.ceil(
      (oldKey.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Create new key with same settings
    return this.create({
      name: oldKey.name,
      userId: oldKey.userId,
      scopes: oldKey.scopes,
      expiresInDays: daysRemaining > 0 ? daysRemaining : 365,
    });
  }

  /**
   * Delete expired API keys (cleanup job)
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.prisma.apiKey.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return result.count;
  }

  /**
   * Get API key statistics for a user
   */
  async getStats(userId: string): Promise<{
    total: number;
    active: number;
    expired: number;
    revoked: number;
  }> {
    const now = new Date();

    const [total, active, expired, revoked] = await Promise.all([
      this.prisma.apiKey.count({ where: { userId } }),
      this.prisma.apiKey.count({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      }),
      this.prisma.apiKey.count({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { lte: now },
        },
      }),
      this.prisma.apiKey.count({
        where: {
          userId,
          revokedAt: { not: null },
        },
      }),
    ]);

    return { total, active, expired, revoked };
  }
}
