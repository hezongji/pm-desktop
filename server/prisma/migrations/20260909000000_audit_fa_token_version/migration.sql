-- 20260908 生产审计修复（FA 认证域）
-- P1-3 令牌吊销：User.tokenVersion —— 登录时写入 JWT 的 ver 声明，
-- 登出/改密后服务端自增该值，apiHandler 实时身份守卫随即拒绝所有旧令牌。
-- 幂等写法：列已存在时跳过（重复执行安全）。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
