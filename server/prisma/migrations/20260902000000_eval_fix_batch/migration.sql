-- 评测修复批（2026-09-02）
-- fix-1: 首登强制改密
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
-- fix-2: 移除未接线的资源级 ACL（生产数据 0 行；部署前 pg_dump 兜底）
DROP TABLE IF EXISTS "ResourcePermission";
DROP TABLE IF EXISTS "PurchaseScopeGrant";
DROP TYPE IF EXISTS "ResType";
DROP TYPE IF EXISTS "PrincipalType";
