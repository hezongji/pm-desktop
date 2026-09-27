// seed-baseline.ts — 开源版基线：仅系统字典(岗位/费用分类/流程模板) + 初始管理员
// 常量段 1:1 抽自 seed.ts(2026-09-14 @ a0007ff)，不跑员工/部门/历史项目/虚构主体/演示项目
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// ═══════════ §10.1 岗位字典（13）═══════════
const JOB_TITLES = [
  '商务经理',
  '技术负责人',
  '工艺工程师',
  '电气工程师',
  '机械工程师',
  '采购专员',
  '生产主管',
  '物流专员',
  '现场工程师',
  '调试工程师',
  '售后工程师',
  '资料员',
  '项目经理',
]

// ═══════════ §10.2 标准流程模板（20 阶段）═══════════
// 每条 deliverable: { name, required, purpose, scope }
type Deliverable = {
  name: string
  required: boolean
  purpose: string
  scope: string
}
const STAGES_20: {
  order: number
  name: string
  ownerJobTitle: string
  deliverables: Deliverable[]
}[] = [
  {
    order: 1,
    name: '商务',
    ownerJobTitle: '商务经理',
    deliverables: [
      { name: '拜访记录', required: true, purpose: '存档', scope: 'PUBLIC' },
      {
        name: '客户需求纪要',
        required: true,
        purpose: '存档',
        scope: 'PUBLIC',
      },
    ],
  },
  {
    order: 2,
    name: '方案设计',
    ownerJobTitle: '技术负责人',
    deliverables: [
      {
        name: '技术方案书',
        required: true,
        purpose: '报审',
        scope: 'RESTRICTED',
      },
      { name: '报价单', required: true, purpose: '存档', scope: 'PRIVATE' },
    ],
  },
  {
    order: 3,
    name: '项目签订',
    ownerJobTitle: '商务经理',
    deliverables: [
      { name: '合同', required: true, purpose: '存档', scope: 'PRIVATE' },
      {
        name: '技术协议',
        required: true,
        purpose: '存档',
        scope: 'RESTRICTED',
      },
    ],
  },
  {
    order: 4,
    name: '工艺设计',
    ownerJobTitle: '工艺工程师',
    deliverables: [
      {
        name: '工艺流程图',
        required: true,
        purpose: '报审',
        scope: 'RESTRICTED',
      },
      { name: 'PFMEA', required: false, purpose: '存档', scope: 'RESTRICTED' },
    ],
  },
  {
    order: 5,
    name: '电气设计',
    ownerJobTitle: '电气工程师',
    deliverables: [
      {
        name: '电气原理图',
        required: true,
        purpose: '报审',
        scope: 'RESTRICTED',
      },
      {
        name: '元件清单',
        required: true,
        purpose: '采购依据',
        scope: 'PUBLIC',
      },
      { name: 'PLC程序', required: true, purpose: '存档', scope: 'RESTRICTED' },
    ],
  },
  {
    order: 6,
    name: '容器设计',
    ownerJobTitle: '机械工程师',
    deliverables: [
      {
        name: '容器图纸',
        required: true,
        purpose: '报审',
        scope: 'RESTRICTED',
      },
      {
        name: '三维模型',
        required: false,
        purpose: '存档',
        scope: 'RESTRICTED',
      },
    ],
  },
  {
    order: 7,
    name: '采购',
    ownerJobTitle: '采购专员',
    deliverables: [
      { name: '采购订单', required: true, purpose: '存档', scope: 'PRIVATE' },
      {
        name: '到货计划',
        required: true,
        purpose: '施工依据',
        scope: 'PUBLIC',
      },
    ],
  },
  {
    order: 8,
    name: '车间生产',
    ownerJobTitle: '生产主管',
    deliverables: [
      { name: '生产计划', required: true, purpose: '存档', scope: 'PUBLIC' },
      { name: '工序记录', required: true, purpose: '存档', scope: 'PUBLIC' },
    ],
  },
  {
    order: 9,
    name: '电柜制作',
    ownerJobTitle: '电气工程师',
    deliverables: [
      {
        name: '线束表',
        required: true,
        purpose: '施工依据',
        scope: 'RESTRICTED',
      },
      {
        name: '检验记录',
        required: true,
        purpose: '存档',
        scope: 'RESTRICTED',
      },
    ],
  },
  {
    order: 10,
    name: '发货',
    ownerJobTitle: '物流专员',
    deliverables: [
      { name: '装箱单', required: true, purpose: '客户交付', scope: 'PUBLIC' },
      { name: '发运记录', required: true, purpose: '存档', scope: 'PUBLIC' },
    ],
  },
  {
    order: 11,
    name: '现场机械安装',
    ownerJobTitle: '现场工程师',
    deliverables: [
      { name: '安装记录', required: true, purpose: '存档', scope: 'PUBLIC' },
    ],
  },
  {
    order: 12,
    name: '现场电气安装',
    ownerJobTitle: '电气工程师',
    deliverables: [
      {
        name: '接线核对记录',
        required: true,
        purpose: '存档',
        scope: 'RESTRICTED',
      },
    ],
  },
  {
    order: 13,
    name: '现场调试',
    ownerJobTitle: '调试工程师',
    deliverables: [
      {
        name: '调试报告',
        required: true,
        purpose: '客户交付',
        scope: 'PUBLIC',
      },
    ],
  },
  {
    order: 14,
    name: '客户培训',
    ownerJobTitle: '现场工程师',
    deliverables: [
      { name: '培训签到表', required: true, purpose: '存档', scope: 'PUBLIC' },
      {
        name: '培训资料',
        required: true,
        purpose: '客户交付',
        scope: 'PUBLIC',
      },
    ],
  },
  {
    order: 15,
    name: '陪产',
    ownerJobTitle: '现场工程师',
    deliverables: [
      { name: '陪产记录', required: true, purpose: '存档', scope: 'PUBLIC' },
    ],
  },
  {
    order: 16,
    name: '项目验收',
    ownerJobTitle: '项目经理',
    deliverables: [
      { name: '验收单', required: true, purpose: '存档', scope: 'PRIVATE' },
    ],
  },
  {
    order: 17,
    name: '竣工资料',
    ownerJobTitle: '资料员',
    deliverables: [
      {
        name: '竣工资料包',
        required: true,
        purpose: '客户交付',
        scope: 'PUBLIC',
      },
      { name: '归档清单', required: true, purpose: '存档', scope: 'PRIVATE' },
    ],
  },
  {
    order: 18,
    name: '结清尾款',
    ownerJobTitle: '商务经理',
    deliverables: [
      { name: '收款凭证', required: true, purpose: '存档', scope: 'PRIVATE' },
    ],
  },
  {
    order: 19,
    name: '售后服务',
    ownerJobTitle: '售后工程师',
    deliverables: [
      { name: '服务记录', required: false, purpose: '存档', scope: 'PUBLIC' },
    ],
  },
  {
    order: 20,
    name: '项目归档',
    ownerJobTitle: '项目经理',
    deliverables: [
      { name: '归档核对表', required: true, purpose: '存档', scope: 'PRIVATE' },
    ],
  },
]

