-- CreateEnum
CREATE TYPE "KPICategory" AS ENUM ('FINANCIAL', 'SCHEDULE', 'QUALITY', 'RESOURCE', 'COMPLIANCE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "KPIStatus" AS ENUM ('PROPOSED', 'UNDER_REVIEW', 'ACTIVE', 'MONITORING', 'BREACHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "KPIPrivacyLevel" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "KPIAggregationPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "KPIDataSourceType" AS ENUM ('MANUAL', 'SYSTEM', 'HYBRID');

-- CreateEnum
CREATE TYPE "KPIValueSource" AS ENUM ('MANUAL_ENTRY', 'API_INGEST', 'FILE_UPLOAD');

-- CreateEnum
CREATE TYPE "KPIVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "KPIDefinition" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "category" "KPICategory" NOT NULL,
    "calculationFormula" TEXT NOT NULL,
    "targetValue" DECIMAL(20,4) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "thresholdWarning" DECIMAL(20,4),
    "thresholdCritical" DECIMAL(20,4),
    "aggregationPeriod" "KPIAggregationPeriod" NOT NULL,
    "dataSourceType" "KPIDataSourceType" NOT NULL,
    "dataSourceReference" JSONB,
    "stewardId" UUID NOT NULL,
    "approverId" UUID,
    "status" "KPIStatus" NOT NULL DEFAULT 'PROPOSED',
    "privacyLevel" "KPIPrivacyLevel" NOT NULL DEFAULT 'INTERNAL',
    "linkedProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KPIDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KPISeries" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "actualValue" DECIMAL(20,4) NOT NULL,
    "valueSource" "KPIValueSource" NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedBy" UUID,
    "verificationStatus" "KPIVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verificationNotes" TEXT,
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "KPISeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KPIDefinition_code_key" ON "KPIDefinition"("code");

-- CreateIndex
CREATE INDEX "KPIDefinition_category_idx" ON "KPIDefinition"("category");

-- CreateIndex
CREATE INDEX "KPIDefinition_status_idx" ON "KPIDefinition"("status");

-- CreateIndex
CREATE INDEX "KPIDefinition_stewardId_idx" ON "KPIDefinition"("stewardId");

-- CreateIndex
CREATE INDEX "KPISeries_kpiId_periodStart_idx" ON "KPISeries"("kpiId", "periodStart");

-- CreateIndex
CREATE INDEX "KPISeries_collectedAt_idx" ON "KPISeries"("collectedAt");

-- AddForeignKey
ALTER TABLE "KPIDefinition" ADD CONSTRAINT "KPIDefinition_stewardId_fkey" FOREIGN KEY ("stewardId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPIDefinition" ADD CONSTRAINT "KPIDefinition_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPISeries" ADD CONSTRAINT "KPISeries_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KPIDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPISeries" ADD CONSTRAINT "KPISeries_collectedBy_fkey" FOREIGN KEY ("collectedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPISeries" ADD CONSTRAINT "KPISeries_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
