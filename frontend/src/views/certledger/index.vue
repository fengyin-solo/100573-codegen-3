<template>
  <section class="page" data-module="certledger">
    <header class="page-head">
      <div>
        <h2>继保人员持证与培训考核台账</h2>
        <p class="page-desc">
          一人一册登记持证项目与复审日期；复审按提前三十天提醒，超期未复审不得保存为合格；培训考核成绩由班组审定后回填，同一人同期重复提交只留一条；可按资格等级打包导出清册，复审判定结论驱动工作票许可的待签发清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 持证台账 -->
    <div v-show="activeTab === 'holders'">
      <div class="stat-row">
        <article v-for="item in holderStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value" :class="item.tone">{{ item.value }}</strong>
        </article>
      </div>

      <form class="filter-bar" @submit.prevent="reloadHolders">
        <label class="filter-item">
          <span>资格等级</span>
          <select v-model="holderFilter.level">
            <option value="">全部等级</option>
            <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>复审状态</span>
          <select v-model="holderFilter.state">
            <option value="">全部</option>
            <option value="合格">合格</option>
            <option value="即将到期">三十天内到期</option>
            <option value="超期未复审">超期未复审</option>
          </select>
        </label>
        <label class="filter-item">
          <span>检索</span>
          <input v-model="holderFilter.keyword" placeholder="按姓名 / 工号检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetHolderFilter">重置条件</button>
        <button class="btn primary" type="button" @click="openHolderCreate">登记持证人员</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in holderColumns" :key="column">{{ column }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredHolders" :key="row.id">
            <td>{{ row.工号 }}</td>
            <td>{{ row.姓名 }}</td>
            <td>{{ row.资格等级 }}</td>
            <td class="cell-wrap">{{ row.持证项目 }}</td>
            <td>{{ row.证书编号 }}</td>
            <td>{{ row.发证日期 }}</td>
            <td>
              <strong>{{ row.复审日期 }}</strong>
              <div v-if="row.复审状态 === '即将到期'" class="tag warn">剩 {{ row.剩余天数 }} 天到期</div>
              <div v-else-if="row.复审状态 === '超期未复审'" class="tag bad">已超期 {{ Math.abs(row.剩余天数) }} 天</div>
            </td>
            <td><span class="tag" :class="reviewTone(row.复审状态)">{{ row.复审状态 }}</span></td>
            <td>{{ row.持证状态 }}</td>
            <td>
              <span
                class="tag"
                :class="row.考核认定 === '合格' ? 'ok' : row.考核认定 === '未考核' ? 'muted' : row.考核认定 === '待审定' ? 'warn' : 'bad'"
              >
                {{ row.考核认定 }}
              </span>
            </td>
            <td>
              <span class="tag" :class="row.判定结果 === '合格' ? 'ok' : 'bad'">{{ row.判定结果 }}</span>
              <div v-if="blockedTickets(row.姓名).length" class="block-link">
                待签发工作票：{{ blockedTickets(row.姓名).join('、') }}
              </div>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openHolderEdit(row)">编辑</button>
              <button class="link danger" type="button" @click="removeHolder(row)">删除</button>
            </td>
          </tr>
          <tr v-if="!filteredHolders.length">
            <td :colspan="holderColumns.length + 1" class="empty-state">没有符合条件的持证记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ filteredHolders.length }} 条持证记录（复审到期按提前三十天提醒，超期不得保存为合格）</span>
        <span v-if="holderMessage" :class="holderOk ? 'ok-text' : 'error-text'">{{ holderMessage }}</span>
      </footer>
    </div>

    <!-- 培训考核 -->
    <div v-show="activeTab === 'assess'">
      <div class="stat-row">
        <article v-for="item in assessStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value" :class="item.tone">{{ item.value }}</strong>
        </article>
      </div>

      <form class="editor-card" @submit.prevent="submitAssess">
        <h3 class="card-title">培训考核登记 / 回填成绩</h3>
        <p class="card-hint">认定口径沿用既有规定：理论、实操双科均不低于 80 分，且班组审定通过方为合格。同一人同一期次重复提交将覆盖原记录，只留一条。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>人员</span>
            <select v-model="assessForm.工号" @change="onAssessPersonChange">
              <option value="">请选择</option>
              <option v-for="holder in holderRows" :key="holder.工号" :value="holder.工号">
                {{ holder.工号 }} · {{ holder.姓名 }}
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>期次</span>
            <input v-model="assessForm.期次" placeholder="如 2026年第四季度" />
          </label>
          <label class="form-item wide">
            <span>考核项目</span>
            <input v-model="assessForm.考核项目" placeholder="如 继电保护理论与保护校验实操" />
          </label>
          <label class="form-item">
            <span>理论成绩</span>
            <input v-model.number="assessForm.理论成绩" type="number" min="0" max="100" placeholder="0-100" />
          </label>
          <label class="form-item">
            <span>实操成绩</span>
            <input v-model.number="assessForm.实操成绩" type="number" min="0" max="100" placeholder="0-100" />
          </label>
          <label class="form-item">
            <span>考核日期</span>
            <input v-model="assessForm.考核日期" type="date" />
          </label>
        </div>
        <div class="card-actions">
          <button class="btn primary" type="submit">提交考核</button>
          <button class="btn ghost" type="button" @click="resetAssessForm">清空</button>
          <span v-if="assessMessage" :class="assessOk ? 'ok-text' : 'error-text'">{{ assessMessage }}</span>
        </div>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in assessColumns" :key="column">{{ column }}</th>
            <th>班组审定</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in assessRows" :key="row.id">
            <td>{{ row.工号 }}</td>
            <td>{{ row.姓名 }}</td>
            <td>{{ row.期次 }}</td>
            <td class="cell-wrap">{{ row.考核项目 }}</td>
            <td :class="scoreTone(row.理论成绩)">{{ row.理论成绩 }}</td>
            <td :class="scoreTone(row.实操成绩)">{{ row.实操成绩 }}</td>
            <td>{{ row.考核日期 }}</td>
            <td>
              <span class="tag" :class="row.审定状态 === '审定通过' ? 'ok' : row.审定状态 === '审定退回' ? 'bad' : 'warn'">
                {{ row.审定状态 }}
              </span>
              <div v-if="row.审定人" class="cell-sub">{{ row.审定人 }} · {{ row.审定日期 }}</div>
            </td>
            <td><span class="tag" :class="row.认定结果 === '合格' ? 'ok' : 'bad'">{{ row.认定结果 }}</span></td>
            <td class="row-actions">
              <template v-if="row.审定状态 === '待审定'">
                <button class="link" type="button" @click="audit(row, '审定通过')">审定通过</button>
                <button class="link danger" type="button" @click="audit(row, '审定退回')">退回</button>
              </template>
              <span v-else class="cell-sub">已回填</span>
              <button class="link danger" type="button" @click="removeAssess(row)">删除</button>
            </td>
          </tr>
          <tr v-if="!assessRows.length">
            <td :colspan="assessColumns.length + 1" class="empty-state">暂无培训考核记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 清册导出 -->
    <div v-show="activeTab === 'roster'">
      <div class="editor-card">
        <h3 class="card-title">按资格等级打包导出持证清册</h3>
        <p class="card-hint">
          清册写明持证项目与复审日期，复审日期与持证台账为同一数据源。当期某等级无人时，导出的文件内附说明，不产生空文件。
        </p>
        <table class="data-table">
          <thead>
            <tr><th>资格等级</th><th>当期在册人数</th><th>其中合格</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="level in levels" :key="level">
              <td>{{ level }}</td>
              <td>{{ levelCount(level) }}</td>
              <td>{{ levelQualified(level) }}</td>
              <td>
                <button class="btn primary" type="button" @click="exportLevel(level)">
                  打包下载{{ level }}清册
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="page-foot">
          <span v-if="rosterMessage" class="ok-text">{{ rosterMessage }}</span>
          <span>期次：{{ periodLabel }} · 编制日期：{{ today }} · 判定基准日为当天，提前三十天预警</span>
        </footer>
      </div>
    </div>

    <!-- 持证人员编辑弹窗 -->
    <div v-if="holderDialog.open" class="modal-mask" @click.self="holderDialog.open = false">
      <form class="modal" @submit.prevent="saveHolder">
        <h3 class="card-title">{{ holderDialog.id ? '编辑持证台账' : '登记持证人员' }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>工号</span>
            <input v-model="holderDialog.form.工号" placeholder="如 JB-0107" />
          </label>
          <label class="form-item">
            <span>姓名</span>
            <input v-model="holderDialog.form.姓名" placeholder="姓名" />
          </label>
          <label class="form-item">
            <span>资格等级</span>
            <select v-model="holderDialog.form.资格等级">
              <option v-for="level in levels" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>持证状态</span>
            <select v-model="holderDialog.form.持证状态">
              <option v-for="s in holdStatuses" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="form-item wide">
            <span>持证项目</span>
            <input v-model="holderDialog.form.持证项目" placeholder="如 继电保护员（220kV变电站继电保护）" />
          </label>
          <label class="form-item">
            <span>证书编号</span>
            <input v-model="holderDialog.form.证书编号" />
          </label>
          <label class="form-item">
            <span>发证日期</span>
            <input v-model="holderDialog.form.发证日期" type="date" />
          </label>
          <label class="form-item">
            <span>复审日期</span>
            <input v-model="holderDialog.form.复审日期" type="date" />
          </label>
          <label class="form-item wide">
            <span>备注</span>
            <input v-model="holderDialog.form.备注" placeholder="如 复审已预约、停止担任负责人等" />
          </label>
        </div>
        <p v-if="holderDialog.form.复审日期" class="dialog-tip" :class="dialogTipClass">
          {{ dialogTip }}
        </p>
        <div class="card-actions">
          <button class="btn primary" type="submit">保存</button>
          <button class="btn ghost" type="button" @click="holderDialog.open = false">取消</button>
          <span v-if="holderDialog.error" class="error-text">{{ holderDialog.error }}</span>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  auditAssessment,
  createHolder,
  deleteAssessment,
  deleteHolder,
  downloadRoster,
  getAssessments,
  getHolders,
  resetCertData,
  submitAssessment,
  updateHolder,
  type AssessView,
  type HolderView,
} from '@/api/cert-service'
import { listEntries } from '@/api/local-service'
import {
  CERT_HOLD_STATUSES,
  QUALIFICATION_LEVELS,
  checkReview,
  currentPeriodLabel,
  todayValue,
} from '@/data/cert/rules'
import type { AssessAuditStatus, CertHoldStatus, QualificationLevel, ReviewState } from '@/data/cert/rules'

