-- CreateTable
CREATE TABLE "ProjectCode" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCode_year_key" ON "ProjectCode"("year");

-- CreateIndex
CREATE INDEX "ProjectCode_year_idx" ON "ProjectCode"("year");
