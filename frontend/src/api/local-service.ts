import {
  CERT_GRADES,
  CERT_STATUS,
  EXAM_EXCELLENT_SCORE,
  EXAM_FULL_SCORE,
  EXAM_PASS_SCORE,
  EXAM_STATUS,
  REVIEW_REMIND_DAYS,
  REVIEW_RENEW_YEARS,
  type CertGrade,
  type CertStatusValue,
} from '@/data/cert-policy'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CertRosterResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PermitIssuanceRow,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const CERT_KEY = 'certledger'
// 合格清册收录的持证状态：临期仍属当期有效，列入并提示；超期、不合格不列入。
const ROSTER_VALID_STATUSES: CertStatusValue[] = [CERT_STATUS.valid, CERT_STATUS.expiring]
const PERMIT_BLOCK_STATUSES: CertStatusValue[] = [CERT_STATUS.overdue, CERT_STATUS.reviewFailed]

// ---- 日期：统一按「日」比较，UTC 正午解析，避免本地时区把日期拨前一天 ----

function dayStamp(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function resolveToday(today?: string): string {
  return today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : dayStamp(new Date())
}

function parseDay(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1)
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / 86_400_000)
}

function addYearsStamp(value: string, years: number): string {
  const [y, m, d] = value.split('-').map(Number)
  return dayStamp(new Date(y + years, m - 1, d))
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === 'workpermit' && action === '签发许可') {
    const gate = listPermitIssuance().find((item) => item.id === id)
    if (!gate) {
      return { ok: false, message: '该工作票不在待签发清单中，不能签发' }
    }
    if (gate.blocked) {
      return { ok: false, message: `持证联审不通过：${gate.reason}` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ---- 继保人员持证与培训考核台账 ----

// 持证判定口径：班组审定不合格优先；其次按复审日期，过期即超期，到期前三十天（含）为即将到期。
export function deriveCertStatus(row: EntryRow, today = resolveToday()): CertStatusValue {
  if (String(row['审定结论'] ?? '') === '不合格') {
    return CERT_STATUS.reviewFailed
  }
  const reviewAt = String(row['复审日期'] ?? '')
  if (!reviewAt || !/^\d{4}-\d{2}-\d{2}$/.test(reviewAt)) {
    return CERT_STATUS.valid
  }
  const diff = daysBetween(today, reviewAt)
  if (diff < 0) {
    return CERT_STATUS.overdue
  }
  if (diff <= REVIEW_REMIND_DAYS) {
    return CERT_STATUS.expiring
  }
  return CERT_STATUS.valid
}

// 读取时统一重算 status/pending/abnormal：复审日期是唯一数据源，台账与导出清册永远一致。
function normalizeCertRow(row: EntryRow, today: string): EntryRow {
  const status = deriveCertStatus(row, today)
  return {
    ...row,
    status,
    pending: status !== CERT_STATUS.valid,
    abnormal: status === CERT_STATUS.overdue || status === CERT_STATUS.reviewFailed,
  }
}

export function listCertLedger(
  filters: Record<string, string> = {},
  today?: string,
): PageResult & { gradeCounts: Record<string, number> } {
  const day = resolveToday(today)
  const normalized = listRows(CERT_KEY).map((row) => normalizeCertRow(row, day))
  const matched = filterRows(normalized, filters)
  const gradeCounts: Record<string, number> = {}
  for (const grade of CERT_GRADES) {
    gradeCounts[grade] = normalized.filter((row) => String(row['资格等级']) === grade).length
  }
  return {
    items: matched,
    total: matched.length,
    page: 1,
    size: matched.length,
    gradeCounts,
  }
}

function persistCertRows(rows: EntryRow[], today: string): void {
  saveRows(CERT_KEY, rows.map((row) => normalizeCertRow(row, today)))
}

function findCertIndex(rows: EntryRow[], key: string): number {
  return rows.findIndex(
    (row) => String(row.id) === key || String(row['工号'] ?? '') === key,
  )
}

// 新建持证台账记录。超期未复审的不允许保存成合格——初建即落在过期日期上会被拦下。
export function createCertEntry(
  input: Record<string, string | number>,
  today?: string,
): ActionResult {
  const day = resolveToday(today)
  const name = String(input['姓名'] ?? '').trim()
  const code = String(input['工号'] ?? '').trim()
  const grade = String(input['资格等级'] ?? '').trim()
  const reviewAt = String(input['复审日期'] ?? '').trim()
  if (!name || !code || !grade) {
    return { ok: false, message: '工号、姓名、资格等级为必填项，不能保存' }
  }
  if (!CERT_GRADES.includes(grade as CertGrade)) {
    return { ok: false, message: `资格等级必须是 ${CERT_GRADES.join('、')} 之一` }
  }
  if (reviewAt && !/^\d{4}-\d{2}-\d{2}$/.test(reviewAt)) {
    return { ok: false, message: '复审日期格式应为 YYYY-MM-DD' }
  }
  const rows = listRows(CERT_KEY)
  if (rows.some((row) => String(row['工号'] ?? '') === code)) {
    return { ok: false, message: `工号 ${code} 已建台账，不能重复建档` }
  }
  const draft: EntryRow = {
    id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    status: CERT_STATUS.valid,
    pending: false,
    abnormal: false,
    工号: code,
    姓名: name,
    资格等级: grade,
    持证项目: String(input['持证项目'] ?? '').trim(),
    初证日期: String(input['初证日期'] ?? '').trim() || day,
    复审日期: reviewAt,
    考核成绩: '',
    考核状态: '未提交',
    审定结论: '',
    审定日期: '',
  }
  const derived = normalizeCertRow(draft, day)
  if (derived.status === CERT_STATUS.overdue) {
    return { ok: false, message: `复审日期 ${reviewAt} 已超期，超期未复审不允许保存成合格，请先办理复审` }
  }
  persistCertRows([...rows, draft], day)
  return { ok: true, message: `已为 ${name}（${grade}）建立持证台账，当前「${derived.status}」` }
}

// 同一人重复提交考核只留一条：按工号定位原记录覆盖成绩，不新增行；已审定的需重新走审定。
export function submitCertExam(
  code: string,
  score: number,
  today?: string,
): ActionResult {
  const day = resolveToday(today)
  if (!Number.isFinite(score) || score < 0 || score > EXAM_FULL_SCORE) {
    return { ok: false, message: `考核成绩须为 0-${EXAM_FULL_SCORE} 之间的数字` }
  }
  const rows = listRows(CERT_KEY)
  const index = findCertIndex(rows, code)
  if (index < 0) {
    return { ok: false, message: `没有找到工号为 ${code} 的持证人员` }
  }
  rows[index] = {
    ...rows[index],
    考核成绩: Math.round(score),
    考核状态: EXAM_STATUS.pendingReview,
    审定结论: '',
    审定日期: '',
  }
  persistCertRows(rows, day)
  return { ok: true, message: `${rows[index]['姓名']}的考核成绩 ${Math.round(score)} 已提交，待班组审定` }
}

// 班组审定后回填，沿用既有认定口径：80 分合格、90 分及以上优秀；超期未复审不允许审定为合格。
export function finalizeCertExam(
  code: string,
  passed: boolean,
  reviewer: string,
  today?: string,
): ActionResult {
  const day = resolveToday(today)
  const rows = listRows(CERT_KEY)
  const index = findCertIndex(rows, code)
  if (index < 0) {
    return { ok: false, message: `没有找到工号为 ${code} 的持证人员` }
  }
  const score = Number(rows[index]['考核成绩'])
  if (!String(rows[index]['考核成绩'] ?? '').trim()) {
    return { ok: false, message: `${rows[index]['姓名']}尚未提交考核成绩，不能审定` }
  }
  if (rows[index]['考核状态'] === EXAM_STATUS.qualified || rows[index]['考核状态'] === EXAM_STATUS.failed) {
    return { ok: false, message: `${rows[index]['姓名']}的考核已审定，需重新提交成绩才能再次审定` }
  }
  const cardStatus = deriveCertStatus({ ...rows[index], 审定结论: '' }, day)
  if (passed) {
    if (score < EXAM_PASS_SCORE) {
      return {
        ok: false,
        message: `成绩 ${score} 分低于合格线 ${EXAM_PASS_SCORE} 分，按既有口径不能审定为合格`,
      }
    }
    if (cardStatus === CERT_STATUS.overdue) {
      return { ok: false, message: '该人员复审已超期，超期未复审不允许审定为合格，请先办理复审' }
    }
  }
  const conclusion = !passed ? '不合格' : score >= EXAM_EXCELLENT_SCORE ? '优秀' : '合格'
  rows[index] = {
    ...rows[index],
    考核状态: passed ? EXAM_STATUS.qualified : EXAM_STATUS.failed,
    审定结论: conclusion,
    审定日期: day,
    审定人: reviewer || '班组',
  }
  persistCertRows(rows, day)
  return {
    ok: true,
    message: `班组审定完成：${rows[index]['姓名']} ${score} 分，认定结论「${conclusion}」`,
  }
}

// 复审办理：仅受理当前证仍有效的人员（临期可提前复审）；通过后续期三年并视为合格。
export function renewCertReview(code: string, reviewer: string, today?: string): ActionResult {
  const day = resolveToday(today)
  const rows = listRows(CERT_KEY)
  const index = findCertIndex(rows, code)
  if (index < 0) {
    return { ok: false, message: `没有找到工号为 ${code} 的持证人员` }
  }
  const current = normalizeCertRow(rows[index], day)
  const currentStatus = String(current.status)
  if (currentStatus === CERT_STATUS.reviewFailed) {
    return { ok: false, message: `${current['姓名']}复审结论不合格，须重新培训考核合格后方可办理复审` }
  }
  const score = Number(current['考核成绩'])
  if (currentStatus === CERT_STATUS.overdue && (!score || score < EXAM_PASS_SCORE)) {
    return {
      ok: false,
      message: `${current['姓名']}超期未复审，须重新考核且成绩不低于 ${EXAM_PASS_SCORE} 分后才能续期`,
    }
  }
  const nextReview = addYearsStamp(day, REVIEW_RENEW_YEARS)
  rows[index] = {
    ...rows[index],
    复审日期: nextReview,
    复审记录: `${day} ${reviewer || '班组'}办理复审，有效期至 ${nextReview}`,
  }
  persistCertRows(rows, day)
  return { ok: true, message: `${current['姓名']}复审通过，复审日期续至 ${nextReview}` }
}

// ---- 按资格等级打包导出持证清册（复审日期与台账同源，直接取台账字段） ----

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const ROSTER_COLUMNS = ['序号', '工号', '姓名', '资格等级', '持证项目', '复审日期', '持证状态']

function rosterRowsOfGrade(rows: EntryRow[], grade: CertGrade, today: string): EntryRow[] {
  return rows
    .filter((row) => String(row['资格等级']) === grade)
    .map((row) => normalizeCertRow(row, today))
    .filter((row) => ROSTER_VALID_STATUSES.includes(row.status as CertStatusValue))
    .sort((a, b) => String(a['复审日期']).localeCompare(String(b['复审日期'])))
}

function rosterCsv(
  grades: CertGrade[],
  rows: EntryRow[],
  today: string,
): Pick<CertRosterResult, 'content' | 'count' | 'empty' | 'note'> {
  const lines: string[] = []
  let count = 0
  const emptyGrades: CertGrade[] = []
  for (const grade of grades) {
    lines.push('')
    lines.push(csvCell(`【${grade}持证清册】`))
    const members = rosterRowsOfGrade(rows, grade, today)
    if (members.length === 0) {
      emptyGrades.push(grade)
      lines.push(csvCell(`说明：${grade}当期无持证有效（含复审到期前三十天内）人员，本档无清册内容。`))
      continue
    }
    lines.push(ROSTER_COLUMNS.map(csvCell).join(','))
    members.forEach((row, i) => {
      count += 1
      lines.push(
        [
          i + 1,
          row['工号'],
          row['姓名'],
          row['资格等级'],
          row['持证项目'],
          row['复审日期'],
          row.status,
        ]
          .map(csvCell)
          .join(','),
      )
    })
  }
  const header = [
    csvCell('继保人员持证清册'),
    csvCell(`生成日期：${today}`),
    csvCell(`复审到期规则：到期前${REVIEW_REMIND_DAYS}天提醒，超期未复审或复审不合格不列入合格清册`),
  ].join(',')
  const note =
    emptyGrades.length > 0
      ? `${emptyGrades.join('、')}当期无人，已在清册中附说明`
      : ''
  return { content: `\uFEFF${header}\n${lines.join('\n')}`, count, empty: count === 0, note }
}

export function exportCertRoster(grade: string, today?: string): CertRosterResult {
  const day = resolveToday(today)
  const rows = listRows(CERT_KEY)
  if (grade === '全部') {
    const result = rosterCsv([...CERT_GRADES], rows, day)
    return {
      filename: `继保人员持证清册-全部资格等级-${day}.csv`,
      grade,
      generatedAt: day,
      ...result,
    }
  }
  if (!CERT_GRADES.includes(grade as CertGrade)) {
    throw new Error(`资格等级「${grade}」不在认定范围内`)
  }
  const result = rosterCsv([grade as CertGrade], rows, day)
  return {
    filename: `继保人员持证清册-${grade}-${day}.csv`,
    grade,
    generatedAt: day,
    ...result,
  }
}

// 通用下载：清册内容已经含说明段，不会是空文件。
export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 工作票许可：待签发清单由复审判定结果驱动 ----

export function listPermitIssuance(today?: string): PermitIssuanceRow[] {
  const day = resolveToday(today)
  const certs = listRows(CERT_KEY).map((row) => normalizeCertRow(row, day))
  return listRows('workpermit')
    .filter((permit) => String(permit.status) === '待签发')
    .map((permit) => {
      const leader = String(permit['工作负责人'] ?? '')
      const cert = certs.find((row) => String(row['姓名']) === leader)
      const base = {
        id: Number(permit.id),
        工作票号: String(permit['工作票号'] ?? ''),
        工作任务: String(permit['工作任务'] ?? ''),
        所属变电站: String(permit['所属变电站'] ?? ''),
        工作负责人: leader,
        工号: cert ? String(cert['工号']) : '',
        资格等级: cert ? String(cert['资格等级']) : '',
        持证项目: cert ? String(cert['持证项目']) : '',
        复审日期: cert ? String(cert['复审日期']) : '',
        持证状态: cert ? String(cert.status) : '台账未登记',
      }
      if (!cert) {
        return { ...base, blocked: true, reason: '工作负责人未在继保持证台账登记，不得签发' }
      }
      const status = String(cert.status)
      if (status === CERT_STATUS.reviewFailed) {
        return { ...base, blocked: true, reason: '培训考核复审不合格，暂停签发，补考审定合格后解除' }
      }
      if (status === CERT_STATUS.overdue) {
        return { ...base, blocked: true, reason: `证书已于 ${cert['复审日期']} 超期未复审，不得签发` }
      }
      if (status === CERT_STATUS.expiring) {
        return { ...base, blocked: false, reason: `证书将于 ${cert['复审日期']} 到期，请在到期前完成复审` }
      }
      return { ...base, blocked: false, reason: '持证状态正常，可签发' }
    })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries =
      meta.key === CERT_KEY
        ? rows[meta.key]?.map((row) => normalizeCertRow(row, resolveToday())) ?? []
        : rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
