-- CreateEnum
CREATE TYPE "TaskDependencyType" AS ENUM ('FS', 'SF', 'FF', 'SS');

-- AlterTable
ALTER TABLE "TaskDependency" ADD COLUMN     "type" "TaskDependencyType" NOT NULL DEFAULT 'FS';
