/**
 * 健康看门狗：周期探测 /api/health + 服务进程退出事件。
 * 处置策略（纯逻辑见 shared/logic/local-runtime-policy.evaluateHealth）：
 * 连续失败 <3 次=观察；≥3 次=重启服务进程一次；仍失败=上报用户（兜底页+原生对话框）。
 */
import {
  HEALTH_CHECK_INTERVAL_MS,
  evaluateHealth,
} from "../../shared/logic/local-runtime-policy";
import { log } from "../diagnostics";

export interface WatchdogDeps {
  healthUrl: () => string;
  onRestartServers: () => Promise<boolean>;
  onEscalate: (detail: string) => void;
}

export class HealthWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private restartedOnce = false;
  private checking = false;

  constructor(private deps: WatchdogDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), HEALTH_CHECK_INTERVAL_MS);
    log.info("[watchdog] 已启动");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 服务进程退出 = 立即计一次失败并触发评估 */
  notifyProcessExit(name: string): void {
    log.warn(`[watchdog] 服务进程退出：${name}`);
    void this.evaluateNow(`进程 ${name} 异常退出`);
  }

  /** 手动重试成功后复位 */
  reset(): void {
    this.consecutiveFailures = 0;
    this.restartedOnce = false;
  }

  private async tick(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const response = await fetch(this.deps.healthUrl(), {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        if (this.consecutiveFailures > 0) {
          log.info(
            `[watchdog] 恢复健康（此前连续失败 ${this.consecutiveFailures} 次）`,
          );
        }
        this.consecutiveFailures = 0;
        if (this.restartedOnce) this.restartedOnce = false;
      } else {
        this.consecutiveFailures += 1;
      }
    } catch {
      this.consecutiveFailures += 1;
    } finally {
      this.checking = false;
    }
    await this.evaluateNow(`连续 ${this.consecutiveFailures} 次健康检查失败`);
  }

  private async evaluateNow(detail: string): Promise<void> {
    const action = evaluateHealth(this.consecutiveFailures, this.restartedOnce);
    if (action === "ok" || action === "warn") return;
    if (action === "restart-servers") {
      log.warn(`[watchdog] ${detail}，自动重启服务进程一次`);
      this.restartedOnce = true;
      this.consecutiveFailures = 0;
      const ok = await this.deps.onRestartServers();
      if (!ok) this.deps.onEscalate(`${detail}；自动重启失败`);
      return;
    }
    this.deps.onEscalate(detail);
  }
}
