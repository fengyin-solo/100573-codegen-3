/** 持证与培训考核台账的数据结构。 */
import type {
  AssessAuditStatus,
  CertHoldStatus,
  QualificationLevel,
} from './rules'

/** 持证台账：一人一条；复审日期在台账与导出清册两处共用同一字段。 */
export type CertHolder = {
  id: number
  工号: string
  姓名: string
  资格等级: QualificationLevel
  持证项目: string
  证书编号: string
  发证日期: string
  复审日期: string
  持证状态: CertHoldStatus
  备注: string
}

/** 培训考核：同一人同一期次重复提交只保留一条（以最新提交覆盖）。 */
export type AssessRecord = {
  id: number
  工号: string
  姓名: string
  期次: string
  考核项目: string
  理论成绩: number | ''
  实操成绩: number | ''
  考核日期: string
  审定状态: AssessAuditStatus
  审定人: string
  审定日期: string
}
