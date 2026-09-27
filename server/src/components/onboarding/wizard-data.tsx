/**
 * 操作向导系统 —— 内容库（全部向导步骤数据）
 *
 * 选择器约定（防 UI 迭代失效）：
 *   - 优先用文本锚点 el()/elContains()（对 class 改动免疫）
 *   - 表单控件用 placeholder/role 属性选择器
 *   - 全步骤建议配 waitForElement 兜底（runner 已统一处理）
 *
 * 维护：新增/改版页面时同步改这里；向导中心页自动渲染本注册表。
 */

import type { Wizard } from './types'

/** 可见元素过滤（移动端 FAB 等同名隐藏按钮会抢锚点） */
const visible = (list: Element[]): Element[] =>
  list.filter(
    e =>
      (e as HTMLElement).offsetParent !== null || e.getClientRects().length > 0
  )

/** 元素匹配文本：textContent + placeholder/aria-label/title 属性。
 *  （input/textarea 的 placeholder 不在 textContent 里，不并入锚点必恒超时——
 *   2026-09-24 全量体检实测此类锚点每步白等 2.5s） */
const norm = (s: string) => s.replace(/\s+/g, '').trim()
const matchText = (e: Element): string =>
  norm(
    [
      e.textContent ?? '',
      e.getAttribute('placeholder') ?? '',
      e.getAttribute('aria-label') ?? '',
      e.getAttribute('title') ?? '',
    ].join('')
  )

/** 精确文本命中：返回文本完全等于 text 的最深可见元素 */
const el =
  (text: string, selector = '*') =>
  (): Element | null => {
    const all = visible(Array.from(document.querySelectorAll(selector)))
    const t = norm(text)
    const hits = all.filter(e => {
      if (norm(e.textContent ?? '') === t) return true
      // 空文本元素（input 等）：比对 placeholder/aria-label/title
      return !(e.textContent ?? '').trim() && matchText(e) === t
    })
    // 取最深（没有子元素也命中）的那个
    for (let i = hits.length - 1; i >= 0; i--) {
      if (!hits.some((o, j) => j !== i && hits[i].contains(o))) return hits[i]
    }
    return hits[0] ?? null
  }

/** 包含文本命中（如 Radix Select 触发器内嵌占位 span） */
const elContains =
  (text: string, selector = '*') =>
  (): Element | null => {
    const all = visible(Array.from(document.querySelectorAll(selector)))
    const hits = all.filter(e => matchText(e).includes(norm(text)))
    for (let i = hits.length - 1; i >= 0; i--) {
      if (!hits.some((o, j) => j !== i && hits[i].contains(o))) return hits[i]
    }
    return hits[0] ?? null
  }

/** 程序化点击某操作（向导自动打开弹窗/切换 Tab）；业务弹窗已开则不重复点。
 *  ⚠️ 必须排除 driver.js 自己的弹层（#driver-popover-content 自带 role=dialog，
 *  否则误判为已开弹窗 → onEnter 永不点击 → 后续弹窗字段步骤全部超时卡顿） */
const hasBizDialog = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).some(
    d => !d.closest('.driver-popover') && d.id !== 'driver-popover-content'
  )

const click = (finder: () => Element | null) => () => {
  if (hasBizDialog()) return
  ;(finder() as HTMLElement | null)?.click()
}

/** 无守卫直接点击（切 Tab 等幂等操作用） */
const tap = (finder: () => Element | null) => () => {
  ;(finder() as HTMLElement | null)?.click()
}

/** 动态 placeholder 场景的稳定锚点：label 文本旁的 Radix Select 触发器。
 *  （如 files 页项目选择：进页自动选中项目后 SelectValue 显示项目名，
 *   按「选择项目」文本找必失效 → 改锚定 label「项目：」旁的 combobox） */
const comboNear = (labelText: string) => (): Element | null => {
  const label = visible(Array.from(document.querySelectorAll('span'))).find(
    e => (e.textContent ?? '').trim() === labelText
  )
  return label?.parentElement?.querySelector('button[role="combobox"]') ?? null
}

