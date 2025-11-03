import { PrismaClient } from '@prisma/client';
import { notFoundError } from '../../common/errors';

type UserPreference = {
  id: string;
  userId: string;
  key: string;
  value: any;
  createdAt: Date;
  updatedAt: Date;
};

export interface SetPreferenceDto {
  userId: string;
  key: string;
  value: any;
}

export interface UserPreferencesMap {
  [key: string]: any;
}

/**
 * Common preference keys
 */
export const PREFERENCE_KEYS = {
  // Notification preferences
  NOTIFICATIONS_EMAIL_ENABLED: 'notifications.email.enabled',
  NOTIFICATIONS_TASK_ASSIGNED: 'notifications.task.assigned',
  NOTIFICATIONS_TASK_COMPLETED: 'notifications.task.completed',
  NOTIFICATIONS_TASK_DELAYED: 'notifications.task.delayed',
  NOTIFICATIONS_KPI_BREACH: 'notifications.kpi.breach',
  NOTIFICATIONS_DOCUMENT_APPROVAL: 'notifications.document.approval',
  
  // UI preferences
  UI_THEME: 'ui.theme', // 'light', 'dark', 'auto'
  UI_LANGUAGE: 'ui.language', // 'en', 'tr', etc.
  UI_TIMEZONE: 'ui.timezone', // 'UTC', 'Europe/Istanbul', etc.
  UI_DATE_FORMAT: 'ui.dateFormat', // 'DD/MM/YYYY', 'MM/DD/YYYY', etc.
  UI_TABLE_PAGE_SIZE: 'ui.table.pageSize', // 10, 25, 50, 100
  UI_SIDEBAR_COLLAPSED: 'ui.sidebar.collapsed', // true/false
  UI_KANBAN_COMPACT_MODE: 'ui.kanban.compactMode', // true/false
  
  // Dashboard preferences
  DASHBOARD_WIDGETS: 'dashboard.widgets', // JSON array of widget configs
  DASHBOARD_LAYOUT: 'dashboard.layout', // JSON layout configuration
  
  // Work preferences
  WORK_DEFAULT_PROJECT_VIEW: 'work.defaultProjectView', // 'list', 'kanban', 'calendar'
  WORK_DEFAULT_TASK_FILTER: 'work.defaultTaskFilter', // JSON filter config
  WORK_WORKING_HOURS_START: 'work.workingHours.start', // '09:00'
  WORK_WORKING_HOURS_END: 'work.workingHours.end', // '18:00'
} as const;

/**
 * Default preference values
 */
export const DEFAULT_PREFERENCES: UserPreferencesMap = {
  [PREFERENCE_KEYS.NOTIFICATIONS_EMAIL_ENABLED]: true,
  [PREFERENCE_KEYS.NOTIFICATIONS_TASK_ASSIGNED]: true,
  [PREFERENCE_KEYS.NOTIFICATIONS_TASK_COMPLETED]: true,
  [PREFERENCE_KEYS.NOTIFICATIONS_TASK_DELAYED]: true,
  [PREFERENCE_KEYS.NOTIFICATIONS_KPI_BREACH]: true,
  [PREFERENCE_KEYS.NOTIFICATIONS_DOCUMENT_APPROVAL]: true,
  
  [PREFERENCE_KEYS.UI_THEME]: 'auto',
  [PREFERENCE_KEYS.UI_LANGUAGE]: 'en',
  [PREFERENCE_KEYS.UI_TIMEZONE]: 'UTC',
  [PREFERENCE_KEYS.UI_DATE_FORMAT]: 'YYYY-MM-DD',
  [PREFERENCE_KEYS.UI_TABLE_PAGE_SIZE]: 25,
  [PREFERENCE_KEYS.UI_SIDEBAR_COLLAPSED]: false,
  [PREFERENCE_KEYS.UI_KANBAN_COMPACT_MODE]: false,
  
  [PREFERENCE_KEYS.WORK_DEFAULT_PROJECT_VIEW]: 'list',
  [PREFERENCE_KEYS.WORK_WORKING_HOURS_START]: '09:00',
  [PREFERENCE_KEYS.WORK_WORKING_HOURS_END]: '18:00',
};

/**
 * Service for managing user-specific preferences
 */
