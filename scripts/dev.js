/** 开发模式启动（规格书 §7.1）：esbuild 监听 + electron .  */
const { spawn, spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..');
const electronBin = require('electron');
const isTest = process.argv.includes('--test');

function buildOnce(extraArgs = []) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

buildOnce(isTest ? ['--test'] : []);

const child = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PM_DESKTOP_DEV: '1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
