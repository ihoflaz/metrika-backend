-- DropForeignKey (only if exists - check in all schemas)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_system_setting_updated_by' 
    AND table_name = 'SystemSetting'
  ) THEN
    ALTER TABLE "SystemSetting" DROP CONSTRAINT "fk_system_setting_updated_by";
  END IF;
END $$;

DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_user_preference_user' 
    AND table_name = 'UserPreference'
  ) THEN
    ALTER TABLE "UserPreference" DROP CONSTRAINT "fk_user_preference_user";
  END IF;
END $$;

-- AlterTable
ALTER TABLE "SystemSetting" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserPreference" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex (only if exists - using information_schema)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_system_setting_category') THEN
    ALTER INDEX "idx_system_setting_category" RENAME TO "SystemSetting_category_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_system_setting_key') THEN
    ALTER INDEX "idx_system_setting_key" RENAME TO "SystemSetting_key_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_system_setting_updated_by') THEN
    ALTER INDEX "idx_system_setting_updated_by" RENAME TO "SystemSetting_updatedBy_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_user_preference_key') THEN
    ALTER INDEX "idx_user_preference_key" RENAME TO "UserPreference_key_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_user_preference_user_id') THEN
    ALTER INDEX "idx_user_preference_user_id" RENAME TO "UserPreference_userId_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_user_preference_user_key') THEN
    ALTER INDEX "uq_user_preference_user_key" RENAME TO "UserPreference_userId_key_key";
  END IF;
END $$;

-- Seed kanban positions for existing tasks
-- Assign position based on created_at order within each (projectId, status) group
WITH ranked_tasks AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY "projectId", status ORDER BY "createdAt" ASC) - 1 AS new_position
  FROM "Task"
  WHERE "kanbanPosition" IS NULL
)
UPDATE "Task"
SET "kanbanPosition" = ranked_tasks.new_position
FROM ranked_tasks
WHERE "Task".id = ranked_tasks.id;
