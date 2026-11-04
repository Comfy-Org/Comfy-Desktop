import { reactive, watch } from 'vue'
import { isNewUser, proto } from '../useProto'

/**
 * Variations of the navigation (UI Playground › Nav options). Each adds
 * structure the default doesn't have, so each has its own switch and starts
 * Off: nothing changes until one is turned on.
 */
export type Port = 'navAccount' | 'navDocs' | 'firstRunNav'

export const PORTS: { key: Port; label: string }[] = [
  { key: 'navAccount', label: 'Signed out: Log in card, no Credits row' },
  { key: 'navDocs', label: 'Build mode: Docs link at the end of the nav' },
  { key: 'firstRunNav', label: 'First-time user: hide Builds, Deployments, Logs' }
]

const KEY = 'comfy.design.mar.pabloPorts'

export const ports = reactive<Record<Port, boolean>>(
  (() => {
    const off = Object.fromEntries(PORTS.map((p) => [p.key, false])) as Record<Port, boolean>
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
      for (const p of PORTS) off[p.key] = saved[p.key] === true
    } catch {
      // Storage blocked: everything starts Off.
    }
    return off
  })()
)

watch(
  () => ({ ...ports }),
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** Nav options › First-time nav: a new user sees only what
 *  helps a first call. No Builds in Create before any install; in Build
 *  no Deployments, Builds or Logs, and Overview is Get started. */
const FIRST_RUN_HIDES = ['deployments', 'environments', 'logs']
const firstRunOn = (): boolean => ports.firstRunNav && isNewUser.value

export function firstRunKeeps(page: string | undefined): boolean {
  if (!firstRunOn()) return true
  if (proto.mode === 'build') return !FIRST_RUN_HIDES.includes(page ?? '')
  return !(proto.fresh && page === 'environments')
}

export const firstRunLabel = (page: string | undefined, label: string): string =>
  firstRunOn() && page === 'build-overview' ? 'Get started' : label
