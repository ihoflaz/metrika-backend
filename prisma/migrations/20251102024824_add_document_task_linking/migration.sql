-- CreateTable
CREATE TABLE "DocumentTask" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "linkedBy" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTask_documentId_idx" ON "DocumentTask"("documentId");

-- CreateIndex
CREATE INDEX "DocumentTask_taskId_idx" ON "DocumentTask"("taskId");

-- CreateIndex
CREATE INDEX "DocumentTask_linkedBy_idx" ON "DocumentTask"("linkedBy");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTask_documentId_taskId_key" ON "DocumentTask"("documentId", "taskId");

-- AddForeignKey
ALTER TABLE "DocumentTask" ADD CONSTRAINT "DocumentTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTask" ADD CONSTRAINT "DocumentTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTask" ADD CONSTRAINT "DocumentTask_linkedBy_fkey" FOREIGN KEY ("linkedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
