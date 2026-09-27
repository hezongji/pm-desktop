/**
 * 通用实体变更广播（20260921 数据同步根治工程）
 * 任何写操作成功后调用 emitEntityChanged，经 PG NOTIFY → im-server → 客户端 socket
 * 触发对应 React Query 缓存失效，保证所有引用方即时同步。
 * fire-and-forget：通知失败绝不影响主流程。
 */
import { prisma } from '@/lib/prisma'

export type SyncEntity =
  | 'project'
  | 'phase'
  | 'task'
  | 'file'
  | 'fileRequirement'
  | 'catalog'
  | 'todo'
  | 'notification'
  | 'purchaseOrder'
  | 'purchaseRequest'
  | 'supplierRequest'
  | 'purchaseContract'
  | 'purchasePayment'
  | 'goodsArrival'
  | 'expenseClaim'
  | 'expenseCategory'
  | 'user'
  | 'department'
  | 'jobTitle'
  | 'externalOrg'
  | 'member'

export async function emitEntityChanged(
  entity: SyncEntity,
  id?: string | null,
  tx?: { $executeRaw: typeof prisma.$executeRaw }
): Promise<void> {
  try {
    const payload = JSON.stringify({
      event: 'entity:changed',
      entity,
      id: id ?? null,
      at: Date.now(),
    })
    const db = tx ?? prisma
    await db.$executeRaw`SELECT pg_notify('im_events', ${payload})`
  } catch {
    /* 广播失败静默：数据已落库，不影响主流程 */
  }
}
