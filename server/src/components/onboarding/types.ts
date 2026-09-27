/**
 * 操作向导系统 —— 类型定义
 *
 * 三级向导（2026-09-24 owner 需求：全面引导 + 操作旁向导按钮 + 深度/全流程向导）：
 *   flow 跨模块全流程向导（自动跨页跟走）
 *   deep 单页面深度向导（逐个功能讲透）
 *   op   操作向导（挂在具体操作按钮旁，逐字段动态指引）
 *
 * 底座 = driver.js v1.8（vendored：public/vendor/driver/，不引入 npm 依赖，
 * 不动 package-lock，服务器直构零额外安装）。
 */

export type WizardKind = 'flow' | 'deep' | 'op'

export interface WizardStep {
  /** 目标元素：CSS 选择器 / 查找函数；省略 = 居中说明步 */
  element?: string | (() => Element | null)
  /** 本步所在路由；跨页流程逐步跳转用（与当前 pathname 不一致时自动 router.push） */
  route?: string
  title: string
  desc: string
  /** popover 停靠方向（默认 bottom，放不下自动翻面） */
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  /** 进入本步前执行（如自动打开弹窗） */
  onEnter?: () => void | Promise<void>
}

export interface Wizard {
  id: string
  kind: WizardKind
  title: string
  desc: string
  /** 预计时长（分钟） */
  minutes: number
  steps: WizardStep[]
}

export const KIND_LABEL: Record<WizardKind, string> = {
  flow: '全流程向导',
  deep: '深度向导',
  op: '操作向导',
}

/** runWizard 只需要 push 能力，避免绑死 next 路由器类型 */
export interface RouterLike {
  push: (href: string) => void
}
