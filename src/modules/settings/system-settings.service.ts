import { PrismaClient } from '@prisma/client';
import { notFoundError, conflictError, validationError } from '../../common/errors';

type SystemSetting = {
  id: string;
  key: string;
  value: any;
  dataType: string;
  description: string | null;
  isPublic: boolean;
  category: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface CreateSettingDto {
  key: string;
  value: any;
  dataType: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  isPublic?: boolean;
  category?: string;
  updatedBy?: string;
}

export interface UpdateSettingDto {
  value?: any;
  description?: string;
  isPublic?: boolean;
  category?: string;
  updatedBy?: string;
}

export interface SettingFilter {
  category?: string;
  isPublic?: boolean;
  keys?: string[];
}

/**
 * Service for managing system-wide settings
 * Supports typed values (string, number, boolean, json) with caching
 */
export class SystemSettingsService {
  private cache: Map<string, SystemSetting> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache TTL

  constructor(private prisma: PrismaClient) {}

  /**
   * Get a setting value by key (with caching)
   */
  async getSetting(key: string, useCache: boolean = true): Promise<SystemSetting> {
    if (useCache && this.isCacheValid(key)) {
      return this.cache.get(key)!;
    }

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      throw notFoundError('NOT_FOUND', 'Setting not found', `Setting with key "${key}" not found`);
    }

    this.setCacheEntry(key, setting);
    return setting;
  }

  /**
   * Get a typed setting value
   */
  async getTypedValue<T = any>(key: string, useCache: boolean = true): Promise<T> {
    const setting = await this.getSetting(key, useCache);
    return this.parseValue(setting) as T;
  }

  /**
   * Get multiple settings by keys
   */
  async getSettings(keys: string[]): Promise<Record<string, any>> {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: keys },
      },
    });

    const result: Record<string, any> = {};
    settings.forEach((setting) => {
      result[setting.key] = this.parseValue(setting);
    });

    return result;
  }

  /**
   * List all settings with optional filters
   */
  async listSettings(filter?: SettingFilter): Promise<SystemSetting[]> {
    const where: any = {};

    if (filter?.category) {
      where.category = filter.category;
    }

    if (filter?.isPublic !== undefined) {
      where.isPublic = filter.isPublic;
    }

    if (filter?.keys && filter.keys.length > 0) {
      where.key = { in: filter.keys };
    }

    return await this.prisma.systemSetting.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  /**
   * Get all public settings (for frontend/API consumption)
   */
  async getPublicSettings(): Promise<SystemSetting[]> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { isPublic: true },
      orderBy: { key: 'asc' },
    });

    return settings;
  }

  /**
   * Get settings grouped by category
   */
  async getSettingsByCategory(): Promise<Record<string, SystemSetting[]>> {
    const settings = await this.prisma.systemSetting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    const result: Record<string, SystemSetting[]> = {};

    settings.forEach((setting) => {
      const category = setting.category || 'uncategorized';
      if (!result[category]) {
        result[category] = [];
      }
      result[category].push(setting);
    });

    return result;
  }

  /**
   * Create a new setting
   */
  async createSetting(dto: CreateSettingDto): Promise<SystemSetting> {
    // Check for duplicate key
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw conflictError(`Setting with key "${dto.key}" already exists`);
    }

    // Validate value matches dataType
    this.validateValueType(dto.value, dto.dataType);

    // Store value as JSON
    const jsonValue = this.encodeValue(dto.value, dto.dataType);

    const setting = await this.prisma.systemSetting.create({
      data: {
        key: dto.key,
        value: jsonValue,
        dataType: dto.dataType,
        description: dto.description,
        isPublic: dto.isPublic ?? false,
        category: dto.category,
        updatedBy: dto.updatedBy,
      },
    });

    this.invalidateCache(dto.key);
    return setting;
  }

  /**
   * Update a setting
   */
  async updateSetting(key: string, dto: UpdateSettingDto): Promise<SystemSetting> {
    const existing = await this.getSetting(key, false);

    const updateData: any = {};

    if (dto.value !== undefined) {
      // Validate value matches existing dataType
      this.validateValueType(dto.value, existing.dataType);
      updateData.value = this.encodeValue(dto.value, existing.dataType);
    }

    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    if (dto.isPublic !== undefined) {
      updateData.isPublic = dto.isPublic;
    }

    if (dto.category !== undefined) {
      updateData.category = dto.category;
    }

    if (dto.updatedBy !== undefined) {
      updateData.updatedBy = dto.updatedBy;
    }

    updateData.updatedAt = new Date();

    const setting = await this.prisma.systemSetting.update({
      where: { key },
      data: updateData,
    });

    this.invalidateCache(key);
    return setting;
  }

  /**
   * Delete a setting
   */
  async deleteSetting(key: string): Promise<void> {
    await this.getSetting(key, false); // Verify exists

    await this.prisma.systemSetting.delete({
      where: { key },
    });

    this.invalidateCache(key);
  }

  /**
   * Bulk update settings
   */
  async bulkUpdateSettings(
    updates: Array<{ key: string; value: any }>,
    updatedBy?: string,
  ): Promise<number> {
    let updatedCount = 0;

    for (const update of updates) {
      try {
        await this.updateSetting(update.key, {
          value: update.value,
          updatedBy,
        });
        updatedCount++;
      } catch (error) {
        // Continue on error, but track failures
        console.error(`Failed to update setting ${update.key}:`, error);
      }
    }

    return updatedCount;
  }

  /**
   * Clear all cached settings
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
  }

  /**
   * Invalidate cache for a specific key
   */
  private invalidateCache(key: string): void {
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
  }

  /**
   * Check if cache entry is valid
   */
  private isCacheValid(key: string): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    const expiry = this.cacheExpiry.get(key);
    if (!expiry || Date.now() > expiry) {
      this.invalidateCache(key);
      return false;
    }

    return true;
  }

  /**
   * Set cache entry with expiry
   */
  private setCacheEntry(key: string, setting: SystemSetting): void {
    this.cache.set(key, setting);
    this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL_MS);
  }

  /**
   * Parse stored JSON value to native type
   */
  parseValue(setting: SystemSetting): any {
    const value = setting.value;

    switch (setting.dataType) {
      case 'string':
        return typeof value === 'string' ? value : String(value);
      case 'number':
        return typeof value === 'number' ? value : Number(value);
      case 'boolean':
        return typeof value === 'boolean' ? value : Boolean(value);
      case 'json':
        return value; // Already parsed by Prisma
      default:
        return value;
    }
  }

  /**
   * Encode value to JSON for storage
   */
  private encodeValue(value: any, dataType: string): any {
    switch (dataType) {
      case 'string':
        return String(value);
      case 'number':
        return Number(value);
      case 'boolean':
        return Boolean(value);
      case 'json':
        return value; // Prisma will handle JSON encoding
      default:
        return value;
    }
  }

  /**
   * Validate that value matches expected data type
   */
  private validateValueType(value: any, dataType: string): void {
    switch (dataType) {
      case 'string':
        if (typeof value !== 'string') {
          throw validationError({
            detail: `Value must be a string, got ${typeof value}`,
            pointer: '/data/attributes/value',
          });
        }
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          throw validationError({
            detail: `Value must be a number, got ${typeof value}`,
            pointer: '/data/attributes/value',
          });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw validationError({
            detail: `Value must be a boolean, got ${typeof value}`,
            pointer: '/data/attributes/value',
          });
        }
        break;
      case 'json':
        // Any value is acceptable for JSON type
        break;
      default:
        throw validationError({
          detail: `Invalid data type: ${dataType}`,
          pointer: '/data/attributes/dataType',
        });
    }
  }
}
