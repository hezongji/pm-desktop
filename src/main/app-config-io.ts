/** 本地配置读写（%APPDATA%/pm-desktop/config.json）—— 纯逻辑在 shared/logic/app-config.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from './diagnostics';
import { resolvedConfigFilePath } from './app-paths';
import {
  type LocalConfig,
  parseLocalConfig,
  serializeLocalConfig,
} from '../shared/logic/app-config';

export function readLocalConfig(): LocalConfig {
  const file = resolvedConfigFilePath();
  try {
    return parseLocalConfig(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function writeLocalConfig(config: LocalConfig): boolean {
  const file = resolvedConfigFilePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serializeLocalConfig(config), 'utf8');
    log.info(`[config] 已写入本地配置 ${file}`);
    return true;
  } catch (error) {
    log.warn(`[config] 写入失败 ${file}: ${String(error)}`);
    return false;
  }
}

export function configFileLocation(): string {
  return resolvedConfigFilePath();
}
