import { computed, type ComputedRef, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { useInstallCta, type InstallCta } from './useInstallCta'
import { navClass, normaliseCategory } from '../../../shared/viewKind'
import type { Category, NavClass, ViewKind } from '../../../shared/viewKind'
import type { NavInput, TargetKind, TargetRun } from '../../../shared/navigation/navDecision'
import type { Installation } from '../types/ipc'

export interface InstanceNavState {
  cta: InstallCta
  currentClass: ComputedRef<NavClass | null>
  isCurrentChooser: ComputedRef<boolean>
  targetKind: ComputedRef<TargetKind>
  targetClass: ComputedRef<NavClass>
  targetRun: ComputedRef<TargetRun>
  isTargetCurrentHost: ComputedRef<boolean>
  isTargetRunningElsewhere: ComputedRef<boolean>
  isTargetRunningHere: ComputedRef<boolean>
  navInput: (intent: NavInput['intent']) => NavInput
}

export interface InstanceNavStateSources {
  currentView: MaybeRefOrGetter<ViewKind>
  currentCategory: MaybeRefOrGetter<Category | null>
  activeInstallationId: MaybeRefOrGetter<string | null | undefined>
}

export function useInstanceNavState(
  target: Ref<Installation | null | undefined>,
  sources: InstanceNavStateSources
): InstanceNavState {
  const activeInstallationId = computed(() => toValue(sources.activeInstallationId) ?? null)
  const cta = useInstallCta(target, { activeInstallationId })

  const currentClass = computed<NavClass | null>(() => {
    const category = normaliseCategory(toValue(sources.currentCategory))
    return category ? navClass(category) : null
  })

  const isCurrentChooser = computed(() => toValue(sources.currentView) === 'dashboard')

  const targetClass = computed<NavClass>(() =>
    navClass(normaliseCategory(target.value?.sourceCategory) ?? 'local')
  )

  const targetKind = computed<TargetKind>(() =>
    targetClass.value === 'cloud' ? 'cloud' : 'instance'
  )

  const isTargetCurrentHost = computed(() => {
    const id = target.value?.id
    return id != null && id === activeInstallationId.value
  })
  const isTargetRunningHere = computed(() => cta.runningInThisWindow.value)
  const isTargetRunningElsewhere = computed(() => cta.runningElsewhere.value)

  const targetRun = computed<TargetRun>(() => {
    if (isTargetCurrentHost.value && isTargetRunningHere.value) return 'self'
    if (isTargetRunningElsewhere.value) return 'running-elsewhere'
    return 'stopped'
  })

  const navInput = (intent: NavInput['intent']): NavInput => ({
    currentView: toValue(sources.currentView),
    target: targetKind.value,
    targetRun: targetRun.value,
    intent
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
    navInput
  }
}
