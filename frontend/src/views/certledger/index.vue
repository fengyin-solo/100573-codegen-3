<template>
  <section class="page" data-module="certledger">
    <header class="page-head">
      <div>
        <h2>继保人员持证与培训考核台账</h2>
        <p class="page-desc">
          登记资格等级、持证项目与复审日期；复审到期前三十天提醒，超期未复审或复审不合格不得保存为合格，并联动工作票待签发清单；考核成绩经班组审定后回填，按资格等级可打包导出持证清册。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">新建持证台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.danger ? 'error-text' : ''">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 按资格等级打包导出：选档 → 直接下载；该档当期无人时清册里只有说明段，不产出空文件 -->
    <div class="export-box">
      <form class="filter-bar" @submit.prevent="exportRoster">
        <label class="filter-item">
          <span>清册资格等级</span>
          <select v-model="exportGrade">
            <option value="全部">全部资格等级（逐档打包）</option>
            <option v-for="grade in grades" :key="grade" :value="grade">
              {{ grade }}（在册 {{ gradeCounts[grade] ?? 0 }} 人）
            </option>
          </select>
        </label>
        <button class="btn primary" type="submit">打包导出清册并下载</button>
        <button class="btn ghost" type="button" @click="previewRoster">预览清册内容</button>
      </form>
      <p v-if="rosterNote" class="roster-note">{{ rosterNote }}</p>
      <pre v-if="rosterPreview" class="roster-preview">{{ rosterPreview }}</pre>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">复审判定以今天 {{ today }} 为准，提前 {{ remindDays }} 天提醒</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>工号 / 姓名</span>
        <input v-model="keyword" placeholder="按工号或姓名检索" />
      </label>
      <label class="filter-item">
        <span>资格等级</span>
        <select v-model="gradeFilter">
          <option value="">全部等级</option>
          <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>持证状态</span>
        <select v-model="statusFilter">
          <option value="">全部状态</option>
          <option v-for="status in certStatuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>持证状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-blocked': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openSubmit(row)">
              {{ String(row['考核成绩']) === '' ? '提交考核' : '重新提交考核' }}
            </button>
            <button
              v-if="String(row['考核状态']) === examPending"
              class="link"
              type="button"
              @click="openFinalize(row)"
            >
              班组审定回填
            </button>
            <button class="link" type="button" @click="openRenew(row)">办理复审</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的持证台账记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条台账记录 · 数据保存在本机浏览器</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 新建台账 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>新建持证台账</h3>
        <p class="page-desc">复审日期超期的记录不能保存成合格，请先办理复审后再登记。</p>
        <label v-for="field in createFields" :key="field.key" class="modal-field">
          <span>{{ field.label }}<em v-if="field.required"> *</em></span>
          <select v-if="field.key === '资格等级'" v-model="createForm[field.key]">
            <option value="" disabled>请选择资格等级</option>
            <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
          </select>
          <input
            v-else
            v-model="createForm[field.key]"
            :type="field.key.includes('日期') ? 'date' : 'text'"
            :placeholder="field.placeholder"
          />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存台账</button>
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 考核提交 -->
    <div v-if="actionPanel === 'submit'" class="modal-mask" @click.self="actionPanel = null">
      <form class="modal-card" @submit.prevent="confirmSubmit">
        <h3>提交培训考核成绩 · {{ activeRow?.['姓名'] }}</h3>
        <p class="page-desc">同一人重复提交只保留最新一条，并重新进入班组审定。</p>
        <label class="modal-field">
          <span>考核成绩（0-{{ examFull }} 分）<em>*</em></span>
          <input v-model.number="scoreInput" type="number" min="0" :max="examFull" step="1" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交待审定</button>
          <button class="btn ghost" type="button" @click="actionPanel = null">取消</button>
        </div>
      </form>
    </div>

    <!-- 班组审定回填 -->
    <div v-if="actionPanel === 'finalize'" class="modal-mask" @click.self="actionPanel = null">
      <div class="modal-card">
        <h3>班组审定回填 · {{ activeRow?.['姓名'] }}</h3>
        <p class="page-desc">
          成绩 {{ activeRow?.['考核成绩'] }} 分；沿用既有认定口径：{{ examPass }} 分合格、{{ examExcellent }} 分及以上优秀。
          超期未复审的不允许审定为合格。
        </p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmFinalize(true)">审定为合格</button>
          <button class="btn" type="button" @click="confirmFinalize(false)">审定为不合格</button>
          <button class="btn ghost" type="button" @click="actionPanel = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 办理复审 -->
    <div v-if="actionPanel === 'renew'" class="modal-mask" @click.self="actionPanel = null">
      <div class="modal-card">
        <h3>办理复审 · {{ activeRow?.['姓名'] }}</h3>
        <p class="page-desc">
          当前复审日期 {{ activeRow?.['复审日期'] }}，状态「{{ activeRow?.status }}」。复审通过后续期
          {{ renewYears }} 年，台账与导出清册的复审日期同步更新。
        </p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmRenew">复审通过，办理续期</button>
          <button class="btn ghost" type="button" @click="actionPanel = null">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createCertEntry,
  downloadTextFile,
  exportCertRoster,
  finalizeCertExam,
  listCertLedger,
  renewCertReview,
  submitCertExam,
} from '@/api/local-service'
import {
  CERT_GRADES,
  CERT_STATUS,
  EXAM_FULL_SCORE,
  EXAM_PASS_SCORE,
  EXAM_EXCELLENT_SCORE,
  EXAM_STATUS,
  REVIEW_REMIND_DAYS,
  REVIEW_RENEW_YEARS,
} from '@/data/cert-policy'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()

