/**
 * 操作向导系统 —— 运行器（driver.js 封装 + 跨页全流程导航）
 *
 * 设计要点：
 *   - driver.js overlay 挂 document.body，Next 路由切换不销毁，天然支持跨页流程
 *   - onNextClick/onPrevClick 全接管（覆写后默认导航失效，须自行 moveNext/movePrevious，
 *     见 driver.js 官方文档 Configuration 注记），由此实现「跨页前先 push 路由 + 等元素」
 *   - 每轮运行独立 Run 状态（idx/dead/navigating），互不串扰（2026-09-24 全量体检修复）：
 *     · dead 守卫：每次 await 后复查，关闭后飞行中的 stepTo 一律放弃，
 *       杜绝「stop() 后 moveTo 复活弹层、再点关闭 destroy 打空」的僵尸竞态
 *     · navigating 守卫：步进飞行中忽略连点，防 idx 串步
 *   - Esc 兜底监听（driver 自带键盘关闭在部分场景不触发，体检 C2 实测）
 *   - 进度记忆：localStorage 记已完成向导 id；首登未看过自动弹新手引导
 *   - 移动端降级：仅允许查看向导中心，不启动浮层导览（popover 在小屏体验差）
 */

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  driver as createDriver,
  type Driver,
} from '@/lib/driverjs/driver.js.mjs'
import '@/lib/driverjs/driver.css'
import { getWizard, FIRST_RUN_WIZARD_ID } from './wizard-data'
import type { Wizard, WizardStep } from './types'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/use-toast'

// ───────────────────────── localStorage 进度记忆 ─────────────────────────

const DONE_KEY = 'yy-wizard-done-v1'
const FIRST_RUN_KEY = 'yy-wizard-firstrun-v1'

export function getDoneWizardIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function markWizardDone(id: string) {
  const set = new Set(getDoneWizardIds())
  set.add(id)
  localStorage.setItem(DONE_KEY, JSON.stringify(Array.from(set)))
}

function isFirstRun(): boolean {
  return typeof window !== 'undefined' && !localStorage.getItem(FIRST_RUN_KEY)
}

function markFirstRunSeen() {
  localStorage.setItem(FIRST_RUN_KEY, String(Date.now()))
}

// ───────────────────────── DOM 等待工具 ─────────────────────────

function findEl(el?: WizardStep['element']): Element | null {
  if (!el) return null
  if (typeof el === 'string') return document.querySelector(el)
  return el()
}

const POLL_MS = 60
/** 轮询等待元素出现（跨页渲染有延迟；上限 2.5s 后居中兜底，避免卡顿感） */
function waitForElement(el: WizardStep['element'], ms = 2500): Promise<void> {
  if (!el) return Promise.resolve()
  return new Promise(resolve => {
    const t0 = Date.now()
    const tick = () => {
      if (findEl(el) || Date.now() - t0 > ms) return resolve()
      setTimeout(tick, POLL_MS)
    }
    tick()
  })
}

/** 等 URL 就位（router.push 后 window.location 先于 React 渲染更新） */
function waitForRoute(route: string, ms = 4000): Promise<void> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const tick = () => {
      if (window.location.pathname === route || Date.now() - t0 > ms)
        return resolve()
      setTimeout(tick, POLL_MS)
    }
    tick()
  })
}

// ───────────────────────── 每轮运行状态 ─────────────────────────

interface Run {
  dead: boolean
  idx: number
  navigating: boolean
  driverObj: Driver | null
  /** 本轮 Esc 监听清理 */
  cleanup?: () => void
}

// ───────────────────────── Context ─────────────────────────

interface WizardCtx {
  /** 当前正在运行的向导 id（无则 null） */
  activeId: string | null
  /** 启动向导（跨页自动导航；移动端仅提示） */
  start: (wizardId: string) => void
  /** 主动停止 */
  stop: () => void
  /** 首登提示是否可见（向导中心可复用） */
  showFirstRun: boolean
  dismissFirstRun: () => void
}

const Ctx = createContext<WizardCtx>({
  activeId: null,
  start: () => {},
  stop: () => {},
  showFirstRun: false,
  dismissFirstRun: () => {},
})

export const useWizard = () => useContext(Ctx)

// ───────────────────────── Provider ─────────────────────────

