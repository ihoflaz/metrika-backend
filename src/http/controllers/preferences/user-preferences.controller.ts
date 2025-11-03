import { Request, Response } from 'express';
import { z } from 'zod';
import { UserPreferencesService } from '../../../modules/preferences/user-preferences.service';
import { validationError } from '../../../common/errors';

const setPreferenceSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.any(),
});

const bulkSetSchema = z.object({
  preferences: z.record(z.string(), z.any()),
});

export class UserPreferencesController {
  constructor(private preferencesService: UserPreferencesService) {}

  /**
   * GET /api/v1/user/preferences
   * Get all preferences for the authenticated user
   */
  getAllPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const { keys } = req.query;
    let preferences;

    if (keys) {
      const keyArray = Array.isArray(keys) ? keys.map(String) : [String(keys)];
      preferences = await this.preferencesService.getPreferences(userId, keyArray);
    } else {
      preferences = await this.preferencesService.getAllPreferences(userId);
    }

    res.status(200).json({
      data: {
        type: 'user-preferences',
        id: userId,
        attributes: preferences,
      },
    });
  };

  /**
   * GET /api/v1/user/preferences/:key
   * Get a specific preference
   */
  getPreference = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { key } = req.params;

    const value = await this.preferencesService.getPreference(userId, key);

    res.status(200).json({
      data: {
        type: 'user-preference',
        id: key,
        attributes: {
          key,
          value,
        },
      },
    });
  };

  /**
   * PUT /api/v1/user/preferences/:key
   * Set a specific preference
   */
  setPreference = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { key } = req.params;

    // Check if 'value' key exists in request body
    if (!('value' in req.body)) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: [{ path: ['value'], message: 'Value is required' }] },
      });
    }

    const validation = z.object({ value: z.any() }).safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const preference = await this.preferencesService.setPreference({
      userId,
      key,
      value: validation.data.value,
    });

    res.status(200).json({
      data: {
        type: 'user-preference',
        id: preference.id,
        attributes: {
          key: preference.key,
          value: preference.value,
          updatedAt: preference.updatedAt.toISOString(),
        },
      },
    });
  };

  /**
   * POST /api/v1/user/preferences/bulk
   * Set multiple preferences at once
   */
  bulkSetPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const validation = bulkSetSchema.safeParse(req.body);
    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const preferences = await this.preferencesService.setPreferences(
      userId,
      validation.data.preferences,
    );

    res.status(200).json({
      data: {
        type: 'bulk-preferences-result',
        attributes: {
          updatedCount: preferences.length,
        },
      },
    });
  };

  /**
   * DELETE /api/v1/user/preferences/:key
   * Delete a preference (revert to default)
   */
  deletePreference = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;
    const { key } = req.params;

    await this.preferencesService.deletePreference(userId, key);

    res.status(204).send();
  };

  /**
   * DELETE /api/v1/user/preferences
   * Delete all preferences for the user
   */
  deleteAllPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const deletedCount = await this.preferencesService.deleteAllPreferences(userId);

    res.status(200).json({
      data: {
        type: 'delete-result',
        attributes: {
          deletedCount,
        },
      },
    });
  };

  /**
   * GET /api/v1/user/preferences/notifications
   * Get notification preferences
   */
  getNotificationPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const preferences = await this.preferencesService.getNotificationPreferences(userId);

    res.status(200).json({
      data: {
        type: 'notification-preferences',
        id: userId,
        attributes: preferences,
      },
    });
  };

  /**
   * GET /api/v1/user/preferences/ui
   * Get UI preferences
   */
  getUIPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const preferences = await this.preferencesService.getUIPreferences(userId);

    res.status(200).json({
      data: {
        type: 'ui-preferences',
        id: userId,
        attributes: preferences,
      },
    });
  };

  /**
   * GET /api/v1/user/preferences/export
   * Export all preferences for data portability
   */
  exportPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const exportData = await this.preferencesService.exportPreferences(userId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="preferences-${userId}-${Date.now()}.json"`,
    );
    res.status(200).json(exportData);
  };

  /**
   * POST /api/v1/user/preferences/import
   * Import preferences (bulk restore)
   */
  importPreferences = async (req: Request, res: Response): Promise<void> => {
    const { authUser } = res.locals as { authUser: { id: string } };
    const userId = authUser.id;

    const validation = z
      .object({
        preferences: z.record(z.string(), z.any()),
      })
      .safeParse(req.body);

    if (!validation.success) {
      throw validationError({
        detail: 'Validation failed',
        pointer: '/data/attributes',
        meta: { errors: validation.error.issues },
      });
    }

    const importedCount = await this.preferencesService.importPreferences(
      userId,
      validation.data.preferences,
    );

    res.status(200).json({
      data: {
        type: 'import-result',
        attributes: {
          importedCount,
          totalProvided: Object.keys(validation.data.preferences).length,
        },
      },
    });
  };
}