// 精简 10 步模板（1,2,3,5,7,9,13,16,18,20）
const SLIM_ORDER = [1, 2, 3, 5, 7, 9, 13, 16, 18, 20]
const STAGES_10 = STAGES_20.filter(s => SLIM_ORDER.includes(s.order)).map(
  (s, i) => ({
    ...s,
    order: i + 1,
  })
)

// ═══════════ §10.4 费用分类字典（11 类，isSystem）═══════════
const EXPENSE_CATEGORIES: { name: string; code: string; sort: number }[] = [
  { name: '差旅费', code: 'TRIP', sort: 1 },
  { name: '物流快递费', code: 'LOGISTICS', sort: 2 },
  { name: '现场采购费', code: 'SITE_PURCHASE', sort: 3 },
  { name: '招待费', code: 'RECEPTION', sort: 4 },
  { name: '租赁费', code: 'RENTAL', sort: 5 },
  { name: '维修费', code: 'REPAIR', sort: 6 },
  { name: '通讯费', code: 'TELECOM', sort: 7 },
  { name: '办公费', code: 'OFFICE', sort: 8 },
  { name: '保险费', code: 'INSURANCE', sort: 9 },
  { name: '检测费', code: 'INSPECTION', sort: 10 },
  { name: '其他', code: 'OTHER', sort: 11 },
]

const ADMIN = {
  email: 'admin@pm.local',
  username: 'admin',
  name: '系统管理员',
  password: 'Admin@123456',
}

async function main() {
  // 1. 岗位字典（13）
  for (let i = 0; i < JOB_TITLES.length; i++) {
    await prisma.jobTitle.upsert({
      where: { name: JOB_TITLES[i] },
      update: { sort: i },
      create: { name: JOB_TITLES[i], sort: i },
    })
  }

  // 2. 费用分类字典（11 类，isSystem）
  for (let i = 0; i < EXPENSE_CATEGORIES.length; i++) {
    await prisma.expenseCategory.upsert({
      where: { code: EXPENSE_CATEGORIES[i].code },
      update: {
        name: EXPENSE_CATEGORIES[i].name,
        sort: EXPENSE_CATEGORIES[i].sort,
        isSystem: true,
        isActive: true,
      },
      create: {
        name: EXPENSE_CATEGORIES[i].name,
        code: EXPENSE_CATEGORIES[i].code,
        sort: EXPENSE_CATEGORIES[i].sort,
        isSystem: true,
      },
    })
  }

  // 3. 流程模板（标准20步 isDefault + 精简10步）
  async function seedTemplate(
    name: string,
    isDefault: boolean,
    stages: typeof STAGES_20
  ) {
    const existing = await prisma.processTemplate.findFirst({ where: { name } })
    if (existing) return existing
    return prisma.processTemplate.create({
      data: {
        name,
        isDefault,
        stages: {
          create: stages.map(s => ({
            name: s.name,
            order: s.order,
            ownerJobTitle: s.ownerJobTitle,
            deliverables: s.deliverables,
          })),
        },
      },
    })
  }
  await seedTemplate('标准交付流程20步', true, STAGES_20)
  await seedTemplate('精简流程10步', false, STAGES_10)

  // 4. 初始管理员（幂等）
  const pwdHash = await bcrypt.hash(ADMIN.password, 10)
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { role: 'ADMIN', isActive: true, mustChangePassword: false },
    create: {
      email: ADMIN.email,
      username: ADMIN.username,
      password: pwdHash,
      name: ADMIN.name,
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
    },
  })

  console.log(
    '✓ 基线种子完成: 岗位13 + 费用分类11 + 流程模板2 + 管理员',
    admin.email
  )
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