export function WizardProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const runRef = useRef<Run | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showFirstRun, setShowFirstRun] = useState(false)

  // 首登提示（登录进主布局后 1.2s 弹出；看过一次永久不再弹）
  useEffect(() => {
    if (typeof window === 'undefined' || !isFirstRun()) return
    const t = setTimeout(() => setShowFirstRun(true), 1200)
    return () => clearTimeout(t)
  }, [])

  /** 终止当前运行（幂等）：置 dead → 摘 Esc 监听 → destroy → 清引用 */
  const stop = useCallback(() => {
    const run = runRef.current
    if (run) {
      run.dead = true
      run.cleanup?.()
      try {
        run.driverObj?.destroy()
      } catch {
        /* destroy 幂等，异常吞掉 */
      }
      run.driverObj = null
    }
    runRef.current = null
    setActiveId(null)
  }, [])

  /**
   * 同步走一步：跨页导航 → onEnter 动作 → 等元素 → moveTo。
   * 每次 await 后复查 run.dead —— 关闭后飞行中的步进一律放弃，
   * 杜绝僵尸弹层（2026-09-24 全量体检 rez=True 复现的根因）。
   */
  const stepTo = useCallback(
    async (run: Run, wiz: Wizard, target: number) => {
      const step = wiz.steps[target]
      if (!step || run.dead) return
      // 1) 跨页：先路由
      if (step.route && window.location.pathname !== step.route) {
        router.push(step.route)
        await waitForRoute(step.route)
        if (run.dead) return
      }
      // 2) 进步前动作（如自动打开弹窗/切 Tab）
      if (step.onEnter) {
        await step.onEnter()
        if (run.dead) return
      }
      // 3) 等目标元素渲染（缺失则 2.5s 后居中兜底）
      await waitForElement(step.element)
      if (run.dead) return
      run.idx = target
      try {
        run.driverObj?.moveTo(target)
      } catch {
        /* 实例已被销毁 */
      }
    },
    [router]
  )

  const start = useCallback(
    (wizardId: string) => {
      const wiz = getWizard(wizardId)
      if (!wiz) return
      if (isMobile) {
        toast({
          description: '完整动态向导请在电脑端体验（手机端请看帮助中心）',
        })
        return
      }
      // 重入：先把旧轮彻底终止（dead 置位后旧 stepTo 不得再动 DOM）
      stop()

      const run: Run = {
        dead: false,
        idx: 0,
        navigating: false,
        driverObj: null,
      }
      runRef.current = run

      /** 步进（带并发守卫：飞行中忽略连点；越界忽略） */
      const go = (target: number) => {
        if (run.dead || run.navigating) return
        if (target < 0 || target >= wiz.steps.length) return
        run.navigating = true
        void stepTo(run, wiz, target).finally(() => {
          run.navigating = false
        })
      }

      /** 结束（幂等）：done=true 走完成语义 */
      const finish = (done: boolean) => {
        if (run.dead) return
        markWizardDone(wiz.id) // 完成或手动关掉都算看过
        if (done) toast({ description: `🎉 已完成「${wiz.title}」` })
        stop()
      }

      const driverObj = createDriver({
        showProgress: true,
        progressText: '{{current}} / {{total}}',
        popoverClass: 'yy-wiz-popover',
        allowClose: true,
        allowKeyboardControl: true,
        overlayClickBehavior: 'close',
        smoothScroll: true,
        stagePadding: 8,
        nextBtnText: '下一步',
        prevBtnText: '上一步',
        doneBtnText: '完成',
        // 全接管导航（官方约定：覆写即接管，须自行 moveNext/movePrevious）
        onNextClick: () => go(run.idx + 1),
        onPrevClick: () => go(run.idx - 1),
        onDoneClick: () => finish(true),
        onCloseClick: () => finish(false),
        onDestroyed: () => {
          run.dead = true
          run.cleanup?.()
          if (runRef.current === run) {
            runRef.current = null
            setActiveId(null)
          }
        },
        steps: wiz.steps.map(s => ({
          element: s.element
            ? typeof s.element === 'function'
              ? () => findEl(s.element) as Element
              : s.element
            : undefined,
          popover: {
            title: s.title,
            description: s.desc,
            side: s.side,
            align: s.align ?? 'start',
          },
        })),
      })

      run.driverObj = driverObj
      setActiveId(wiz.id)

      // Esc 兜底关闭（driver 自带键盘关闭部分场景不触发，体检 C2 实测）
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && runRef.current === run && !run.dead) {
          e.preventDefault()
          finish(false)
        }
      }
      document.addEventListener('keydown', onKey)
      run.cleanup = () => document.removeEventListener('keydown', onKey)

      // 从第 0 步正式开跑（同样走跨页/等待逻辑）
      run.navigating = true
      void (async () => {
        try {
          const first = wiz.steps[0]
          if (first?.route && window.location.pathname !== first.route) {
            router.push(first.route)
            await waitForRoute(first.route)
            if (run.dead) return
          }
          if (first?.onEnter) {
            await first.onEnter()
            if (run.dead) return
          }
          await waitForElement(first?.element)
          if (run.dead) return
          run.idx = 0
          driverObj.drive(0)
        } finally {
          run.navigating = false
        }
      })()
    },
    [isMobile, router, stepTo, stop, toast]
  )

  const dismissFirstRun = useCallback(() => {
    markFirstRunSeen()
    setShowFirstRun(false)
  }, [])

  // 首登「开始导览」
  const startFirstRun = useCallback(() => {
    markFirstRunSeen()
    setShowFirstRun(false)
    start(FIRST_RUN_WIZARD_ID)
  }, [start])

  // 卸载清理
  useEffect(() => () => stop(), [stop])

  return (
    <Ctx.Provider
      value={{ activeId, start, stop, showFirstRun, dismissFirstRun }}
    >
      {children}
      {showFirstRun && !isMobile && (
        <FirstRunCard onStart={startFirstRun} onDismiss={dismissFirstRun} />
      )}
    </Ctx.Provider>
  )
}

// ───────────────────────── 首登提示卡 ─────────────────────────

function FirstRunCard({
  onStart,
  onDismiss,
}: {
  onStart: () => void
  onDismiss: () => void
}) {
  return (
    <div className="fixed bottom-20 right-6 z-[60] w-80 rounded-xl border border-border bg-card p-4 shadow-lg lg:bottom-6">
      <p className="text-sm font-semibold">👋 欢迎使用 PM 项目管理系统</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        第一次用？花 9 分钟跟一遍新手导览，跨 6
        个模块走完整主干；以后每个页面和操作旁都有「向导」按钮随时重看。
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onStart}
          className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          开始新手导览
        </button>
        <button
          onClick={onDismiss}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          以后再说
        </button>
      </div>
    </div>
  )
}
