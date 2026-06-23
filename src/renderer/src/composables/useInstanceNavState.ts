import { computed, type ComputedRef, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { useInstallCta, type InstallCta } from './useInstallCta'
import { navClass, normaliseCategory } from '../../../shared/viewKind'
import type { Category, NavClass, ViewKind } from '../../../shared/viewKind'
import type { NavInput, TargetKind, TargetRun } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'

/**
 * Read-model that derives the navigation FACTS for a (current host, target)
 * pair — the inputs `decideNavigation` consumes. Facts only: no decision is made
 * here, so the decision table stays the single source of navigation behavior.
 *
 * Run-state (`stopped` / `running-elsewhere` / `self`) is derived through
 * `useInstallCta`, so the "one install = one window" invariant lives in exactly
 * one place. `remote` is folded into `cloud` via `navClass`.
 */
export interface InstanceNavState {
  /** The shared `InstallCta` — exposed so the footer can reuse this one derivation
   *  rather than building a second graph for the same install. */
  cta: InstallCta
  currentClass: ComputedRef<NavClass | null>
  isCurrentChooser: ComputedRef<boolean>
  targetKind: ComputedRef<TargetKind>
  targetClass: ComputedRef<NavClass>
  targetRun: ComputedRef<TargetRun>
  isTargetCurrentHost: ComputedRef<boolean>
  isTargetRunningElsewhere: ComputedRef<boolean>
  isTargetRunningHere: ComputedRef<boolean>
  /** A `NavInput` for the given intent, ready to pass to `decideNavigation`. */
  navInput: (intent: NavInput['intent']) => NavInput
}

export interface InstanceNavStateSources {
  /** Host view-kind from the snapshot (`remote` already folded into `cloud`). */
  currentView: MaybeRefOrGetter<ViewKind>
  /** Raw active-install category from the snapshot (`null` on a dashboard host). */
  currentCategory: MaybeRefOrGetter<Category | null>
  /** The host's active install id, for the self/elsewhere comparison. */
  activeInstallationId: MaybeRefOrGetter<string | null | undefined>
}

export function useInstanceNavState(
  target: Ref<Installation | null | undefined>,
  sources: InstanceNavStateSources,
): InstanceNavState {
  // Single run-state derivation, shared with the footer CTA so they can't drift.
  const activeInstallationId = computed(() => toValue(sources.activeInstallationId) ?? null)
  const cta = useInstallCta(target, { activeInstallationId })

  const currentClass = computed<NavClass | null>(() => {
    const category = normaliseCategory(toValue(sources.currentCategory))
    return category ? navClass(category) : null
  })

  const isCurrentChooser = computed(() => toValue(sources.currentView) === 'dashboard')

  const targetClass = computed<NavClass>(() =>
    navClass(normaliseCategory(target.value?.sourceCategory) ?? 'local'),
  )

  // Picker rows are install targets only; remote folds into the cloud rows.
  const targetKind = computed<TargetKind>(() => (targetClass.value === 'cloud' ? 'cloud' : 'instance'))

  const isTargetCurrentHost = computed(() => {
    const id = target.value?.id
    return id != null && id === activeInstallationId.value
  })
  const isTargetRunningHere = computed(() => cta.runningInThisWindow.value)
  const isTargetRunningElsewhere = computed(() => cta.runningElsewhere.value)

  // `self` requires the target live in THIS window; an active-but-not-running id
  // reads `stopped` so the CTA stays "Start", not "Restart".
  const targetRun = computed<TargetRun>(() => {
    if (isTargetCurrentHost.value && isTargetRunningHere.value) return 'self'
    if (isTargetRunningElsewhere.value) return 'running-elsewhere'
    return 'stopped'
  })

  const navInput = (intent: NavInput['intent']): NavInput => ({
    currentView: toValue(sources.currentView),
    target: targetKind.value,
    targetRun: targetRun.value,
    intent,
  })

  return {
    cta,
    currentClass,
    isCurrentChooser,
    targetKind,
    targetClass,
    targetRun,
    isTargetCurrentHost,
    isTargetRunningElsewhere,
    isTargetRunningHere,
    navInput,
  }
}
