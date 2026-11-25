import { computed, reactive, watch } from 'vue'

/** Where credits show in Mar's sidebar (UI Playground › Credits). */
export type CreditsStyle = 'row' | 'meter' | 'chip'

export const CREDITS_STYLES: { value: CreditsStyle; label: string }[] = [
  { value: 'row', label: 'Row · above the workspace' },
  { value: 'meter', label: 'Meter · inside the workspace' },
  { value: 'chip', label: 'Chip · next to the tabs' }
]

const KEY = 'comfy.design.mar.credits'

/** Mar settled on the Row (above the workspace); the tweak is gone, so a
 *  stored Meter or Chip pick no longer applies. The other styles stay in
 *  code in case she wants them back. */
export const creditsStyle = reactive<{ id: CreditsStyle }>({
  id: 'row'
})

watch(
  () => creditsStyle.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** Which of Alex Tov's credits flyout states to show (Figma "Credits flyout — states", FRONT-3644;
 *  UI Playground › Credits state). Each state also sets the total the Credits row carries. */
export type CreditsState =
  | 'active'
  | 'planUsed'
  | 'out'
  | 'negative'
  | 'processing'
  | 'yearly'
  | 'noPlan'
  | 'ended'
  | 'paused'
  | 'pastDue'
  | 'stopped'
  | 'unavailable'
  | 'loading'

export const CREDITS_STATES: { value: CreditsState; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'planUsed', label: 'Plan used up' },
  { value: 'out', label: 'Out of credits' },
  { value: 'negative', label: 'Negative balance' },
  { value: 'processing', label: 'Payment processing' },
  { value: 'yearly', label: 'Yearly plan' },
  { value: 'noPlan', label: 'No plan' },
  { value: 'ended', label: 'Plan ended' },
  { value: 'paused', label: 'Paused' },
  { value: 'pastDue', label: 'Past due' },
  { value: 'stopped', label: 'Purchases stopped' },
  { value: 'unavailable', label: 'Balance unavailable' },
  { value: 'loading', label: 'Loading' }
]

const STATE_KEY = 'comfy.design.mar.creditsState'

export const creditsState = reactive<{ id: CreditsState }>({
  id: (() => {
    try {
      const v = localStorage.getItem(STATE_KEY)
      return CREDITS_STATES.some((s) => s.value === v) ? (v as CreditsState) : 'active'
    } catch {
      return 'active'
    }
  })()
})

watch(
  () => creditsState.id,
  (id) => {
    try {
      localStorage.setItem(STATE_KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** The pools behind each state. Numbers follow the prototype's Billing page (9,800 of 20,000 used,
 *  renews Nov 1); the yearly pool is twelve months of it. `null` pools are hidden, `undefined`
 *  values are unknown (unavailable / loading). */
type Pools = { plan: number | null; total: number; left: number; topUp: number }

const TOP_UP = 3653
const MONTH: Pools = { plan: 20000, total: 20000, left: 10200, topUp: TOP_UP }

export const CREDITS_POOLS: Record<CreditsState, Pools> = {
  active: MONTH,
  planUsed: { ...MONTH, left: 0 },
  out: { ...MONTH, left: 0, topUp: 0 },
  negative: { ...MONTH, left: 0, topUp: 0 },
  processing: MONTH,
  yearly: { plan: 240000, total: 240000, left: 180000, topUp: TOP_UP },
  noPlan: { plan: null, total: 0, left: 0, topUp: TOP_UP },
  ended: { plan: null, total: 0, left: 0, topUp: TOP_UP },
  paused: { ...MONTH, left: 0 },
  pastDue: { ...MONTH, left: 0 },
  stopped: MONTH,
  unavailable: MONTH,
  loading: MONTH
}

/** The signed total the Credits row carries: pools stop at 0, runs that finish past it go negative. */
export const creditsTotal = computed(() => {
  const id = creditsState.id
  if (id === 'unavailable' || id === 'loading') return '—'
  if (id === 'negative') return '−120'
  const p = CREDITS_POOLS[id]
  return (p.left + p.topUp).toLocaleString('en-US')
})

/** The total, short for chips: 13.9k, −120, —. */
export const creditsShort = computed(() => {
  const n = Number(creditsTotal.value.replace(/,/g, '').replace('−', '-'))
  return Number.isNaN(n) || Math.abs(n) < 1000 ? creditsTotal.value : `${(n / 1000).toFixed(1)}k`
})
