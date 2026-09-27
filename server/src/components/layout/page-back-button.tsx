'use client'

/**
 * PageBackButton —— 二级页/详情页统一「智能返回」按钮（桌面端与通用场景）。
 *
 * 返回逻辑（按操作逻辑返回：从哪里跳转过来就回到哪里）：
 *  - 本标签页存在站内来路（history.length > 1 且 referrer 为空或同源）
 *    → router.back()，精确回到跳转来源页，并借 Next.js 历史栈恢复
 *    来源列表页的滚动位置与筛选状态；
 *  - 直开 URL / 收藏夹 / 外部站点进入（无可靠来路）→ 跳 fallbackHref
 *    （该页语义上的父级页，调用方逐页指定）。
 *
 * 判定放在点击时而非渲染时执行，避免 SSR 水合不一致。
 * 移动端二级页沿用 MobilePageHeader（ChevronLeft + ≥44px 触控区 +
 * 安全区 inset），其 onBack 复用本文件导出的 smartBack()，保证两端
 * 「来源感知」行为一致。
 *
 * 视觉约定：ghost + sm（h-9 触控友好）、muted 色，置于页面标题行最左侧
 * ——左上角是用户对「返回」的预期位置（F 型动线起点）；刻意弱化视觉
 * 权重，不与右侧主操作按钮竞争。
 */

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 智能返回：有站内来路走 back()（保留来源页滚动/筛选状态），否则落到语义父级页 */
export function smartBack(
  router: ReturnType<typeof useRouter>,
  fallbackHref: string
) {
  const hasAppHistory =
    typeof window !== 'undefined' &&
    window.history.length > 1 &&
    (document.referrer === '' ||
      document.referrer.startsWith(window.location.origin))
  if (hasAppHistory) router.back()
  else router.push(fallbackHref)
}

export function PageBackButton({
  label = '返回',
  fallbackHref,
  className,
}: {
  /** 按钮文案，默认「返回」；需要面包屑语义时可传「项目」等 */
  label?: string
  /** 无来路（直开/外链）时的兜底父级路由 */
  fallbackHref: string
  className?: string
}) {
  const router = useRouter()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="返回上一页"
      onClick={() => smartBack(router, fallbackHref)}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <ArrowLeft className="mr-1.5 h-4 w-4" />
      {label}
    </Button>
  )
}
