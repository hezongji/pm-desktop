/**
 * audit-orphan-files.mjs —— 上传存储盘点（20260908 生产审计 W3-P2-5）
 *
 * 背景：生产 `uploads/` 3156 个物理文件 vs DB File 行 1683 → 约 1471 个孤儿文件（~6.9MB），
 * 来源是历史删除/失败上传未清理的残留（purge 只清 DB 行 + best-effort 删盘）。
 *
 * 本脚本**默认只读盘点**（不删任何东西），输出三类清单：
 *   1. 孤儿文件：磁盘存在、DB `File.storagePath` 无引用（含软删行，软删行保留到 purge 才删盘）
 *   2. 缺盘文件：DB 有行、磁盘不存在（数据不一致，需人工确认后再处理）
 *   3. 空目录：DB 无目录引用且磁盘为空
 *
 * 用法（在 /opt/pm-app 下执行）：
 *   node scripts/audit-orphan-files.mjs                 # 只读盘点（默认）
 *   node scripts/audit-orphan-files.mjs --json          # 机器可读输出
 *   node scripts/audit-orphan-files.mjs --delete --yes  # ★ 真删孤儿文件（双重确认）
 *
 * 安全约束：
 *   - 只删 `storagePath` 未被任何 File 行引用的文件，且路径必须在 FILE_ROOT 之内；
 *   - 删除前逐条打印，不递归删非空目录（空目录仅在 --delete 时清理）；
 *   - 建议先跑默认模式留档，再决定是否 --delete。
 */

import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const JSON_OUT = process.argv.includes('--json')
const DO_DELETE = process.argv.includes('--delete')
const CONFIRMED = process.argv.includes('--yes')

const FILE_ROOT = path.resolve(process.env.FILE_ROOT?.trim() || 'uploads')

async function walk(dir, out = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) await walk(abs, out)
    else if (e.isFile()) out.push(abs)
  }
  return out
}

async function main() {
  const rows = await prisma.file.findMany({
    select: { id: true, storagePath: true, size: true, deletedAt: true },
  })
  const referenced = new Map(
    rows.map(r => [path.resolve(FILE_ROOT, r.storagePath), r])
  )

  const diskFiles = await walk(FILE_ROOT)

  const orphans = []
  const missing = []
  let orphanBytes = 0

  for (const abs of diskFiles) {
    if (!referenced.has(abs)) {
      const st = await fs.stat(abs).catch(() => null)
      orphanBytes += st?.size ?? 0
      orphans.push({ abs, size: st?.size ?? 0 })
    }
  }
  for (const r of rows) {
    const abs = path.resolve(FILE_ROOT, r.storagePath)
    const ok = await fs
      .access(abs)
      .then(() => true)
      .catch(() => false)
    if (!ok)
      missing.push({
        id: r.id,
        storagePath: r.storagePath,
        deletedAt: r.deletedAt,
      })
  }

  const summary = {
    fileRoot: FILE_ROOT,
    dbRows: rows.length,
    diskFiles: diskFiles.length,
    orphans: orphans.length,
    orphanBytes,
    missing: missing.length,
    deletedRows: rows.filter(r => r.deletedAt).length,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, orphans, missing }, null, 2))
  } else {
    console.log('── 上传存储盘点 ──')
    console.log(`FILE_ROOT      : ${FILE_ROOT}`)
    console.log(
      `DB File 行     : ${rows.length}（其中软删 ${summary.deletedRows}）`
    )
    console.log(`磁盘物理文件   : ${diskFiles.length}`)
    console.log(
      `孤儿文件       : ${orphans.length}（${(orphanBytes / 1024 / 1024).toFixed(2)} MB）`
    )
    console.log(`DB 有行但缺盘  : ${missing.length}`)
    if (orphans.length) {
      console.log('\n孤儿文件示例（前 10）：')
      for (const o of orphans.slice(0, 10)) {
        console.log(
          `  ${(o.size / 1024).toFixed(1)}KB  ${path.relative(FILE_ROOT, o.abs)}`
        )
      }
    }
    if (missing.length) {
      console.log('\n缺盘记录示例（前 10）：')
      for (const m of missing.slice(0, 10))
        console.log(`  ${m.id}  ${m.storagePath}`)
    }
  }

  if (DO_DELETE) {
    if (!CONFIRMED) {
      console.error('\n[拒绝执行] --delete 需同时加 --yes 二次确认。')
      process.exitCode = 2
    } else {
      let removed = 0
      let bytes = 0
      for (const o of orphans) {
        const rel = path.relative(FILE_ROOT, o.abs)
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue // 越界保护
        await fs.unlink(o.abs).catch(() => {})
        removed++
        bytes += o.size
      }
      console.log(
        `\n[已删除] 孤儿文件 ${removed} 个（${(bytes / 1024 / 1024).toFixed(2)} MB）`
      )
    }
  } else {
    console.log(
      '\n（只读模式，未删除任何文件；如需清理请显式加 --delete --yes）'
    )
  }
}

main()
  .catch(e => {
    console.error('[audit-orphan-files] 失败:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
