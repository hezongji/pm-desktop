/**
 * 轻量滑动窗口限流（20260908 生产审计 P2-2）
 *
 * im-server 为单进程单实例部署（systemd pm-im），故用进程内存实现；
 * 若将来多实例/多进程部署，需替换为 Redis 等共享存储（否则各实例额度独立）。
 * 过期键懒清理，避免内存无界增长。
 */
function createSlidingWindowLimiter({ windowMs, max }) {
  const buckets = new Map() // key → number[]（命中时间戳，升序）
  let checks = 0

  return {
    /**
     * @param {string} key 限流维度（如 userId）
     * @param {number} [now] 当前时间戳（测试注入用）
     * @returns {{ok: boolean, retryAfterMs: number, remaining: number}}
     */
    check(key, now = Date.now()) {
      if (++checks % 1000 === 0) this.sweep(now)
      const list = (buckets.get(key) || []).filter(t => now - t < windowMs)
      if (list.length >= max) {
        buckets.set(key, list)
        return {
          ok: false,
          retryAfterMs: windowMs - (now - list[0]),
          remaining: 0,
        }
      }
      list.push(now)
      buckets.set(key, list)
      return { ok: true, retryAfterMs: 0, remaining: max - list.length }
    },
    /** 清理过期键（惰性调用，也可外部定时调用） */
    sweep(now = Date.now()) {
      for (const [k, list] of buckets) {
        const alive = list.filter(t => now - t < windowMs)
        if (alive.length === 0) buckets.delete(k)
        else buckets.set(k, alive)
      }
    },
    size() {
      return buckets.size
    },
  }
}

module.exports = { createSlidingWindowLimiter }
