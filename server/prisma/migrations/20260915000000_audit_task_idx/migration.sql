-- 20260915 上线评测 D-P2-1：任务表负责人/创建人索引（我的任务/待办查询）
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");
