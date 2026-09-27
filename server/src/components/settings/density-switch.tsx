'use client'

/**
 * 外观 · 信息密度切换（P3-C）
 *
 * Linear 铁律：选中态用中性底 + 强调色文字（不用强调色铺底）；
 * 切换即时生效（<html data-density>）并持久化 localStorage（见 use-density.ts）。
 * 组件独立导出 —— 后续若要挂到侧边栏/命令面板（P3-B 文件面）可直接复用。
 */

import * as React from 'react'
import { AlignJustify, Rows } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DENSITY_OPTIONS, useDensity, type Density } from '@/hooks/use-density'
import { cn } from '@/lib/utils'

const DENSITY_ICON: Record<
  Density,
  React.ComponentType<{ className?: string }>
> = {
  comfortable: AlignJustify,
  compact: Rows,
}

export function DensitySwitch() {
  const { density, setDensity } = useDensity()

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>
          信息密度：紧凑档把表格行高收到
          32px，单屏容纳更多数据。主题色在左下角调色盘切换。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="信息密度"
          className="inline-flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {DENSITY_OPTIONS.map(option => {
            const Icon = DENSITY_ICON[option.value]
            const active = density === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDensity(option.value)}
                className={cn(
                  'flex min-w-[9rem] flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left',
                  // Tailwind 3.4 不生成 duration-[var(--x)] / ease-[var(--x)]，
                  // 故用任意属性语法消费动效令牌（--dur-micro / --ease-fluent）
                  'transition-colors [transition-duration:var(--dur-micro)] [transition-timing-function:var(--ease-fluent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  active
                    ? 'bg-accent text-foreground shadow-[0_1px_2px_hsl(var(--shadow-color)/var(--shadow-sm-a))]'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      active ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  {option.label}
                </span>
                <span
                  className={cn(
                    'text-xs',
                    active
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/80'
                  )}
                >
                  {option.hint}
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
