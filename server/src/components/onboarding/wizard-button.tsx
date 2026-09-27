/**
 * 操作向导系统 —— 向导按钮（挂在页面头部/具体操作旁）
 *
 * 用法：
 *   <WizardButton wizardId="deep:tasks" />            页面级深度向导
 *   <WizardButton wizardId="op:create-task" />        操作旁字段级向导
 *   <WizardButton wizardId="flow:project-lifecycle" /> 全流程
 */

'use client'

import { Compass, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWizard } from './wizard-runner'
import { getWizard } from './wizard-data'
import { KIND_LABEL } from './types'

interface WizardButtonProps {
  wizardId: string
  /** icon = 只显示 ⊙ 图标（放操作按钮旁）；full = 图标+文字（放页面头部） */
  variant?: 'icon' | 'full'
  size?: 'sm' | 'default'
  className?: string
}

export function WizardButton({
  wizardId,
  variant = 'icon',
  size = 'sm',
  className,
}: WizardButtonProps) {
  const { start } = useWizard()
  const wiz = getWizard(wizardId)
  if (!wiz) return null

  const label = `${KIND_LABEL[wiz.kind]}：${wiz.title}`
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      title={`⊙ ${label}（约 ${wiz.minutes} 分钟）`}
      aria-label={label}
      onClick={() => start(wizardId)}
      className={cn(
        'text-muted-foreground hover:text-foreground',
        variant === 'icon' && 'px-2',
        className
      )}
    >
      {variant === 'icon' ? (
        <Compass className="h-4 w-4" />
      ) : (
        <>
          <Wand2 className="mr-1.5 h-4 w-4" />
          向导
        </>
      )}
    </Button>
  )
}
