/**
 * 本地运行时展示口径单测（P3-D 桌面化）
 *
 * 壳只暴露总体 phase，三服务状态灯是按壳真实语义推导的，故把推导锁进测试：
 *  - degraded = 看门狗升级（应用/消息服务健康检查连续失败），但数据库仍算在跑
 *    （local-runtime 的重启动作 restartServers 显式不动 PostgreSQL）
 *  - ready 之外不把应用/消息服务标绿（避免「三灯全绿」掩盖真实故障）
 */

import {
  deriveRuntimeServices,
  displayDataDir,
  RUNTIME_PHASE_LABEL,
  RUNTIME_PHASE_VARIANT,
  RUNTIME_SERVICE_META,
  usageShare,
} from '@/components/settings/desktop-runtime'
import type { DesktopRuntimeStatus } from '@/lib/pm-desktop'

const status = (
  phase: DesktopRuntimeStatus['phase'],
  ports: Partial<DesktopRuntimeStatus> = {}
): DesktopRuntimeStatus => ({
  mode: 'local',
  phase,
  apiPort: 4310,
  wsPort: 4312,
  pgPort: 54329,
  dataDir: 'C:\\Users\\pc\\AppData\\Roaming\\pm-desktop',
  ...ports,
})

describe('deriveRuntimeServices', () => {
  it('ready：三服务全在跑并带端口', () => {
    const services = deriveRuntimeServices(status('ready'))
    expect(services.map(s => s.key)).toEqual(['pg', 'api', 'im'])
    expect(services.every(s => s.up)).toBe(true)
    expect(services.find(s => s.key === 'pg')?.port).toBe(54329)
    expect(services.find(s => s.key === 'im')?.port).toBe(4312)
  })

  it('degraded：数据库仍算在跑，应用/消息服务不算', () => {
    const services = deriveRuntimeServices(status('degraded'))
    expect(services.find(s => s.key === 'pg')?.up).toBe(true)
    expect(services.find(s => s.key === 'api')?.up).toBe(false)
    expect(services.find(s => s.key === 'im')?.up).toBe(false)
  })

  it('booting / failed / stopped / idle：无服务标绿', () => {
    for (const phase of ['booting', 'failed', 'stopped', 'idle'] as const) {
      const services = deriveRuntimeServices(status(phase))
      expect(services.map(s => s.up)).toEqual([false, false, false])
    }
  })

  it('status 为 null（未拉到）→ 全部视为未启动，且不抛', () => {
    const services = deriveRuntimeServices(null)
    expect(services).toHaveLength(RUNTIME_SERVICE_META.length)
    expect(services.every(s => s.up === false)).toBe(true)
    expect(services.every(s => s.port === undefined)).toBe(true)
  })

  it('未上报端口时显示未启动（port undefined）', () => {
    const services = deriveRuntimeServices({
      mode: 'local',
      phase: 'ready',
    })
    expect(services.every(s => s.up)).toBe(true)
    expect(services.every(s => s.port === undefined)).toBe(true)
  })
})

describe('displayDataDir', () => {
  it('优先用壳上报的数据目录', () => {
    expect(displayDataDir(status('ready'))).toBe(
      'C:\\Users\\pc\\AppData\\Roaming\\pm-desktop'
    )
  })

  it('壳未上报时回退到固定落点提示', () => {
    expect(displayDataDir(null)).toBe('%APPDATA%\\pm-desktop')
    expect(displayDataDir({ mode: 'local', phase: 'booting' })).toBe(
      '%APPDATA%\\pm-desktop'
    )
  })
})

describe('相位文案与徽标', () => {
  it('六个相位都有中文文案与徽标变体', () => {
    const phases = [
      'idle',
      'booting',
      'ready',
      'degraded',
      'failed',
      'stopped',
    ] as const
    for (const phase of phases) {
      expect(RUNTIME_PHASE_LABEL[phase]).toBeTruthy()
      expect(RUNTIME_PHASE_VARIANT[phase]).toBeTruthy()
    }
  })

  it('就绪=绿、降级=黄、失败=红（语义色不得互换）', () => {
    expect(RUNTIME_PHASE_VARIANT.ready).toBe('softSuccess')
    expect(RUNTIME_PHASE_VARIANT.degraded).toBe('softWarning')
    expect(RUNTIME_PHASE_VARIANT.failed).toBe('softDestructive')
  })
})

describe('usageShare', () => {
  it('按占比取整并裁剪到 100 以内', () => {
    expect(usageShare(50, 200)).toBe(25)
    expect(usageShare(200, 200)).toBe(100)
    expect(usageShare(500, 200)).toBe(100)
  })

  it('总量为 0 / 非法值 → 0（不产生 NaN 宽度）', () => {
    expect(usageShare(0, 0)).toBe(0)
    expect(usageShare(10, 0)).toBe(0)
    expect(usageShare(Number.NaN, 100)).toBe(0)
    expect(usageShare(10, Number.NaN)).toBe(0)
  })
})
