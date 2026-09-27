/**
 * Stage 2/3：把本机 PostgreSQL 16（EDB 安装）的运行时二进制拷进打包舞台 build/stage/pg16。
 * 只拷运行必需三件套：bin / lib / share（initdb、postgres、psql、pg_dump、pg_ctl 等及其依赖）。
 *
 *   node scripts/stage-pg.mjs            # 已存在则跳过
 *   node scripts/stage-pg.mjs --force    # 强制重拷
 *
 * 许可：PostgreSQL License（类 MIT）允许随产品再分发二进制；
 * 许可证文本一并拷入 build/stage/pg16/LICENSE.txt。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const force = process.argv.includes("--force");
const PG_SOURCE =
  process.env.PG_SOURCE_DIR ??
  join("C:\\", "Program Files", "PostgreSQL", "16");
const target = join(root, "build", "stage", "pg16");

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch {
      /* 忽略 */
    }
  }
  return total;
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function main() {
  if (existsSync(join(target, "bin", "postgres.exe")) && !force) {
    console.log(`[stage-pg] 已存在，跳过（--force 重拷）：${target}`);
    return;
  }
  for (const name of ["bin", "lib", "share"]) {
    if (!existsSync(join(PG_SOURCE, name))) {
      console.error(
        `[stage-pg] 找不到 PostgreSQL 安装目录组件：${join(PG_SOURCE, name)}`,
      );
      console.error(
        "[stage-pg] 请安装 PostgreSQL 16（EDB 安装包），或用 PG_SOURCE_DIR 指定安装目录",
      );
      process.exit(1);
    }
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const name of ["bin", "lib", "share"]) {
    console.log(`[stage-pg] 复制 ${name}/ …`);
    cpSync(join(PG_SOURCE, name), join(target, name), { recursive: true });
  }
  // 许可证随二进制分发
  const licenseSource = join(PG_SOURCE, "server_license.txt");
  if (existsSync(licenseSource)) {
    cpSync(licenseSource, join(target, "LICENSE.txt"));
  } else {
    writeFileSync(
      join(target, "LICENSE.txt"),
      "PostgreSQL is released under the PostgreSQL License, a liberal Open Source license, similar to the BSD or MIT licenses.\nhttps://www.postgresql.org/about/licence/\n",
      "utf8",
    );
  }
  console.log(
    `[stage-pg] 完成 → ${target}（${humanBytes(dirSizeBytes(target))}）`,
  );
}

main();
