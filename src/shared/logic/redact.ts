/**
 * 敏感信息脱敏（规格书 §6 第 5 条：日志与上报不得出现 JWT/密码/文件内容）。
 * 纯函数，供日志与 Sentry beforeSend 共用。
 */

const SENSITIVE_KEY = /(pass(word|wd)?|token|authorization|auth|cookie|secret|jwt|apikey|api_key|dsn|credential)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export const REDACTED = '[已脱敏]';

/** 脱敏后的结构（JSON 同构；对象键保留，敏感键值替换为 REDACTED） */
export type RedactedValue = string | number | boolean | null | RedactedValue[] | { [key: string]: RedactedValue };

/** 文本级脱敏：JWT 串与 Bearer 头 */
export function redactText(text: string): string {
  return text.replace(JWT_PATTERN, REDACTED).replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
}

/** 任意值深拷贝脱敏；深度上限 8 防循环引用 */
export function redactValue(value: unknown, depth = 0): RedactedValue {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const output: { [key: string]: RedactedValue } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, depth + 1);
    }
    return output;
  }
  return REDACTED;
}

/**
 * 原地脱敏（规格书 §6 第 5 条）：供 Sentry beforeSend 使用，保留事件对象身份，
 * 无需类型断言即可满足事件类型校验。
 */
export function redactInPlace(target: unknown, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(target)) {
    for (let index = 0; index < target.length; index += 1) {
      const item: unknown = target[index];
      if (typeof item === 'string') target[index] = redactText(item);
      else redactInPlace(item, depth + 1);
    }
    return;
  }
  if (typeof target !== 'object' || target === null) return;
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (SENSITIVE_KEY.test(key)) {
      record[key] = REDACTED;
      continue;
    }
    if (typeof item === 'string') {
      record[key] = redactText(item);
      continue;
    }
    redactInPlace(item, depth + 1);
  }
}
