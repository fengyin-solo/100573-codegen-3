/**
 * 继保人员持证与培训考核的既有认定口径，台账登记、班组审定、清册导出都以此处为准，
 * 页面和 local-service 不再各写一份。
 */

// 资格等级由低到高排列，清册导出也按这个顺序逐档打包。
export const CERT_GRADES = ['初级工', '中级工', '高级工', '技师', '高级技师'] as const
export type CertGrade = (typeof CERT_GRADES)[number]

// 复审判定：到期日之前提前提醒的天数（含到期日当天）。
export const REVIEW_REMIND_DAYS = 30
// 一次复审通过后续期的年限。
export const REVIEW_RENEW_YEARS = 3

// 培训考核沿用既有认定口径：满分 100，60 分及格线不是本班组口径，
// 继保班按 80 分合格、90 分及以上优秀执行。
export const EXAM_FULL_SCORE = 100
export const EXAM_PASS_SCORE = 80
export const EXAM_EXCELLENT_SCORE = 90

// 持证台账的判定状态（status 字段即取这些值）。
export const CERT_STATUS = {
  /** 审定结论为不合格 */
  reviewFailed: '复审不合格',
  /** 复审日期已过且未完成复审，不允许保存成合格 */
  overdue: '超期未复审',
  /** 距复审日期不足 30 天（含当天），提醒安排复审 */
  expiring: '即将到期',
  /** 证在有效期内且考核合格 */
  valid: '持证有效',
} as const
export type CertStatusValue = (typeof CERT_STATUS)[keyof typeof CERT_STATUS]

// 培训考核流转状态。
export const EXAM_STATUS = {
  /** 已登记成绩，等待班组审定回填 */
  pendingReview: '待班组审定',
  /** 班组审定通过（合格/优秀） */
  qualified: '审定合格',
  /** 班组审定不合格 */
  failed: '审定不合格',
} as const

// 台账动作；actionTargets 与通用 runAction 不兼容，持证模块在 local-service 里单独处理。
export const CERT_ACTIONS = ['提交考核', '班组审定回填', '办理复审'] as const
