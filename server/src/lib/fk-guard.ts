/**
 * 外键防护工具（fix-5）—— 会话成员写入前的脏 userId 校验 + Prisma P2003 判定
 *
 * 背景：conversationMember.createMany 的 userId 来自客户端提交，若带不存在 /
 * 已离职（isActive=false）的用户 id，PG 外键约束会抛 P2003 → 未捕获时裸 500。
 *
 * 用法（REST 路由）：
 *   1. 写库前：user.findMany({ where: { id: { in: ids }, isActive: true } })
 *      后用 missingActiveUserIds() 求差集，非空 → 400（防 TOCTOU 由第 2 步兜底）
 *   2. 写库处：try { ... } catch (e) { if (isForeignKeyViolation(e)) throw ApiError.badRequest(...) }
 *      （校验与写入之间用户可能被停用，P2003 兜底转成明确 400 而非裸 500）
 */

/** Prisma P2003（foreign key violation）判定 —— 鸭子类型，跨 Prisma 版本稳定 */
export function isForeignKeyViolation(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.name === 'PrismaClientKnownRequestError' &&
    (e as { code?: unknown }).code === 'P2003'
  )
}

/**
 * 对比「请求加入的 userId」与「实际查到的在职用户 id」，返回缺失/离职的 id。
 * requested 自动去重（与 REST 侧 Set 去重语义一致）。
 */
export function missingActiveUserIds(
  requested: string[],
  foundActive: string[]
): string[] {
  const found = new Set(foundActive)
  return Array.from(new Set(requested)).filter(id => !found.has(id))
}
