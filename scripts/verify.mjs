/** 一键验证：typecheck → 构建 → 单元测试（规格书 §8 每任务 DoD 的机器先验部分） */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const steps = [
  { name: 'typecheck', args: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { name: 'build', args: ['scripts/build.mjs'] },
  { name: 'unit-test', args: ['--test', 'tests/**/*.test.mjs'] },
];

const results = [];
for (const step of steps) {
  process.stdout.write(`\n===== [verify] ${step.name} =====\n`);
  const result = spawnSync(process.execPath, step.args, { cwd: root, stdio: 'inherit' });
  const passed = result.status === 0;
  results.push({ name: step.name, passed });
  if (!passed) break;
}

process.stdout.write('\n===== [verify] 汇总 =====\n');
for (const item of results) {
  process.stdout.write(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}\n`);
}
const failed = results.some((item) => !item.passed);
process.stdout.write(failed ? '[verify] 存在失败步骤\n' : '[verify] 全部通过\n');
process.exit(failed ? 1 : 0);
