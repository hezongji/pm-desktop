/**
 * 组织架构数据服务（API 路由共用）—— 依据《开发文档-项目管理系统重构》§7.2
 */

import { prisma } from '@/lib/prisma'
import { buildDeptTree, DeptNode } from '@/lib/org-tree'
import type { GlobalRole } from '@prisma/client'

/** 未分配部门成员的虚拟节点 id（20260921：无部门成员此前在所有人选择器中不可见） */
export const UNASSIGNED_DEPT_ID = '__unassigned__'

/** 拉全量部门 + 直属在职成员 → 部门树（51 人量级一次查完） */
export async function loadDeptTree(): Promise<DeptNode[]> {
  const [records, managers, unassigned] = await Promise.all([
    prisma.department.findMany({
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: {
        members: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            email: true,
            jobTitle: true,
            duties: true,
            phone: true,
            avatar: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
    // 未分配部门的在职成员：挂在虚拟「未分配」根节点下，
    // 保证项目创建/任务创建/阶段负责人等所有选人处都能看到他们
    prisma.user.findMany({
      where: { isActive: true, departmentId: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        jobTitle: true,
        duties: true,
        phone: true,
        avatar: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    }),
  ])
  const managerNameById = new Map(managers.map(m => [m.id, m.name]))
  const tree = buildDeptTree(records, managerNameById)
  if (unassigned.length > 0) {
    tree.push({
      id: UNASSIGNED_DEPT_ID,
      name: '未分配',
      parentId: null,
      sort: 999,
      managerId: null,
      manager: null,
      memberCount: unassigned.length,
      members: unassigned.map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
        jobTitle: m.jobTitle,
        duties: m.duties,
        phone: m.phone,
        avatar: m.avatar,
        role: m.role as GlobalRole,
        isActive: m.isActive,
        createdAt: m.createdAt,
      })),
      children: [],
    })
  }
  return tree
}
