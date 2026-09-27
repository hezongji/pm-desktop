'use client'

/**
 * ListError —— 列表加载失败态（20260908 生产审计修复 P2-3）
 *
 * 背景：接口失败时列表页只渲染空数组，用户看到「空列表」而非「加载失败」，
 * 也无法重试，只能刷新整页。统一收敛为一个可点击重试的提示块。
 */

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ListErrorProps {
  /** 展示给用户的原因（已脱敏，勿透传原始堆栈） */
  message?: string
  /** 点击重试回调（通常传 react-query 的 refetch） */
  onRetry?: () => void
  className?: string
}

export function ListError({ message, onRetry, className }: ListErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center',
        className
      )}
    >
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">加载失败</p>
        <p className="text-xs text-muted-foreground">
          {message || '网络异常或服务暂时不可用，请重试'}
        </p>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRetry()}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          点击重试
        </Button>
      )}
    </div>
  )
}