const tabs = [
  { key: 'holders', label: '持证台账' },
  { key: 'assess', label: '培训考核' },
  { key: 'roster', label: '清册导出' },
] as const

const levels = [...QUALIFICATION_LEVELS]
const holdStatuses = [...CERT_HOLD_STATUSES]
const activeTab = ref<(typeof tabs)[number]['key']>('holders')

const holderColumns = [
  '工号', '姓名', '资格等级', '持证项目', '证书编号', '发证日期', '复审日期',
  '复审状态', '持证状态', '考核认定', '判定结果',
]
const assessColumns = ['工号', '姓名', '期次', '考核项目', '理论成绩', '实操成绩', '考核日期', '审定情况', '认定结果']

const holderRows = ref<HolderView[]>([])
const assessRows = ref<AssessView[]>([])
const today = todayValue()
const periodLabel = currentPeriodLabel()

const holderFilter = reactive({ level: '', state: '', keyword: '' })
const holderMessage = ref('')
const holderOk = ref(true)

// ---------------- 持证台账 ----------------

const filteredHolders = computed(() =>
  holderRows.value.filter((row) => {
    if (holderFilter.level && row.资格等级 !== holderFilter.level) {
      return false
    }
    if (holderFilter.state && row.复审状态 !== holderFilter.state) {
      return false
    }
    const keyword = holderFilter.keyword.trim()
    if (keyword && !`${row.姓名}${row.工号}`.includes(keyword)) {
      return false
    }
    return true
  }),
)

