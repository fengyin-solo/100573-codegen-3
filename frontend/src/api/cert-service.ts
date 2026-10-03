/**
 * 持证与培训考核台账的业务操作：
 * - 台账保存执行「超期未复审不得保存为合格」的硬性校验；
 * - 考核提交按「工号 + 期次」去重，同一人重复提交只留一条；
 * - 成绩由班组审定后回填，认定口径沿用 rules.ts；
 * - 按资格等级导出清册，当期无人的等级在文件中附说明，不产生空文件；
 * - 复审判定结论为工作票许可的待签发清单提供依据。
 */
import {
  listAssessments,
  listHolders,
  resetAssessments,
  resetHolders,
  saveAssessments,
  saveHolders,
} from '@/data/cert/store'
import {
  assessVerdict,
  checkReview,
  currentPeriodLabel,
  isCertQualified,
  todayValue,
  validateCertSave,
} from '@/data/cert/rules'
import type { AssessRecord, CertHolder } from '@/data/cert/types'
import type { AssessAuditStatus, QualificationLevel, ReviewState } from '@/data/cert/rules'

export type ActionResult = { ok: boolean; message: string; merged?: boolean }

export type HolderView = CertHolder & {
  复审状态: ReviewState
  剩余天数: number
  判定结果: '合格' | '不合格'
  考核认定: '合格' | '不合格' | '待审定' | '未考核'
}

export type AssessView = AssessRecord & {
  认定结果: '合格' | '不合格'
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

function latestVerdictFor(工号: string): '合格' | '不合格' | '待审定' | '未考核' {
  const mine = listAssessments().filter((row) => row.工号 === 工号)
  if (mine.length === 0) {
    return '未考核'
  }
  // 按期次字符串（年年年年年第n季度）排序取最近一次审定结论。
  const latest = [...mine].sort((a, b) => b.期次.localeCompare(a.期次))[0]
  if (latest.审定状态 === '待审定') {
    return '待审定'
  }
  return assessVerdict(latest)
}

export function getHolders(): HolderView[] {
  const now = new Date()
  return listHolders().map((row) => {
    const review = checkReview(row.复审日期, now)
    return {
      ...row,
      复审状态: review.state,
      剩余天数: review.daysLeft,
      判定结果: isCertQualified({ 复审日期: row.复审日期, 持证状态: row.持证状态, now })
        ? '合格'
        : '不合格',
      考核认定: latestVerdictFor(row.工号),
    }
  })
}

export function getAssessments(): AssessView[] {
  return listAssessments().map((row) => ({ ...row, 认定结果: assessVerdict(row) }))
}

export function findHolderByName(姓名: string): CertHolder | undefined {
  return listHolders().find((row) => row.姓名 === 姓名)
}

/** 台账统一校验：字段必填 + 复审硬性规则。 */
function validateHolder(input: Omit<CertHolder, 'id'>): string | null {
  const required: [keyof Omit<CertHolder, 'id'>, string][] = [
    ['工号', '工号'],
    ['姓名', '姓名'],
    ['资格等级', '资格等级'],
    ['持证项目', '持证项目'],
    ['复审日期', '复审日期'],
  ]
  for (const [field, label] of required) {
    if (String(input[field] ?? '').trim() === '') {
      return `${label}不能为空`
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.复审日期)) {
    return '复审日期格式应为 yyyy-MM-dd'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.发证日期)) {
    return '发证日期格式应为 yyyy-MM-dd'
  }
  return validateCertSave(input)
}

export function createHolder(input: Omit<CertHolder, 'id'>): ActionResult {
  const error = validateHolder(input)
  if (error) {
    return { ok: false, message: error }
  }
  const rows = listHolders()
  if (rows.some((row) => row.工号 === input.工号)) {
    return { ok: false, message: `工号 ${input.工号} 已建立持证台账，一人只允许一条` }
  }
  saveHolders([...rows, { ...input, id: nextId(rows) }])
  return { ok: true, message: `已登记 ${input.姓名} 的持证台账` }
}

export function updateHolder(id: number, input: Omit<CertHolder, 'id'>): ActionResult {
  const rows = listHolders()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该持证记录' }
  }
  const error = validateHolder(input)
  if (error) {
    return { ok: false, message: error }
  }
  const duplicated = rows.some((row) => row.id !== id && row.工号 === input.工号)
  if (duplicated) {
    return { ok: false, message: `工号 ${input.工号} 已被其他人员占用` }
  }
  const next = [...rows]
  next[index] = { ...input, id }
  saveHolders(next)
  return { ok: true, message: `已更新 ${input.姓名} 的持证台账` }
}

export function deleteHolder(id: number): ActionResult {
  const rows = listHolders()
  const target = rows.find((row) => row.id === id)
  if (!target) {
    return { ok: false, message: '没有找到该持证记录' }
  }
  saveHolders(rows.filter((row) => row.id !== id))
  return { ok: true, message: `已删除 ${target.姓名} 的持证台账` }
}

