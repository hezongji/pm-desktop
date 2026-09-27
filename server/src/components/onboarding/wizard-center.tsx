/**
 * 操作向导系统 —— 向导中心（全部向导入口，/wizards 页）
 *
 * 三类分组展示：全流程向导 / 深度向导 / 操作向导；
 * 已完成的向导打 ✓（localStorage 记忆），可随时重看。
 */

'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Clock, Play, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { WIZARDS, FIRST_RUN_WIZARD_ID } from './wizard-data'
import { getDoneWizardIds, useWizard } from './wizard-runner'
import { KIND_LABEL, type WizardKind } from './types'

const KIND_ORDER: WizardKind[] = ['flow', 'deep', 'op']

export function WizardCenter() {
  const { start, showFirstRun, dismissFirstRun } = useWizard()
  // SSR 与首帧不读 localStorage，避免 hydration 不一致
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => setDone(new Set(getDoneWizardIds())), [])

  // 从向导中心主动开始新手导览时，顺手关掉右下角首登卡
  const handleStart = (id: string) => {
    if (showFirstRun) dismissFirstRun()
    start(id)
    // 回看按钮状态（onDoneClick 之后）
    setTimeout(() => setDone(new Set(getDoneWizardIds())), 1000)
  }

  return (
    <div className="space-y-6">
      {/* 页头（统一标题区） */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">向导中心</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            动态指引全集：全流程向导跨模块跟走业务主干，深度向导逐页讲透功能，操作向导挂在具体按钮旁逐字段教。
            每个页面头部也有「⊙ 向导」按钮直达本页导览。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => handleStart(FIRST_RUN_WIZARD_ID)}
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          重看新手导览
        </Button>
      </div>

      {KIND_ORDER.map(kind => {
        const list = WIZARDS.filter(w => w.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
              {KIND_LABEL[kind]}（{list.length}）
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map(w => {
                const isDone = done.has(w.id)
                return (
                  <Card key={w.id} className="flex flex-col">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{w.title}</CardTitle>
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        )}
                      </div>
                      <CardDescription className="line-clamp-3 leading-relaxed">
                        {w.desc}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto flex items-center justify-between pt-0">
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Clock className="h-3 w-3" />约 {w.minutes} 分钟 ·{' '}
                        {w.steps.length} 步
                      </Badge>
                      <Button size="sm" onClick={() => handleStart(w.id)}>
                        <Play className="mr-1 h-3.5 w-3.5" />
                        开始
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