/** 业务弹窗内第 n 个下拉触发器（0 起；placeholder 动态的字段用 DOM 序锚定） */
const dialogCombo = (n: number) => (): Element | null => {
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"]')
  ).filter(
    d => !d.closest('.driver-popover') && d.id !== 'driver-popover-content'
  )
  const box = dialogs[dialogs.length - 1]
  const combos = box
    ? visible(Array.from(box.querySelectorAll('button[role="combobox"]')))
    : []
  return combos[n] ?? null
}

/** 页面工具栏第 n 个下拉触发器（0 起） */
const comboNth = (n: number) => (): Element | null =>
  visible(Array.from(document.querySelectorAll('button[role="combobox"]')))[
    n
  ] ?? null

export const WIZARDS: Wizard[] = [
  // ════════════════════════ 全流程向导（flow，跨模块跨页） ════════════════════════
  {
    id: 'flow:first-login',
    kind: 'flow',
    title: '新人上手全流程',
    desc: '第一次用系统？9 分钟跨 6 个模块走完「看板 → 项目 → 任务 → 文件 → 采购 → 消息」，建立全局地图。',
    minutes: 9,
    steps: [
      {
        route: '/',
        title: '欢迎 👋',
        desc: '这条向导会带你跨页面走完系统主干。随时点 × 退出，之后可从「向导中心」重看。',
      },
      {
        route: '/',
        element: el('工作台', 'h1'),
        title: '工作台 = 今日驾驶舱',
        desc: '登录后的首页。五张统计卡 + 催办 + 待办 + 最近项目，一眼看清「我要交付什么、被催什么」。',
      },
      {
        route: '/',
        element: el('我的催办', 'h3'),
        title: '被催的事排最前',
        desc: '别人催你的显示在这里（催我的数量会标红），点行直接跳到要交付的文件。',
      },
      {
        route: '/projects',
        element: el('项目', 'h1'),
        title: '项目列表',
        desc: '所有项目按 YYGC 编号管理（如 YYGC26034）。点卡片进详情看阶段进度；顶部搜索框可按名称/编号搜。',
      },
      {
        route: '/projects',
        element: el('新建项目', 'button'),
        title: '立项入口',
        desc: '管理员/项目经理点这里新建项目，四步完成：基本信息 → 模板 → 成员 → 预览。编号留空自动生成。',
      },
      {
        route: '/tasks',
        element: el('项目任务', 'h1'),
        title: '任务作战室',
        desc: '全公司任务多维总览（项目/部门/状态），可下钻到具体任务批注、修订、改状态。',
      },
      {
        route: '/files',
        element: el('文件目录', 'h1'),
        title: '交付物都在这',
        desc: '「交付计划」管要交什么（按条目上传/审核），「项目网盘」自由存取文件。',
      },
      {
        route: '/purchase',
        element: el('采购订单', 'h1'),
        title: '采购全流程',
        desc: '采购清单 → 分解发需求 → 下单 → 到货清点，三个 Tab 对应订单/清单/供应商需求。',
      },
      {
        route: '/messages',
        element: elContains('消息', 'a[href="/messages"]'),
        title: '消息 = 协作中枢',
        desc: '项目群 + 单聊，任务卡片、催办、@ 提醒都在这里。右上铃铛是站内通知，两者独立。',
      },
      {
        title: '通关 🎉',
        desc: '主干走完了！每个页面标题旁的「⊙ 向导」按钮可随时重播该页深度向导；遇到不会的操作点操作旁的向导按钮。',
      },
    ],
  },
  {
    id: 'flow:project-lifecycle',
    kind: 'flow',
    title: '项目全生命周期',
    desc: '从立项到交付的完整旅程：建项目 → 排阶段 → 派任务 → 交文件 → 走采购，一条线跟到底。',
    minutes: 8,
    steps: [
      {
        route: '/',
        title: '起点：立项 🚀',
        desc: '跟完这条线，你就掌握了一个项目从 0 到交付的完整打法。',
      },
      {
        route: '/projects',
        element: el('新建项目', 'button'),
        title: '① 立项',
        desc: '点「新建项目」进入四步创建向导。只有管理员/项目经理可见此按钮。',
      },
      {
        route: '/projects/new',
        element: elContains('留空自动生成', 'input'),
        title: '② 编号自动生成',
        desc: '项目编号规则 YYGC+年后两位+3位流水（如 YYGC26034）。留空即自动生成，手动输入按此格式校验。',
      },
      {
        route: '/projects/new',
        element: el('基本信息', 'h3'),
        title: '③ 基本信息',
        desc: '名称/客户/描述。客户从「外部主体」里选，没有就点「新建客户」当场建。',
      },
      {
        route: '/projects',
        element: elContains('搜索项目', 'input'),
        title: '④ 找到你的项目',
        desc: '回到列表，点项目卡片进详情。后续阶段、任务、文件、采购都在项目详情里组织。',
      },
      {
        route: '/projects/new',
        element: elContains('基本信息', 'div'),
        title: '⑤ 模板排阶段',
        desc: '创建时选流程模板（标准20步/精简10步），阶段自动排布起止时间，不用手排。',
        side: 'top',
      },
      {
        route: '/tasks',
        element: el('新建任务', 'button'),
        title: '⑥ 派任务',
        desc: '任务挂在项目+阶段下：填标题/描述，选项目→阶段→负责人。负责人会收到待办提醒。',
      },
      {
        route: '/files',
        element: el('交付计划', 'button'),
        title: '⑦ 交文件',
        desc: '交付计划列出要交的条目，负责人上传 → 审核人通过 → 状态闭环。逾期会亮红并进催办。',
      },
      {
        route: '/purchase',
        element: el('采购清单', 'button'),
        title: '⑧ 走采购',
        desc: '清单提需求 → 分解发给供应商 → 转订单 → 到货清点。统计卡可点击按状态过滤定位。',
      },
      {
        route: '/',
        element: el('总项目数', 'h3'),
        title: '闭环回到驾驶舱 🎯',
        desc: '项目进度最终汇成工作台的统计卡。全生命周期打法到此完整：立项→模板→任务→文件→采购。',
      },
    ],
  },
  {
    id: 'flow:daily-work',
    kind: 'flow',
    title: '我的每日工作流',
    desc: '每天上班 5 分钟：看板认领 → 待办销项 → 更新任务 → 提交交付，跟一遍就会。',
    minutes: 5,
    steps: [
      {
        route: '/',
        title: '每日开场 ☕',
        desc: '上班第一件事：来工作台，把「被催的」和「要交的」过一遍。',
      },
      {
        route: '/',
        element: el('我的催办', 'h3'),
        title: '先看催办',
        desc: '被催的数量标红时优先处理。点催办行直接跳到要交的文件，交完催办自动消。',
      },
      {
        route: '/',
        element: el('我的待提交', 'h3'),
        title: '再看待提交',
        desc: '等你上传的交付物清单，逾期数单独统计。点卡片直达文件页「我的」过滤视图。',
      },
      {
        route: '/todos',
        element: el('待办中心', 'h1'),
        title: '待办销项',
        desc: '催办、提醒都会沉淀成待办。处理完勾掉/删除，列表与统计实时同步。',
      },
      {
        route: '/tasks',
        element: elContains('搜索任务', 'input'),
        title: '更新我的任务',
        desc: '搜到自己的任务，点行进详情更新进度/状态/批注。完成就标完成，别让别人来催。',
      },
      {
        route: '/',
        title: '收工 ✅',
        desc: '节奏就是：催办 → 待提交 → 待办 → 任务。坚持一周就成肌肉记忆。',
      },
    ],
  },

  // ════════════════════════ 深度向导（deep，单页逐功能） ════════════════════════
  {
    id: 'deep:dashboard',
    kind: 'deep',
    title: '工作台深度导览',
    desc: '五张统计卡、催办、待办、最近项目、即将到期任务——每个区块的功能与入口逐个讲透。',
    minutes: 5,
    steps: [
      {
        route: '/',
        element: el('工作台', 'h1'),
        title: '工作台总览',
        desc: '公司项目整体概览。数据全部真实统计，卡片基本都能点。',
      },
      {
        route: '/',
        element: el('总项目数', 'h3'),
        title: '统计卡（5 张）',
        desc: '总项目数/总任务数/逾期任务/我的待提交/我的催办。点卡直接跳到对应列表（我的催办除外，见下）。',
      },
      {
        route: '/',
        element: el('逾期任务', 'h3'),
        title: '逾期要当心',
        desc: '未完成且过了截止日期的任务数。数字变红代表真的逾期了，点卡去任务列表清障。',
      },
      {
        route: '/',
        element: el('我的催办', 'h3'),
        title: '我的催办',
        desc: '上区=别人催我的（点行直达要交的文件），下区=我催别人的（可撤回）。催办闭环在文件页完成。',
      },
      {
        route: '/',
        element: elContains('最近项目', 'h3'),
        title: '最近项目',
        desc: '最新创建的项目快入口，点行进详情，不用回列表翻。',
      },
      {
        route: '/',
        element: elContains('即将到期的任务', 'h3'),
        title: '即将到期',
        desc: '快到截止日期的任务提前预警，帮你把节奏赶在催办之前。',
      },
      {
        route: '/',
        title: '深度导览完成 🎉',
        desc: '工作台就是你的每日驾驶舱。',
      },
    ],
  },
  {
    id: 'deep:projects',
    kind: 'deep',
    title: '项目列表深度导览',
    desc: '搜索、状态筛选、项目卡片、归档、新建入口——项目管理的全部入口在这一页。',
    minutes: 4,
    steps: [
      {
        route: '/projects',
        element: el('项目', 'h1'),
        title: '项目列表',
        desc: '管理和跟踪所有项目。桌面端卡片网格，移动端紧凑列表。',
      },
      {
        route: '/projects',
        element: elContains('搜索项目', 'input'),
        title: '搜索',
        desc: '按项目名称或编号模糊搜。移动端搜索框在顶部工具行。',
      },
      {
        route: '/projects',
        element: elContains('新建项目', 'button'),
        title: '新建项目',
        desc: '四步向导创建（基本信息→模板→成员→预览）。按钮仅管理员/项目经理可见。',
      },
      {
        route: '/projects',
        title: '项目卡片',
        desc: '卡片显示编号/名称/进度/状态，点任意卡进项目详情（阶段矩阵、任务、文件都在里面）。已归档项目带「已归档」徽标。',
        side: 'top',
      },
      {
        route: '/projects',
        element: elContains('工作台', 'a[href="/"]'),
        title: '小技巧：全局搜索 ⌘K',
        desc: '顶栏搜索或 Ctrl/⌘+K 可直接搜项目/任务/成员并直达，比翻列表快。',
        side: 'right',
      },
    ],
  },
  {
    id: 'deep:tasks',
    kind: 'deep',
    title: '项目任务深度导览',
    desc: '列表/总览双视图、多维筛选、搜索、新建任务弹窗逐字段——任务管理一页讲透。',
    minutes: 5,
    steps: [
      {
        route: '/tasks',
        element: el('项目任务', 'h1'),
        title: '任务作战室',
        desc: '按项目/部门/状态多维总览，可下钻到具体任务。',
      },
      {
        route: '/tasks',
        element: el('列表', 'button'),
        title: '双视图切换',
        desc: '「列表」逐条看任务明细；「总览」按项目/部门聚合看完成情况。点哪个切哪个。',
      },
      {
        route: '/tasks',
        element: elContains('搜索任务', 'input'),
        title: '搜索与筛选',
        desc: '按任务标题搜；配合项目/状态/负责人筛选快速定位。筛选区在搜索框右侧。',
      },
      {
        route: '/tasks',
        element: el('新建任务', 'button'),
        title: '新建任务',
        desc: '点开弹窗逐字段填（详情见按钮旁的操作向导）。任务必须挂在项目下，先选项目才能选阶段/负责人。',
      },
      {
        route: '/tasks',
        element: el('项目任务', 'h1'),
        title: '任务行下钻',
        desc: '点任意任务行进详情：改状态、写批注、上传附件、修订记录全在详情页。',
        side: 'top',
      },
      {
        route: '/tasks',
        title: '深度导览完成 🎉',
        desc: '任务三板斧：建得清、派得准、跟得紧。',
      },
    ],
  },
  {
    id: 'deep:purchase',
    kind: 'deep',
    title: '采购订单深度导览',
    desc: '三 Tab（订单/清单/供应商需求）、统计卡过滤、新建/追加入口——采购一页讲透。',
    minutes: 5,
    steps: [
      {
        route: '/purchase',
        element: el('采购订单', 'h1'),
        title: '采购中心',
        desc: '采购清单 → 分解发需求 → 下单 → 到货清点，全流程管理。',
      },
      {
        route: '/purchase',
        element: el('采购清单', 'button'),
        title: '三 Tab 结构',
        desc: '「采购订单」跟踪下单/到货/付款；「采购清单」成员提需求；「供应商需求」导入分解后转订单。',
      },
      {
        route: '/purchase',
        element: el('新建订单', 'button'),
        title: '新建订单 / 追加采购',
        desc: '「新建订单」开全新订单；「追加采购」向已有订单追加明细。金额无财务权限显示 —。',
      },
      {
        route: '/purchase',
        element: comboNth(0),
        title: '筛选器',
        desc: '项目/供应商/状态多维过滤，导出与跨页定位同款分块查询，大数据量也流畅。',
      },
      {
        route: '/purchase',
        element: el('采购订单', 'h1'),
        title: '统计卡可点击',
        desc: '待下单/进行中/已完成/总金额——点状态卡自动过滤列表并滚动闪烁首条（金额卡不可点）。',
        side: 'top',
      },
      {
        route: '/purchase',
        title: '深度导览完成 🎉',
        desc: '采购主线：清单→需求→订单→到货。',
      },
    ],
  },
  {
    id: 'deep:files',
    kind: 'deep',
    title: '文件目录深度导览',
    desc: '交付计划/项目网盘双 Tab、上传审核流、临时文件归位——文件交付一页讲透。',
    minutes: 5,
    steps: [
      {
        route: '/files',
        element: el('文件目录', 'h1'),
        title: '文件中心',
        desc: '先选项目，再看这个项目的所有交付物与文件。',
      },
      {
        route: '/files',
        element: comboNear('项目：'),
        title: '项目选择器',
        desc: '右上下拉选项目（编号+名称）。支持 ?projectId=xx&mine=1 等链接直达（从待办/催办跳来就是这种）。',
        side: 'left',
      },
      {
        route: '/files',
        element: el('交付计划', 'button'),
        title: '交付计划 Tab',
        desc: '列出要交的条目：负责人/截止/状态。点条目开详情抽屉上传文件，审核通过即闭环。',
      },
      {
        route: '/files',
        element: elContains('项目网盘', 'button'),
        title: '项目网盘 Tab',
        desc: '自由目录树：新建目录/上传/改名/移动/下载。目录全员可操作，整树删除仅管理角色。',
      },
      {
        route: '/files',
        // 临时文件区无临时文件时整个区块不渲染 → 不锚元素（居中卡），
        // 仅切到网盘 Tab 给背景（否则锚点必恒超时 2.5s）
        onEnter: tap(elContains('项目网盘', 'button')),
        title: '临时文件',
        desc: '聊天/工作中直接上传、没挂交付条目的文件收在这，可移动到正式目录归位。',
        side: 'top',
      },
      {
        route: '/files',
        title: '深度导览完成 🎉',
        desc: '交付主线：计划条目 → 上传 → 审核 → 闭环。',
      },
    ],
  },

  // ════════════════════════ 操作向导（op，挂在操作按钮旁） ════════════════════════
  {
    id: 'op:create-project',
    kind: 'op',
    title: '新建项目操作向导',
    desc: '逐字段带你填完立项表单：名称/编号/客户/模板/成员。',
    minutes: 3,
    steps: [
      {
        route: '/projects/new',
        element: elContains('新建项目', 'h1'),
        title: '新建项目 · 四步',
        desc: '基本信息 → 模板选择 → 成员与负责人 → 预览确认。跟着步骤条走。',
      },
      {
        route: '/projects/new',
        element: elContains('产线电气总包', 'input'),
        title: '项目名称（必填）',
        desc: '建议格式「客户+内容」，如：XX食品三期产线电气总包。好认、好搜。',
      },
      {
        route: '/projects/new',
        element: elContains('留空自动生成', 'input'),
        title: '项目编号（可留空）',
        desc: '规则 YYGC+年后两位+3位流水（YYGC26034）。留空自动生成；手填按格式校验。',
      },
      {
        route: '/projects/new',
        element: elContains('选择客户', 'button'),
        title: '客户（外部主体）',
        desc: '下拉选已建客户；没有就点旁边的「新建客户」当场建主体。',
      },
      {
        route: '/projects/new',
        element: el('基本信息', 'h3'),
        title: '后面三步',
        desc: '选模板自动排阶段 → 指派成员与负责人 → 预览确认创建。阶段起止时间由模板自动算。',
        side: 'top',
      },
    ],
  },
  {
    id: 'op:create-task',
    kind: 'op',
    title: '新建任务操作向导',
    desc: '自动打开新建任务弹窗，逐字段带你填：标题/描述/项目/阶段/负责人。',
    minutes: 2,
    steps: [
      {
        route: '/tasks',
        element: el('新建任务', 'button'),
        title: '新建任务入口',
        desc: '点这个按钮打开「新建任务」弹窗。下一步向导会自动帮你打开它。',
      },
      {
        route: '/tasks',
        element: elContains('任务标题', 'input'),
        onEnter: click(el('新建任务', 'button')),
        title: '任务标题（必填）',
        desc: '一句话说清要做什么，动词开头（如：完成三期电气图纸深化）。',
      },
      {
        route: '/tasks',
        element: elContains('任务描述', 'textarea, input'),
        title: '任务描述（可选）',
        desc: '补充验收标准、注意事项。写清楚能减少一半来回沟通。',
      },
      {
        route: '/tasks',
        element: dialogCombo(0),
        title: '选择项目（必填）',
        desc: '任务必须挂在项目下。选完项目才能选阶段和负责人。',
      },
      {
        route: '/tasks',
        element: dialogCombo(1),
        title: '选择阶段',
        desc: '阶段来自项目流程模板。挂对阶段，项目详情的阶段矩阵才能正确归位。',
      },
      {
        route: '/tasks',
        element: dialogCombo(2),
        title: '选择负责人（必填）',
        desc: '只有项目成员可选。派给他后对方待办立即收到提醒。点「创建」完成 🎉',
      },
    ],
  },
  {
    id: 'op:upload-file',
    kind: 'op',
    title: '提交交付文件操作向导',
    desc: '在交付计划里找到条目、上传文件、送审——三步闭环。',
    minutes: 2,
    steps: [
      {
        route: '/files',
        element: comboNear('项目：'),
        title: '先选项目',
        desc: '右上下拉选中你要交付的项目。',
        side: 'left',
      },
      {
        route: '/files',
        element: el('交付计划', 'button'),
        title: '打开交付计划',
        desc: '「交付计划」Tab 列出该项目要交的全部条目，认领到你名下的排在前面。',
      },
      {
        route: '/files',
        element: el('交付计划', 'button'),
        title: '点条目 → 上传',
        desc: '点要交的条目打开详情抽屉，拖文件进去即上传。上传后状态变「已提交」等审核。',
        side: 'bottom',
      },
      {
        route: '/',
        element: el('我的待提交', 'h3'),
        title: '闭环验证 ✅',
        desc: '回到工作台，「我的待提交」里已提交数 +1。审核人通过后该条目闭环，催办同步消除。',
      },
    ],
  },
  {
    id: 'op:create-order',
    kind: 'op',
    title: '采购下单操作向导',
    desc: '新建订单/追加采购怎么用，三 Tab 数据怎么流转。',
    minutes: 2,
    steps: [
      {
        route: '/purchase',
        element: el('采购订单', 'h1'),
        title: '采购入口',
        desc: '三种发起方式：直接下订单、清单提需求、供应商需求转单。',
      },
      {
        route: '/purchase',
        element: el('新建订单', 'button'),
        title: '新建订单',
        desc: '已定供应商/价格的直接开单：选项目 → 填明细 → 保存即生成订单号（CG-…）。',
      },
      {
        route: '/purchase',
        element: el('追加采购', 'button'),
        title: '追加采购',
        desc: '给已有订单补明细用（同供应商续订场景），订单号不变。',
      },
      {
        route: '/purchase',
        element: el('采购清单', 'button'),
        title: '清单 → 需求 → 订单',
        desc: '不确定规格时先在「采购清单」提需求，采购在「供应商需求」分解发询价，最后转成订单。',
      },
    ],
  },
]

/** 按 id 取向导 */
export const getWizard = (id: string): Wizard | undefined =>
  WIZARDS.find(w => w.id === id)

/** 首登自动推荐的向导 */
export const FIRST_RUN_WIZARD_ID = 'flow:first-login'
