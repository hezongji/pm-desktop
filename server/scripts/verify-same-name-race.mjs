/**
 * verify-same-name-race.mjs —— 并发同名上传版本号竞态复现/回归脚本（20260908 生产审计 P1-2）
 *
 * 用途：部署前复现缺陷（应看到重复 version），部署后回归（version 必须互不重复）。
 * 原理：两个账号对同一目录**并发**上传同一文件名；旧实现 read-then-write 会各自拿到 v1。
 *
 * 用法：
 *   node scripts/verify-same-name-race.mjs                                   # 默认打本机 :3001
 *   BASE=https://pm.hezongji.cn PROJECT_ID=<id> node scripts/verify-same-name-race.mjs
 *   # 可选：N=5（并发数）、KEEP=1（不清理测试数据）
 *
 * 测试数据全部以 AUDIT0908-RACE- 前缀命名，跑完自动软删 + purge + 删测试目录。
 */

const BASE = (process.env.BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const PROJECT_ID = process.env.PROJECT_ID || ''
const N = Math.max(2, Math.min(10, Number(process.env.N || 3)))
const KEEP = process.env.KEEP === '1'

const MEMBER = {
  email: process.env.MEMBER_EMAIL || 'huyunfan@example.com',
  password: process.env.PASSWORD || 'demo123456',
}
const MANAGER = {
  email: process.env.MANAGER_EMAIL || 'wuyuetong@example.com',
  password: process.env.PASSWORD || 'demo123456',
}

let pass = 0,
  fail = 0
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`)
}

async function api(token, method, path, body, isForm) {
  const headers = { Authorization: `Bearer ${token}` }
  let payload
  if (isForm) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, json, text }
}

async function login(cred) {
  const r = await api(null, 'POST', '/api/auth/login', cred)
  if (r.status !== 200 || !r.json?.data?.token)
    throw new Error(
      `登录失败 ${cred.email}: HTTP ${r.status} ${r.text.slice(0, 120)}`
    )
  return r.json.data.token
}

async function upload(token, folderId, filename) {
  const fd = new FormData()
  fd.append('folderId', folderId)
  fd.append(
    'file',
    new Blob([`race-${Date.now()}-${Math.random()}`], { type: 'text/plain' }),
    filename
  )
  return api(token, 'POST', '/api/files/upload', fd, true)
}

async function main() {
  if (!PROJECT_ID)
    throw new Error('缺少 PROJECT_ID（两个账号都需是该项目的成员）')
  console.log(`BASE=${BASE} PROJECT=${PROJECT_ID} 并发数=${N}`)

  const [memberToken, managerToken] = await Promise.all([
    login(MEMBER),
    login(MANAGER),
  ])
  ok('双账号登录', true, `${MEMBER.email} / ${MANAGER.email}`)

  const stamp = Date.now()
  const folderName = `AUDIT0908-RACE-${stamp}`
  const folderRes = await api(
    memberToken,
    'POST',
    `/api/projects/${PROJECT_ID}/catalogs`,
    { name: folderName }
  )
  const folderId = folderRes.json?.data?.id ?? folderRes.json?.data?.catalog?.id
  ok(
    '创建测试目录',
    folderRes.status === 201 && !!folderId,
    `HTTP ${folderRes.status} id=${folderId}`
  )
  if (!folderId) throw new Error(`建目录失败：${folderRes.text.slice(0, 200)}`)

  const filename = `AUDIT0908-RACE-${stamp}.txt`
  const tasks = Array.from({ length: N }, (_, i) =>
    upload(i % 2 === 0 ? memberToken : managerToken, folderId, filename)
  )
  const results = await Promise.all(tasks)

  const created = results
    .filter(r => r.status === 201)
    .map(r => r.json?.data?.file)
  ok('并发上传全部 201', created.length === N, `成功 ${created.length}/${N}`)

  const versions = created.map(f => f.version).sort((a, b) => a - b)
  const unique = new Set(versions)
  ok(
    '版本号互不重复（核心回归断言）',
    unique.size === versions.length,
    `versions=[${versions.join(',')}] unique=${unique.size}`
  )
  ok(
    '版本号覆盖 1..N',
    versions.join(',') === Array.from({ length: N }, (_, i) => i + 1).join(','),
    `versions=[${versions.join(',')}]`
  )

  // 版本链完整性：任一 fileId 的 versions 端点应返回 N 条互异版本（同 folderId+originalName 版本链）
  const verRes = await api(
    memberToken,
    'GET',
    `/api/files/${created[0].id}/versions`
  )
  const verItems = verRes.json?.data?.items ?? []
  const verNums = verItems.map(v => v.version).sort((a, b) => a - b)
  ok(
    '版本链含全部 N 个版本且互不重复',
    verItems.length === N && new Set(verNums).size === N,
    `items=${verItems.length} versions=[${verNums.join(',')}]`
  )

  // 列表语义（spec D4）：同目录同名只展示「最新版」1 行，且为最大版本号
  const listRes = await api(
    memberToken,
    'GET',
    `/api/drive/list?projectId=${PROJECT_ID}&folderId=${folderId}&pageSize=100`
  )
  const items = listRes.json?.data?.items ?? []
  const visible = items.filter(i => i.type === 'file' && i.name === filename)
  ok(
    '列表中同名文件仅展示最新版 1 行',
    visible.length === 1,
    `visible=${visible.length}`
  )
  ok(
    '展示行版本号 = 最大版本号',
    visible[0]?.version === Math.max(...versions),
    `visible=${visible[0]?.version} max=${Math.max(...versions)}`
  )

  if (!KEEP) {
    const ids = created.map(f => f.id)
    const del = await api(memberToken, 'POST', '/api/files/batch', {
      fileIds: ids,
      action: 'delete',
    })
    ok('清理：软删测试文件', del.status === 200, `HTTP ${del.status}`)
    const purge = await api(managerToken, 'POST', '/api/files/batch', {
      fileIds: ids,
      action: 'purge',
    })
    ok(
      '清理：purge 测试文件（MANAGER+）',
      purge.status === 200,
      `HTTP ${purge.status}`
    )
    const delFolder = await api(managerToken, 'POST', '/api/files/batch', {
      folderIds: [folderId],
      action: 'delete',
    })
    ok(
      '清理：软删测试目录（MANAGER 删目录 = P1-1 回归）',
      delFolder.status === 200,
      `HTTP ${delFolder.status} ${JSON.stringify(delFolder.json?.data ?? {})}`
    )
    const purgeFolder = await api(managerToken, 'POST', '/api/files/batch', {
      folderIds: [folderId],
      action: 'purge',
    })
    ok(
      '清理：purge 测试目录',
      purgeFolder.status === 200,
      `HTTP ${purgeFolder.status}`
    )
  }

  console.log(`\n结果：${pass} ✅ / ${fail} ❌`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('❌ 脚本异常:', e.message)
  process.exit(2)
})
