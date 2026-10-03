/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 按资格等级打包导出的持证清册：当期无人时 empty 为 true，content 里带说明而不是空表。
export type CertRosterResult = {
  filename: string
  content: string
  grade: string
  count: number
  empty: boolean
  note: string
  generatedAt: string
}

// 工作票许可「待签发清单」里每一行附带的持证联审结论。
export type PermitIssuanceRow = {
  id: number
  工作票号: string
  工作任务: string
  所属变电站: string
  工作负责人: string
  工号: string
  资格等级: string
  持证项目: string
  复审日期: string
  持证状态: string
  blocked: boolean
  reason: string
}
