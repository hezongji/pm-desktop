/** 纯逻辑聚合入口：供 node --test 直接加载实际构建产物（dist/logic.cjs） */
export * from './origin';
export * from './recovery-policy';
export * from './updater-state';
export * from './safe-path';
export * from './app-config';
export * from './redact';
export * from './format';
export * from './local-runtime-policy';
