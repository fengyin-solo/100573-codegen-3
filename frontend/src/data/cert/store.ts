/** 持证台账与培训考核的本地持久化：独立 localStorage，键内带版本，口径调整后重新播种。 */
import { ASSESS_SEED, CERT_HOLDER_SEED } from './seed'
import type { AssessRecord, CertHolder } from './types'

const HOLDERS_KEY = 'substation-protection:cert-holders:v1'
const ASSESS_KEY = 'substation-protection:cert-assess:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T[]
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

let holdersCache: CertHolder[] | null = null
let assessCache: AssessRecord[] | null = null

export function listHolders(): CertHolder[] {
  if (holdersCache === null) {
    holdersCache = read<CertHolder>(HOLDERS_KEY, CERT_HOLDER_SEED)
  }
  return holdersCache
}

export function saveHolders(rows: CertHolder[]): void {
  holdersCache = [...rows]
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(HOLDERS_KEY, JSON.stringify(holdersCache))
  }
}

export function listAssessments(): AssessRecord[] {
  if (assessCache === null) {
    assessCache = read<AssessRecord>(ASSESS_KEY, ASSESS_SEED)
  }
  return assessCache
}

export function saveAssessments(rows: AssessRecord[]): void {
  assessCache = [...rows]
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ASSESS_KEY, JSON.stringify(assessCache))
  }
}

export function resetHolders(): CertHolder[] {
  const rows = clone(CERT_HOLDER_SEED)
  saveHolders(rows)
  return rows
}

export function resetAssessments(): AssessRecord[] {
  const rows = clone(ASSESS_SEED)
  saveAssessments(rows)
  return rows
}
