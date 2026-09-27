/** 本地运行时密钥与端口状态：生成、加密存储（DPAPI）、读取 runtime.json */
import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  parseRuntimeState,
  type RuntimePorts,
  type RuntimeStateFile,
} from "../../shared/logic/local-runtime-policy";
import { runtimeStatePath } from "./paths";
import { log } from "../diagnostics";

export interface RuntimeSecrets {
  pgPassword: string;
  jwtSecret: string;
}

function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `dpapi:${safeStorage.encryptString(plain).toString("base64")}`;
  }
  log.warn("[runtime] DPAPI 不可用，密钥以 plain: 前缀降级存储（仅本机可读目录）");
  return `plain:${plain}`;
}

function decryptSecret(stored: string): string | null {
  if (stored.startsWith("dpapi:")) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(6), "base64"));
    } catch (error) {
      log.warn(`[runtime] 密钥解密失败：${String(error)}`);
      return null;
    }
  }
  if (stored.startsWith("plain:")) return stored.slice(6);
  return null;
}

export function generateSecrets(): RuntimeSecrets {
  return {
    pgPassword: randomBytes(24).toString("base64url"),
    jwtSecret: randomBytes(48).toString("base64url"),
  };
}

export function readRuntimeState(): RuntimeStateFile | null {
  const file = runtimeStatePath();
  if (!existsSync(file)) return null;
  try {
    return parseRuntimeState(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeRuntimeState(state: RuntimeStateFile): void {
  const file = runtimeStatePath();
  mkdirSync(dirname(file), { recursive: true });
  const ordered: Record<string, unknown> = {};
  if (state.ports) ordered.ports = state.ports;
  if (state.pgPasswordEnc) ordered.pgPasswordEnc = state.pgPasswordEnc;
  if (state.jwtSecretEnc) ordered.jwtSecretEnc = state.jwtSecretEnc;
  if (state.seededAt) ordered.seededAt = state.seededAt;
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

/** 读取既有密钥；不存在则生成并落盘 */
export function ensureSecrets(state: RuntimeStateFile | null): {
  secrets: RuntimeSecrets;
  state: RuntimeStateFile;
} {
  const next: RuntimeStateFile = { ...(state ?? {}) };
  let pgPassword: string | null = null;
  let jwtSecret: string | null = null;
  if (state?.pgPasswordEnc) pgPassword = decryptSecret(state.pgPasswordEnc);
  if (state?.jwtSecretEnc) jwtSecret = decryptSecret(state.jwtSecretEnc);
  if (!pgPassword) {
    pgPassword = generateSecrets().pgPassword;
    next.pgPasswordEnc = encryptSecret(pgPassword);
  }
  if (!jwtSecret) {
    jwtSecret = generateSecrets().jwtSecret;
    next.jwtSecretEnc = encryptSecret(jwtSecret);
  }
  writeRuntimeState(next);
  return { secrets: { pgPassword, jwtSecret }, state: next };
}

export function persistPorts(ports: RuntimePorts): void {
  const state = readRuntimeState() ?? {};
  state.ports = ports;
  writeRuntimeState(state);
}

export function markSeeded(): void {
  const state = readRuntimeState() ?? {};
  state.seededAt = new Date().toISOString();
  writeRuntimeState(state);
}
