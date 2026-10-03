/**
 * 持证与培训考核的判定口径（纯函数，不碰浏览器存储，方便核对与测试）。
 * - 复审：到期日早于今天即「超期未复审」（不合格）；到期前 30 天（含）起进入「即将到期」提醒。
 * - 考核：沿用既有认定口径，理论/实操百分制均不低于 80 分且班组审定通过才算合格。
 */

export const REVIEW_WARN_DAYS = 30
export const SCORE_PASS_LINE = 80

export type ReviewState = '合格' | '即将到期' | '超期未复审'
export type CertResult = '合格' | '不合格'

/** 资格等级由高到低，清册导出与台账筛选共用同一套口径。 */
export const QUALIFICATION_LEVELS = ['初级工', '中级工', '高级工', '技师', '高级技师'] as const
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number]

/** 班组可手工登记的持证状态：判定为不合格或证件注销时使用。 */
export const CERT_HOLD_STATUSES = ['持证有效', '复审不合格', '已注销'] as const
export type CertHoldStatus = (typeof CERT_HOLD_STATUSES)[number]

/** 培训考核记录的审定状态。 */
export const ASSESS_AUDIT_STATUSES = ['待审定', '审定通过', '审定退回'] as const
export type AssessAuditStatus = (typeof ASSESS_AUDIT_STATUSES)[number]

function parseDate(value: string): Date {
  // 统一按本地零点解析，避免 new Date('yyyy-MM-dd') 的 UTC 偏移。
  const [y, m, d] = value.split('-').map((part) => Number(part))
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function todayValue(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function currentPeriodLabel(now: Date = new Date()): string {
  const quarterNames = ['一', '二', '三', '四']
  return `${now.getFullYear()}年第${quarterNames[Math.floor(now.getMonth() / 3)]}季度`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 距复审到期日还剩多少天；负数表示已超期天数。 */
export function daysUntilReview(reviewDate: string, now: Date = new Date()): number {
  const due = startOfDay(parseDate(reviewDate))
  const today = startOfDay(now)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

/** 按「提前三十天」规则给出复审状态。 */
export function reviewState(reviewDate: string, now: Date = new Date()): ReviewState {
  const days = daysUntilReview(reviewDate, now)
  if (days < 0) {
    return '超期未复审'
  }
  if (days <= REVIEW_WARN_DAYS) {
    return '即将到期'
  }
  return '合格'
}

export type ReviewCheck = {
  state: ReviewState
  daysLeft: number
}

export function checkReview(reviewDate: string, now: Date = new Date()): ReviewCheck {
  return { state: reviewState(reviewDate, now), daysLeft: daysUntilReview(reviewDate, now) }
}

/**
 * 复审判定是否合格：复审日期未超期，且班组没有手工登记为「复审不合格/已注销」。
 * 结论同时驱动工作票许可的待签发清单。
 */
export function isCertQualified(input: {
  复审日期: string
  持证状态: CertHoldStatus
  now?: Date
}): boolean {
  if (input.持证状态 !== '持证有效') {
    return false
  }
  return reviewState(input.复审日期, input.now ?? new Date()) !== '超期未复审'
}

/** 保存台账时的硬性校验：复审已超期的，不允许保存成合格。 */
export function validateCertSave(input: {
  复审日期: string
  持证状态: CertHoldStatus
  now?: Date
}): string | null {
  const state = reviewState(input.复审日期, input.now ?? new Date())
  if (state === '超期未复审' && input.持证状态 === '持证有效') {
    return `复审日期 ${input.复审日期} 已超期未复审，不能保存为「持证有效（合格）」，请先办理复审或登记为不合格`
  }
  return null
}

/** 考核合格线：两科均不低于 80 分。缺考/未录入按不合格处理。 */
export function assessScoresPass(theory: number | '', practice: number | ''): boolean {
  if (theory === '' || practice === '') {
    return false
  }
  return theory >= SCORE_PASS_LINE && practice >= SCORE_PASS_LINE
}

/** 最终认定结果：成绩过线，且班组审定通过——沿用既有认定口径。 */
export function assessVerdict(input: {
  理论成绩: number | ''
  实操成绩: number | ''
  审定状态: AssessAuditStatus
}): CertResult {
  return assessScoresPass(input.理论成绩, input.实操成绩) && input.审定状态 === '审定通过'
    ? '合格'
    : '不合格'
}