const grades = CERT_GRADES
const certStatuses = [CERT_STATUS.valid, CERT_STATUS.expiring, CERT_STATUS.overdue, CERT_STATUS.reviewFailed]
const examPending = EXAM_STATUS.pendingReview
const examFull = EXAM_FULL_SCORE
const examPass = EXAM_PASS_SCORE
const examExcellent = EXAM_EXCELLENT_SCORE
const remindDays = REVIEW_REMIND_DAYS
const renewYears = REVIEW_RENEW_YEARS

const columns = ['工号', '姓名', '资格等级', '持证项目', '初证日期', '复审日期', '考核成绩', '考核状态', '审定结论', '审定日期']
const today = new Date().toLocaleDateString('sv-SE')

const allRows = ref<EntryRow[]>([])
const rows = ref<EntryRow[]>([])
const total = ref(0)
const gradeCounts = ref<Record<string, number>>({})
const errorMessage = ref('')

const keyword = ref('')
const gradeFilter = ref('')
const statusFilter = ref('')

const exportGrade = ref<string>('全部')
const rosterNote = ref('')
const rosterPreview = ref('')

const showCreate = ref(false)
const actionPanel = ref<null | 'submit' | 'finalize' | 'renew'>(null)
const activeRow = ref<EntryRow | null>(null)
const scoreInput = ref<number | null>(null)

const createFields: { key: keyof ReturnType<typeof emptyCreateForm>; label: string; required?: boolean; placeholder?: string }[] = [
  { key: '工号', label: '工号', required: true },
  { key: '姓名', label: '姓名', required: true },
  { key: '资格等级', label: '资格等级', required: true },
  { key: '持证项目', label: '持证项目', placeholder: '如：继电保护员（技师）；保护校验' },
  { key: '初证日期', label: '初证日期' },
  { key: '复审日期', label: '复审日期', required: true },
]

const emptyCreateForm = () => ({
  工号: '',
  姓名: '',
  资格等级: '',
  持证项目: '',
  初证日期: '',
  复审日期: '',
})
const createForm = ref<Record<string, string>>(emptyCreateForm())

const stats = computed(() => [
  { label: '在册人数', value: allRows.value.length, danger: false },
  {
    label: CERT_STATUS.valid,
    value: allRows.value.filter((row) => row.status === CERT_STATUS.valid).length,
    danger: false,
  },
  {
    label: CERT_STATUS.expiring,
    value: allRows.value.filter((row) => row.status === CERT_STATUS.expiring).length,
    danger: false,
  },
  {
    label: CERT_STATUS.overdue,
    value: allRows.value.filter((row) => row.status === CERT_STATUS.overdue).length,
    danger: true,
  },
  {
    label: CERT_STATUS.reviewFailed,
    value: allRows.value.filter((row) => row.status === CERT_STATUS.reviewFailed).length,
    danger: true,
  },
])