const holderStats = computed(() => [
  { label: '在册持证人员', value: holderRows.value.length, tone: '' },
  { label: '复审合格', value: holderRows.value.filter((r) => r.复审状态 === '合格').length, tone: 'tone-ok' },
  { label: '三十天内到期', value: holderRows.value.filter((r) => r.复审状态 === '即将到期').length, tone: 'tone-warn' },
  { label: '超期未复审', value: holderRows.value.filter((r) => r.复审状态 === '超期未复审').length, tone: 'tone-bad' },
])

function reviewTone(state: ReviewState): string {
  return state === '合格' ? 'ok' : state === '即将到期' ? 'warn' : 'bad'
}

/** 复审判定不合格人员名下的待签发工作票（驱动工作票许可的待签发清单）。 */
const pendingPermits = computed(() =>
  listEntries('workpermit', { 许可状态: '待签发' }).items
    .filter((row) => String(row.status) === '待签发')
    .map((row) => ({ 票号: String(row['工作票号']), 负责人: String(row['工作负责人']) })),
)

function blockedTickets(name: string): string[] {
  return pendingPermits.value.filter((item) => item.负责人 === name).map((item) => item.票号)
}

function resetHolderFilter() {
  holderFilter.level = ''
  holderFilter.state = ''
  holderFilter.keyword = ''
}

