import { Request, Response } from 'express';
import { z } from 'zod';
import { SystemSettingsService } from '../../../modules/settings/system-settings.service';
import { validationError } from '../../../common/errors';

const createSettingSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.any(),
  dataType: z.enum(['string', 'number', 'boolean', 'json']),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  category: z.string().max(100).optional(),
});

const updateSettingSchema = z.object({
  value: z.any().optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  category: z.string().max(100).optional(),
});

export class SystemSettingsController {
  constructor(private settingsService: SystemSettingsService) {}

  /**
   * Helper method to format a setting for JSON:API response
   */
  private formatSetting(setting: any) {
    return {
      type: 'system-setting',
      id: setting.id,
      attributes: {
        key: setting.key,
        value: this.settingsService.parseValue(setting),
        dataType: setting.dataType,
        description: setting.description,
        isPublic: setting.isPublic,
        category: setting.category,
        updatedAt: setting.updatedAt.toISOString(),
      },
    };
  }

  /**
   * GET /api/v1/settings
   * List all settings (admin only)
   */
  listSettings = async (req: Request, res: Response): Promise<void> => {
    const { category, isPublic, keys } = req.query;

    const filter: any = {};
    if (category) filter.category = String(category);
    if (isPublic !== undefined) filter.isPublic = isPublic === 'true';
    if (keys) {
      filter.keys = Array.isArray(keys) ? keys.map(String) : [String(keys)];
    }

    const settings = await this.settingsService.listSettings(filter);

    res.status(200).json({
      data: settings.map((setting) => this.formatSetting(setting)),
      meta: {
        total: settings.length,
      },
    });
  };

  /**
   * GET /api/v1/settings/public
   * Get all public settings (no auth required)
   */
  getPublicSettings = async (req: Request, res: Response): Promise<void> => {
    const settings = await this.settingsService.getPublicSettings();

    res.status(200).json({
      data: settings.map((setting) => this.formatSetting(setting)),
    });
  };

  /**
   * GET /api/v1/settings/by-category
   * Get settings grouped by category (admin only)
   */
  getByCategory = async (req: Request, res: Response): Promise<void> => {
    const categoryMap = await this.settingsService.getSettingsByCategory();

    // Transform to JSON:API format with array per category
    const data: Record<string, any[]> = {};
    for (const [category, settings] of Object.entries(categoryMap)) {
      data[category] = settings.map((setting) => this.formatSetting(setting));
    }

    res.status(200).json({ data });
  };

  /**
   * GET /api/v1/settings/:key
   * Get a specific setting
   */
  getSetting = async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;
    const useCache = req.query.useCache !== 'false';

    const setting = await this.settingsService.getSetting(key, useCache);

    res.status(200).json({
      data: {
        ...this.formatSetting(setting),
        attributes: {
          ...this.formatSetting(setting).attributes,
          createdAt: setting.createdAt.toISOString(),
        },
      },
    });
  };

  /**
   * POST /api/v1/settings
   * Create a new setting (admin only)
   */
  createSetting = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };

    const validation = createSettingSchema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const setting = await this.settingsService.createSetting({
      ...validation.data,
      updatedBy: authUser.id,
    });

    res.status(201).json({
      data: {
        ...this.formatSetting(setting),
        attributes: {
          ...this.formatSetting(setting).attributes,
          createdAt: setting.createdAt.toISOString(),
        },
      },
    });
  };

  /**
   * PATCH /api/v1/settings/:key
   * Update a setting (admin only)
   */
  updateSetting = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const { key } = req.params;

    const validation = updateSettingSchema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const setting = await this.settingsService.updateSetting(key, {
      ...validation.data,
      updatedBy: authUser.id,
    });

    res.status(200).json({
      data: this.formatSetting(setting),
    });
  };

  /**
   * DELETE /api/v1/settings/:key
   * Delete a setting (admin only)
   */
  deleteSetting = async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;

    await this.settingsService.deleteSetting(key);

    res.status(200).json({
      meta: {
        message: `Setting "${key}" deleted successfully`,
      },
    });
  };

  /**
   * POST /api/v1/settings/bulk-update
   * Bulk update settings (admin only)
   */
  bulkUpdate = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };

    const schema = z.object({
      updates: z.array(
        z.object({
          key: z.string(),
          value: z.any(),
        }),
      ),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const updatedCount = await this.settingsService.bulkUpdateSettings(
      validation.data.updates,
      authUser.id,
    );

    // Fetch all updated settings
    const updatedSettings = await Promise.all(
      validation.data.updates.map((update) =>
        this.settingsService.getSetting(update.key, false).catch(() => null),
      ),
    );

    res.status(200).json({
      data: updatedSettings.filter((s) => s !== null).map((setting) => this.formatSetting(setting!)),
      meta: {
        updated: updatedCount,
        totalRequested: validation.data.updates.length,
      },
    });
  };

  /**
   * POST /api/v1/settings/clear-cache
   * Clear the settings cache (admin only)
   */
  clearCache = async (req: Request, res: Response): Promise<void> => {
    this.settingsService.clearCache();

    res.status(200).json({
      meta: {
        message: 'Settings cache cleared successfully',
      },
    });
  };
}