const statusSummary = computed(() =>
  certStatuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => row.status === status).length,
  })),
)

function flash(message: string) {
  errorMessage.value = message
}

function reload() {
  errorMessage.value = ''
  rosterNote.value = ''
  rosterPreview.value = ''
  const payload = listCertLedger()
  allRows.value = payload.items
  gradeCounts.value = payload.gradeCounts
  const word = keyword.value.trim()
  rows.value = payload.items.filter((row) => {
    if (gradeFilter.value && String(row['资格等级']) !== gradeFilter.value) return false
    if (statusFilter.value && String(row.status) !== statusFilter.value) return false
    if (word) {
      const haystack = `${row['工号'] ?? ''}${row['姓名'] ?? ''}`
      if (!haystack.includes(word)) return false
    }
    return true
  })
  total.value = rows.value.length
}

function resetFilters() {
  keyword.value = ''
  gradeFilter.value = ''
  statusFilter.value = ''
  reload()
}

function buildRoster() {
  const roster = exportCertRoster(exportGrade.value)
  rosterNote.value = roster.empty
    ? `「${roster.grade}」当期没有持证有效人员，下载的清册只含说明段，未生成空文件。`
    : roster.note
      ? `已打包 ${roster.count} 人；${roster.note}。`
      : `已打包 ${roster.count} 人，清册复审日期与台账一致。`
  return roster
}

function exportRoster() {
  try {
    const roster = buildRoster()
    downloadTextFile(roster.filename, roster.content)
  } catch (error) {
    flash(error instanceof Error ? error.message : '清册导出失败')
  }
}

function previewRoster() {
  try {
    rosterPreview.value = buildRoster().content
  } catch (error) {
    flash(error instanceof Error ? error.message : '清册预览失败')
  }
}

function openCreate() {
  createForm.value = emptyCreateForm()
  showCreate.value = true
}

function submitCreate() {
  const result = createCertEntry(createForm.value)
  if (!result.ok) {
    flash(result.message)
    return
  }
  showCreate.value = false
  reload()
}

function openSubmit(row: EntryRow) {
  activeRow.value = row
  scoreInput.value = String(row['考核成绩']) === '' ? null : Number(row['考核成绩'])
  actionPanel.value = 'submit'
}

function confirmSubmit() {
  if (!activeRow.value || scoreInput.value === null) {
    flash('请填写考核成绩')
    return
  }
  const result = submitCertExam(String(activeRow.value['工号']), Number(scoreInput.value))
  if (!result.ok) {
    flash(result.message)
    return
  }
  actionPanel.value = null
  reload()
}

function openFinalize(row: EntryRow) {
  activeRow.value = row
  actionPanel.value = 'finalize'
}

function confirmFinalize(passed: boolean) {
  if (!activeRow.value) return
  const result = finalizeCertExam(
    String(activeRow.value['工号']),
    passed,
    store.operator,
  )
  if (!result.ok) {
    flash(result.message)
    return
  }
  actionPanel.value = null
  reload()
}

function openRenew(row: EntryRow) {
  activeRow.value = row
  actionPanel.value = 'renew'
}

function confirmRenew() {
  if (!activeRow.value) return
  const result = renewCertReview(String(activeRow.value['工号']), store.operator)
  if (!result.ok) {
    flash(result.message)
    return
  }
  actionPanel.value = null
  reload()
}

onMounted(reload)
</script>

<style scoped>
.export-box {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.roster-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b45309;
}
.roster-preview {
  margin: 8px 0 0;
  max-height: 220px;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  white-space: pre-wrap;
}
.row-blocked {
  background: #fef3f2;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 420px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
}
.modal-card h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field input,
.modal-field select {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-field em {
  color: #b42318;
  font-style: normal;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
