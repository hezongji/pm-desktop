/**
 * 通话铃声/提醒（WebAudio 合成，无音频资源文件；spec.md §4 ringtone.ts）
 *
 * 三型：
 *   incoming  来电振铃：440+480Hz 双音，2s 周期（响 1.6s 停 0.4s）+ 震动
 *   ringback  回铃：450Hz，1s 通 4s 断
 *   busy      忙音：450Hz，0.35s 通断 ×3 后自停
 *
 * 全部走惰性 AudioContext（首次播放时创建，浏览器自动播放策略下需用户手势解锁——
 * 通话场景的"点击呼叫/接听"即手势；来电振铃在 WebView 壳已设免手势自动播放）。
 * title 闪烁由 startTitleFlash/stopTitleFlash 负责（后台标签页提醒第三通道）。
 */

type RingKind = 'incoming' | 'ringback' | 'busy'

let ctx: AudioContext | null = null
let stopTimer: ReturnType<typeof setInterval> | null = null
let currentKind: RingKind | null = null
let vibrateTimer: ReturnType<typeof setInterval> | null = null

function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** 单音爆发 */
function beep(freqs: number[], durationMs: number, volume = 0.12) {
  const ac = audioCtx()
  if (!ac) return
  const oscs = freqs.map(f => {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    return o
  })
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0, ac.currentTime)
  gain.gain.linearRampToValueAtTime(volume, ac.currentTime + 0.02)
  gain.gain.setValueAtTime(volume, ac.currentTime + durationMs / 1000 - 0.03)
  gain.gain.linearRampToValueAtTime(0, ac.currentTime + durationMs / 1000)
  oscs.forEach(o => o.connect(gain))
  gain.connect(ac.destination)
  const t = ac.currentTime
  oscs.forEach(o => {
    o.start(t)
    o.stop(t + durationMs / 1000 + 0.05)
  })
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {}
}

function startVibrateLoop() {
  stopVibrateLoop()
  vibrate([600, 400, 600, 1000])
  vibrateTimer = setInterval(() => vibrate([600, 400, 600, 1000]), 3000)
}

function stopVibrateLoop() {
  if (vibrateTimer) {
    clearInterval(vibrateTimer)
    vibrateTimer = null
  }
  try {
    navigator.vibrate?.(0)
  } catch {}
}

/** 播放指定类型铃声（幂等：已在放同类型则忽略） */
export function startRingtone(kind: RingKind) {
  if (currentKind === kind) return
  stopRingtone()
  currentKind = kind

  if (kind === 'incoming') {
    const ringOnce = () => beep([440, 480], 1600, 0.1)
    ringOnce()
    stopTimer = setInterval(ringOnce, 2000)
    startVibrateLoop()
  } else if (kind === 'ringback') {
    const tick = () => beep([450], 1000, 0.08)
    tick()
    stopTimer = setInterval(tick, 5000)
  } else {
    // busy：响三声自停
    let n = 0
    const tick = () => {
      if (n++ >= 3) {
        stopRingtone()
        return
      }
      beep([450], 350, 0.1)
    }
    tick()
    stopTimer = setInterval(tick, 700)
  }
}

/** 停止铃声/震动（终态必调） */
export function stopRingtone() {
  if (stopTimer) {
    clearInterval(stopTimer)
    stopTimer = null
  }
  stopVibrateLoop()
  currentKind = null
}

// ── title 闪烁（后台标签页来电提醒）──

let flashTimer: ReturnType<typeof setInterval> | null = null
let baseTitle: string | null = null

export function startTitleFlash(text: string) {
  if (typeof document === 'undefined') return
  stopTitleFlash()
  baseTitle = document.title
  let on = false
  flashTimer = setInterval(() => {
    on = !on
    document.title = on ? text : (baseTitle ?? document.title)
  }, 900)
}

export function stopTitleFlash() {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  if (baseTitle !== null && typeof document !== 'undefined') {
    document.title = baseTitle
    baseTitle = null
  }
}

/** 接通短提示音（"嘟"一声，接通感反馈） */
export function playConnectedBlip() {
  beep([880], 180, 0.1)
  setTimeout(() => beep([1174], 220, 0.1), 200)
}
