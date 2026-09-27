/**
 * 本地运行时（LocalRuntime）纯逻辑：启动阶段、端口候选、健康策略、运行时配置解析。
 * 全部纯函数/常量，供 node --test 直接断言（经 dist/logic.cjs 加载实际发布代码路径）。
 */

/** 启动阶段（顺序即流程，boot.html 按此渲染进度） */
export const BOOT_STAGES = [
  'prepare', // 目录/密钥/端口准备
  'initdb', // 初始化数据库（仅首次）
  'start-pg', // 启动嵌入式 PostgreSQL
  'migrate', // 结构迁移（含版本升级前滚）
  'seed', // 基线数据（仅首次空库）
  'start-server', // 启动应用服务（Next standalone）
  'start-im', // 启动实时服务（Socket.IO）
  'ready', // 就绪
] as const;

export type BootStage = (typeof BOOT_STAGES)[number];

export interface BootProgressEvent {
  stage: BootStage | 'error';
  /** 面向用户的中文描述 */
  text: string;
  /** 出错阶段的可读原因（仅 stage=error） */
  detail?: string;
}

export function bootStageText(stage: BootStage): string {
  switch (stage) {
    case 'prepare':
      return '准备本地运行环境';
    case 'initdb':
      return '初始化本地数据库（首次启动较慢）';
    case 'start-pg':
      return '启动本地数据库';
    case 'migrate':
      return '校验数据结构版本';
    case 'seed':
      return '写入初始数据';
    case 'start-server':
      return '启动应用服务';
    case 'start-im':
      return '启动实时消息服务';
    case 'ready':
      return '就绪';
  }
}

export function isBootStage(value: string): value is BootStage {
  return (BOOT_STAGES as readonly string[]).includes(value);
}

/**
 * 端口候选序列：首选端口被占用时按步长递增探测。
 * 默认 [preferred, preferred+2, ..., preferred+2*(count-1)]。
 */
export function portCandidates(preferred: number, count = 8, step = 2): number[] {
  const ports: number[] = [];
  for (let i = 0; i < count; i += 1) ports.push(preferred + i * step);
  return ports;
}

/** 本地运行端口分配结果（持久化到 runtime.json，重启后优先复用） */
export interface RuntimePorts {
  apiPort: number;
  wsPort: number;
  pgPort: number;
}

/** 从已占用集合中挑选第一个可用候选；全部占用返回 null（调用方弹错） */
export function pickFreePort(candidates: number[], occupied: ReadonlySet<number>): number | null {
  for (const port of candidates) {
    if (!occupied.has(port)) return port;
  }
  return null;
}

/** 健康检查策略：每 10s 一次，连续 3 次失败判定为服务异常 */
export const HEALTH_CHECK_INTERVAL_MS = 10_000;
export const HEALTH_FAIL_THRESHOLD = 3;

/** 健康看门狗状态机（纯函数）：输入连续失败次数，输出处置动作 */
export type HealthAction = 'ok' | 'warn' | 'restart-servers' | 'escalate';

export function evaluateHealth(consecutiveFailures: number, restartedOnce: boolean): HealthAction {
  if (consecutiveFailures <= 0) return 'ok';
  if (consecutiveFailures < HEALTH_FAIL_THRESHOLD) return 'warn';
  if (!restartedOnce) return 'restart-servers';
  return 'escalate';
}

/** runtime.json 的容错解析（损坏/缺失 → null，由调用方重建） */
export interface RuntimeStateFile {
  ports?: Partial<RuntimePorts>;
  pgPasswordEnc?: string;
  jwtSecretEnc?: string;
  seededAt?: string;
}

export function parseRuntimeState(raw: string | null | undefined): RuntimeStateFile | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const state: RuntimeStateFile = {};
  if (typeof record.ports === 'object' && record.ports !== null) {
    const ports = record.ports as Record<string, unknown>;
    state.ports = {};
    for (const key of ['apiPort', 'wsPort', 'pgPort'] as const) {
      const value = ports[key];
      if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536) {
        state.ports[key] = value;
      }
    }
  }
  if (typeof record.pgPasswordEnc === 'string') state.pgPasswordEnc = record.pgPasswordEnc;
  if (typeof record.jwtSecretEnc === 'string') state.jwtSecretEnc = record.jwtSecretEnc;
  if (typeof record.seededAt === 'string') state.seededAt = record.seededAt;
  return state;
}

/** 组装 PostgreSQL 连接串（密码需 URL 编码） */
export function buildDatabaseUrl(port: number, password: string, database = 'pm_local'): string {
  return `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}
