-- Add SystemSetting table for system-wide configuration
CREATE TABLE "SystemSetting" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" VARCHAR(255) NOT NULL UNIQUE,
  "value" JSONB NOT NULL,
  "dataType" VARCHAR(50) NOT NULL DEFAULT 'string',
  "description" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "category" VARCHAR(100),
  "updatedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "fk_system_setting_updated_by" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX "idx_system_setting_key" ON "SystemSetting"("key");
CREATE INDEX "idx_system_setting_category" ON "SystemSetting"("category");
CREATE INDEX "idx_system_setting_updated_by" ON "SystemSetting"("updatedBy");

-- Add UserPreference table for per-user preferences
CREATE TABLE "UserPreference" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "key" VARCHAR(255) NOT NULL,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "fk_user_preference_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "uq_user_preference_user_key" UNIQUE ("userId", "key")
);

CREATE INDEX "idx_user_preference_user_id" ON "UserPreference"("userId");
CREATE INDEX "idx_user_preference_key" ON "UserPreference"("key");

-- Insert default system settings
INSERT INTO "SystemSetting" ("key", "value", "dataType", "description", "isPublic", "category") VALUES
('app.name', '"Metrika"', 'string', 'Application name', true, 'general'),
('app.version', '"1.0.0"', 'string', 'Application version', true, 'general'),
('app.environment', '"production"', 'string', 'Application environment', false, 'general'),
('security.session.timeout', '3600', 'number', 'Session timeout in seconds', false, 'security'),
('security.password.minLength', '12', 'number', 'Minimum password length', true, 'security'),
('security.password.requireUppercase', 'true', 'boolean', 'Password requires uppercase letters', true, 'security'),
('security.password.requireLowercase', 'true', 'boolean', 'Password requires lowercase letters', true, 'security'),
('security.password.requireNumbers', 'true', 'boolean', 'Password requires numbers', true, 'security'),
('security.password.requireSpecialChars', 'true', 'boolean', 'Password requires special characters', true, 'security'),
('notifications.email.enabled', 'true', 'boolean', 'Enable email notifications', false, 'notifications'),
('notifications.email.fromAddress', '"noreply@metrika.local"', 'string', 'Email from address', false, 'notifications'),
('notifications.email.fromName', '"Metrika System"', 'string', 'Email from name', false, 'notifications'),
('task.autoReminder.enabled', 'true', 'boolean', 'Enable automatic task reminders', false, 'tasks'),
('task.autoReminder.daysBeforeDue', '3', 'number', 'Days before due date to send reminder', false, 'tasks'),
('project.defaultBudgetCurrency', '"USD"', 'string', 'Default currency for project budgets', true, 'projects'),
('kpi.autoCalculation.enabled', 'true', 'boolean', 'Enable automatic KPI calculation', false, 'kpi');