export class UserPreferencesService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get a specific preference value for a user
   */
  async getPreference(userId: string, key: string): Promise<any> {
    const preference = await this.prisma.userPreference.findUnique({
      where: {
        userId_key: {
          userId,
          key,
        },
      },
    });

    if (!preference) {
      // Return default value if not set
      return DEFAULT_PREFERENCES[key] ?? null;
    }

    return preference.value;
  }

  /**
   * Get multiple preferences for a user
   */
  async getPreferences(userId: string, keys?: string[]): Promise<UserPreferencesMap> {
    const where: any = { userId };

    if (keys && keys.length > 0) {
      where.key = { in: keys };
    }

    const preferences = await this.prisma.userPreference.findMany({
      where,
    });

    const result: UserPreferencesMap = {};

    // Add default values for requested keys
    if (keys) {
      keys.forEach((key) => {
        result[key] = DEFAULT_PREFERENCES[key] ?? null;
      });
    }

    // Override with user-specific values
    preferences.forEach((pref) => {
      result[pref.key] = pref.value;
    });

    return result;
  }

  /**
   * Get all preferences for a user (including defaults)
   */
  async getAllPreferences(userId: string): Promise<UserPreferencesMap> {
    const preferences = await this.prisma.userPreference.findMany({
      where: { userId },
    });

    // Start with all default preferences
    const result: UserPreferencesMap = { ...DEFAULT_PREFERENCES };

    // Override with user-specific values
    preferences.forEach((pref) => {
      result[pref.key] = pref.value;
    });

    return result;
  }

  /**
   * Set a preference value for a user
   */
  async setPreference(dto: SetPreferenceDto): Promise<UserPreference> {
    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw notFoundError('User', dto.userId);
    }

    return await this.prisma.userPreference.upsert({
      where: {
        userId_key: {
          userId: dto.userId,
          key: dto.key,
        },
      },
      update: {
        value: dto.value,
        updatedAt: new Date(),
      },
      create: {
        userId: dto.userId,
        key: dto.key,
        value: dto.value,
      },
    });
  }

  /**
   * Set multiple preferences at once
   */
  async setPreferences(
    userId: string,
    preferences: Record<string, any>,
  ): Promise<UserPreference[]> {
    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw notFoundError('User', userId);
    }

    const results: UserPreference[] = [];

    for (const [key, value] of Object.entries(preferences)) {
      const pref = await this.setPreference({
        userId,
        key,
        value,
      });
      results.push(pref);
    }

    return results;
  }

  /**
   * Delete a specific preference (revert to default)
   */
  async deletePreference(userId: string, key: string): Promise<void> {
    await this.prisma.userPreference.deleteMany({
      where: {
        userId,
        key,
      },
    });
  }

  /**
   * Delete all preferences for a user
   */
  async deleteAllPreferences(userId: string): Promise<number> {
    const result = await this.prisma.userPreference.deleteMany({
      where: { userId },
    });

    return result.count;
  }

  /**
   * Get notification preferences specifically
   */
  async getNotificationPreferences(userId: string): Promise<{
    emailEnabled: boolean;
    taskAssigned: boolean;
    taskCompleted: boolean;
    taskDelayed: boolean;
    kpiBreach: boolean;
    documentApproval: boolean;
  }> {
    const prefs = await this.getPreferences(userId, [
      PREFERENCE_KEYS.NOTIFICATIONS_EMAIL_ENABLED,
      PREFERENCE_KEYS.NOTIFICATIONS_TASK_ASSIGNED,
      PREFERENCE_KEYS.NOTIFICATIONS_TASK_COMPLETED,
      PREFERENCE_KEYS.NOTIFICATIONS_TASK_DELAYED,
      PREFERENCE_KEYS.NOTIFICATIONS_KPI_BREACH,
      PREFERENCE_KEYS.NOTIFICATIONS_DOCUMENT_APPROVAL,
    ]);

    return {
      emailEnabled: prefs[PREFERENCE_KEYS.NOTIFICATIONS_EMAIL_ENABLED] ?? true,
      taskAssigned: prefs[PREFERENCE_KEYS.NOTIFICATIONS_TASK_ASSIGNED] ?? true,
      taskCompleted: prefs[PREFERENCE_KEYS.NOTIFICATIONS_TASK_COMPLETED] ?? true,
      taskDelayed: prefs[PREFERENCE_KEYS.NOTIFICATIONS_TASK_DELAYED] ?? true,
      kpiBreach: prefs[PREFERENCE_KEYS.NOTIFICATIONS_KPI_BREACH] ?? true,
      documentApproval: prefs[PREFERENCE_KEYS.NOTIFICATIONS_DOCUMENT_APPROVAL] ?? true,
    };
  }

  /**
   * Get UI preferences specifically
   */
  async getUIPreferences(userId: string): Promise<{
    theme: string;
    language: string;
    timezone: string;
    dateFormat: string;
    tablePageSize: number;
    sidebarCollapsed: boolean;
    kanbanCompactMode: boolean;
  }> {
    const prefs = await this.getPreferences(userId, [
      PREFERENCE_KEYS.UI_THEME,
      PREFERENCE_KEYS.UI_LANGUAGE,
      PREFERENCE_KEYS.UI_TIMEZONE,
      PREFERENCE_KEYS.UI_DATE_FORMAT,
      PREFERENCE_KEYS.UI_TABLE_PAGE_SIZE,
      PREFERENCE_KEYS.UI_SIDEBAR_COLLAPSED,
      PREFERENCE_KEYS.UI_KANBAN_COMPACT_MODE,
    ]);

    return {
      theme: prefs[PREFERENCE_KEYS.UI_THEME] ?? 'auto',
      language: prefs[PREFERENCE_KEYS.UI_LANGUAGE] ?? 'en',
      timezone: prefs[PREFERENCE_KEYS.UI_TIMEZONE] ?? 'UTC',
      dateFormat: prefs[PREFERENCE_KEYS.UI_DATE_FORMAT] ?? 'YYYY-MM-DD',
      tablePageSize: prefs[PREFERENCE_KEYS.UI_TABLE_PAGE_SIZE] ?? 25,
      sidebarCollapsed: prefs[PREFERENCE_KEYS.UI_SIDEBAR_COLLAPSED] ?? false,
      kanbanCompactMode: prefs[PREFERENCE_KEYS.UI_KANBAN_COMPACT_MODE] ?? false,
    };
  }

  /**
   * Export all preferences for a user (for data portability)
   */
  async exportPreferences(userId: string): Promise<{
    userId: string;
    exportedAt: string;
    preferences: UserPreferencesMap;
  }> {
    const preferences = await this.getAllPreferences(userId);

    return {
      userId,
      exportedAt: new Date().toISOString(),
      preferences,
    };
  }

  /**
   * Import preferences for a user (bulk restore)
   */
  async importPreferences(
    userId: string,
    preferences: Record<string, any>,
  ): Promise<number> {
    let importedCount = 0;

    for (const [key, value] of Object.entries(preferences)) {
      try {
        await this.setPreference({ userId, key, value });
        importedCount++;
      } catch (error) {
        console.error(`Failed to import preference ${key}:`, error);
      }
    }

    return importedCount;
  }
}