/** 培训考核提交：同一人同一期次重复提交时覆盖旧记录，只留一条。 */
export function submitAssessment(input: Omit<AssessRecord, 'id' | '审定状态' | '审定人' | '审定日期'>): ActionResult {
  if (!input.工号.trim() || !input.姓名.trim()) {
    return { ok: false, message: '工号与姓名不能为空' }
  }
  if (!input.期次.trim()) {
    return { ok: false, message: '考核期次不能为空' }
  }
  if (input.理论成绩 === '' || input.实操成绩 === '') {
    return { ok: false, message: '理论、实操成绩都要填写（百分制）' }
  }
  if (input.理论成绩 < 0 || input.理论成绩 > 100 || input.实操成绩 < 0 || input.实操成绩 > 100) {
    return { ok: false, message: '成绩需在 0～100 分之间' }
  }
  const rows = listAssessments()
  const index = rows.findIndex((row) => row.工号 === input.工号 && row.期次 === input.期次)
  if (index >= 0) {
    const next = [...rows]
    next[index] = {
      ...next[index],
      ...input,
      // 重新提交后回到待审定，成绩以本次为准，旧结论一并失效。
      审定状态: '待审定',
      审定人: '',
      审定日期: '',
    }
    saveAssessments(next)
    return { ok: true, message: `${input.姓名} 在 ${input.期次} 已有考核记录，已按本次提交覆盖，只保留一条`, merged: true }
  }
  saveAssessments([
    ...rows,
    { ...input, id: nextId(rows), 审定状态: '待审定', 审定人: '', 审定日期: '' },
  ])
  return { ok: true, message: `已登记 ${input.姓名} 的培训考核，等待班组审定` }
}

/** 班组审定后回填：沿用既有认定口径（双科≥80 且审定通过）。 */
export function auditAssessment(id: number, status: AssessAuditStatus, auditor: string): ActionResult {
  if (status !== '审定通过' && status !== '审定退回') {
    return { ok: false, message: '审定结论只能是审定通过或审定退回' }
  }
  const rows = listAssessments()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该考核记录' }
  }
  if (rows[index].审定状态 === status) {
    return { ok: false, message: `该记录已经是「${status}」，不用重复审定` }
  }
  const next = [...rows]
  next[index] = {
    ...next[index],
    审定状态: status,
    审定人: auditor.trim() || '班组审定',
    审定日期: status === '审定通过' || status === '审定退回' ? todayValue() : '',
  }
  saveAssessments(next)
  const verdict = assessVerdict(next[index])
  return { ok: true, message: `已回填审定意见：${status}，认定结果「${verdict}」` }
}

export function deleteAssessment(id: number): ActionResult {
  const rows = listAssessments()
  const target = rows.find((row) => row.id === id)
  if (!target) {
    return { ok: false, message: '没有找到该考核记录' }
  }
  saveAssessments(rows.filter((row) => row.id !== id))
  return { ok: true, message: `已删除 ${target.姓名} 的考核记录` }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const ROSTER_COLUMNS = [
  '序号',
  '工号',
  '姓名',
  '资格等级',
  '持证项目',
  '证书编号',
  '复审日期',
  '复审状态',
  '考核认定',
  '判定结果',
]

export type RosterResult = {
  filename: string
  level: QualificationLevel
  count: number
  content: string
  empty: boolean
}

/**
 * 按资格等级打包导出清册。
 * 当期该等级无人时，文件只含表头与一段说明（不产出空文件），并照常触发下载。
 */
export function buildLevelRoster(level: QualificationLevel, now: Date = new Date()): RosterResult {
  const holders = getHolders().filter((row) => row.资格等级 === level)
  const period = currentPeriodLabel(now)
  const madeAt = todayValue(now)
  const lines: string[] = [
    `继保人员持证清册（${level}）`,
    `所属班组：继电保护班,期次：${period},编制日期：${madeAt},在册人数：${holders.length}`,
    ROSTER_COLUMNS.map(csvCell).join(','),
  ]
  if (holders.length === 0) {
    lines.push(
      `说明：${period}继电保护班无${level}资格等级持证人员，本清册当期无人可列；如检查需要，请改选其他资格等级导出。`,
    )
  } else {
    holders.forEach((row, index) => {
      const stateText =
        row.复审状态 === '即将到期'
          ? `即将到期（剩${row.剩余天数}天）`
          : row.复审状态 === '超期未复审'
            ? `超期未复审（超${Math.abs(row.剩余天数)}天）`
            : '合格'
      lines.push(
        [
          index + 1,
          row.工号,
          row.姓名,
          row.资格等级,
          row.持证项目,
          row.证书编号,
          row.复审日期,
          stateText,
          row.考核认定,
          row.判定结果,
        ]
          .map(csvCell)
          .join(','),
      )
    })
  }
  return {
    filename: `继保人员持证清册-${level}-${period}.csv`,
    level,
    count: holders.length,
    content: `\uFEFF${lines.join('\n')}`,
    empty: holders.length === 0,
  }
}

export function downloadRoster(level: QualificationLevel): RosterResult {
  const result = buildLevelRoster(level)
  const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return result
}

export function resetCertData(): void {
  resetHolders()
  resetAssessments()
}

export type PermitBlock = {
  负责人: string
  原因: string
}

/**
 * 工作票许可联动：返回某工作负责人能否签发及原因。
 * 复审判定不合格（超期未复审/复审不合格/已注销）即拦截，驱动待签发清单。
 */
export function checkPermitHolder(负责人: string, now: Date = new Date()): PermitBlock | null {
  const holder = findHolderByName(负责人)
  if (!holder) {
    return { 负责人, 原因: '未在继保持证台账中查到该负责人，资格无法核实' }
  }
  const review = checkReview(holder.复审日期, now)
  if (holder.持证状态 === '复审不合格') {
    return { 负责人, 原因: `复审判定不合格（${holder.复审日期} 复审未通过），不得担任工作负责人` }
  }
  if (holder.持证状态 === '已注销') {
    return { 负责人, 原因: `持证已注销（${holder.复审日期}），不得签发工作票` }
  }
  if (review.state === '超期未复审') {
    return { 负责人, 原因: `复审日期 ${holder.复审日期} 已超期未复审，复审判定不合格，不得签发` }
  }
  return null
}
