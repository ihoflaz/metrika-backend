-- CreateIndex
CREATE INDEX "Task_projectId_status_kanbanPosition_idx" ON "Task"("projectId", "status", "kanbanPosition");

-- CreateIndex
CREATE INDEX "Task_status_kanbanPosition_idx" ON "Task"("status", "kanbanPosition");