type HolderForm = {
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

function emptyHolderForm(): HolderForm {
  return {
    工号: '',
    姓名: '',
    资格等级: '初级工',
    持证项目: '',
    证书编号: '',
    发证日期: today,
    复审日期: today,
    持证状态: '持证有效',
    备注: '',
  }
}

const holderDialog = reactive<{ open: boolean; id: number | null; form: HolderForm; error: string }>({
  open: false,
  id: null,
  form: emptyHolderForm(),
  error: '',
})

const dialogTip = computed(() => {
  if (!holderDialog.form.复审日期) {
    return ''
  }
  const review = checkReview(holderDialog.form.复审日期)
  if (review.state === '超期未复审') {
    return `复审日期已超期 ${Math.abs(review.daysLeft)} 天，保存为「持证有效」会被拦截，请先办理复审或改登记为复审不合格。`
  }
  if (review.state === '即将到期') {
    return `距复审到期还有 ${review.daysLeft} 天（三十天提醒期内），可保存但请尽快安排复审。`
  }
  return `距复审到期还有 ${review.daysLeft} 天，复审状态合格。`
})
const dialogTipClass = computed(() => {
  const state = holderDialog.form.复审日期 ? checkReview(holderDialog.form.复审日期).state : '合格'
  return state === '超期未复审' ? 'tip-bad' : state === '即将到期' ? 'tip-warn' : 'tip-ok'
})

function openHolderCreate() {
  holderDialog.id = null
  holderDialog.form = emptyHolderForm()
  holderDialog.error = ''
  holderDialog.open = true
}

function openHolderEdit(row: HolderView) {
  holderDialog.id = row.id
  holderDialog.form = {
    工号: row.工号,
    姓名: row.姓名,
    资格等级: row.资格等级,
    持证项目: row.持证项目,
    证书编号: row.证书编号,
    发证日期: row.发证日期,
    复审日期: row.复审日期,
    持证状态: row.持证状态,
    备注: row.备注,
  }
  holderDialog.error = ''
  holderDialog.open = true
}

function saveHolder() {
  holderDialog.error = ''
  const result = holderDialog.id
    ? updateHolder(holderDialog.id, holderDialog.form)
    : createHolder(holderDialog.form)
  if (!result.ok) {
    holderDialog.error = result.message
    return
  }
  holderDialog.open = false
  flashHolder(result.message, true)
  reloadHolders()
}

function removeHolder(row: HolderView) {
  const result = deleteHolder(row.id)
  flashHolder(result.message, result.ok)
  if (result.ok) {
    reloadHolders()
  }
}

function flashHolder(message: string, ok: boolean) {
  holderMessage.value = message
  holderOk.value = ok
}

// ---------------- 培训考核 ----------------

const assessStats = computed(() => [
  { label: '考核记录', value: assessRows.value.length, tone: '' },
  { label: '待班组审定', value: assessRows.value.filter((r) => r.审定状态 === '待审定').length, tone: 'tone-warn' },
  { label: '认定合格', value: assessRows.value.filter((r) => r.认定结果 === '合格').length, tone: 'tone-ok' },
  { label: '认定不合格', value: assessRows.value.filter((r) => r.认定结果 === '不合格').length, tone: 'tone-bad' },
])

const assessForm = reactive({
  工号: '',
  姓名: '',
  期次: periodLabel,
  考核项目: '继电保护理论与保护校验实操',
  理论成绩: '' as number | '',
  实操成绩: '' as number | '',
  考核日期: today,
})
const assessMessage = ref('')
const assessOk = ref(true)

function onAssessPersonChange() {
  const holder = holderRows.value.find((row) => row.工号 === assessForm.工号)
  assessForm.姓名 = holder ? holder.姓名 : ''
}

function resetAssessForm() {
  assessForm.工号 = ''
  assessForm.姓名 = ''
  assessForm.期次 = periodLabel
  assessForm.考核项目 = '继电保护理论与保护校验实操'
  assessForm.理论成绩 = ''
  assessForm.实操成绩 = ''
  assessForm.考核日期 = today
}

function submitAssess() {
  const result = submitAssessment({ ...assessForm })
  assessMessage.value = result.message
  assessOk.value = result.ok
  if (result.ok) {
    resetAssessForm()
    reloadAssess()
    reloadHolders()
  }
}

function audit(row: AssessView, status: AssessAuditStatus) {
  const result = auditAssessment(row.id, status, '班组审定')
  assessMessage.value = result.message
  assessOk.value = result.ok
  reloadAssess()
  reloadHolders()
}

function removeAssess(row: AssessView) {
  const result = deleteAssessment(row.id)
  assessMessage.value = result.message
  assessOk.value = result.ok
  if (result.ok) {
    reloadAssess()
    reloadHolders()
  }
}

function scoreTone(score: number | ''): string {
  return score === '' ? '' : score >= 80 ? 'score-ok' : 'score-bad'
}

// ---------------- 清册导出 ----------------

const rosterMessage = ref('')

function levelCount(level: QualificationLevel): number {
  return holderRows.value.filter((row) => row.资格等级 === level).length
}

function levelQualified(level: QualificationLevel): number {
  return holderRows.value.filter((row) => row.资格等级 === level && row.判定结果 === '合格').length
}

function exportLevel(level: QualificationLevel) {
  const result = downloadRoster(level)
  rosterMessage.value = result.empty
    ? `${level} 当期无人，已下载的清册内附说明（${result.filename}），未生成空文件`
    : `${level} 清册已打包下载：${result.filename}，共 ${result.count} 人`
}

// ---------------- 公共 ----------------

function reloadHolders() {
  holderRows.value = getHolders()
}

function reloadAssess() {
  assessRows.value = getAssessments()
}

function resetAll() {
  resetCertData()
  reloadHolders()
  reloadAssess()
  holderMessage.value = '已恢复为示例持证与考核数据'
  holderOk.value = true
}

onMounted(() => {
  reloadHolders()
  reloadAssess()
})
</script>
