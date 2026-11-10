import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useModal } from './useModal'
import { i18n } from '../i18n'

export type OverlayKind = 'progress' | 'takeover'

export interface ProgressOverlay {
  kind: 'progress'
  installationId: string
  operationName?: string
  onCancel?: () => void
}

export type FlowComponent = 'new-install' | 'track' | 'load-snapshot' | 'quick-install'

export interface TakeoverOverlay {
  kind: 'takeover'
  component: string
  operationName?: string
  installationId?: string
  cancelCopyKey?: 'quit-setup' | 'discard-setup'
  onCancel?: () => void
}

export type Overlay = ProgressOverlay | TakeoverOverlay

const TIER: Record<OverlayKind, 2 | 3> = {
  progress: 2,
  takeover: 3
}

export function tierOf(o: Overlay | null): 0 | 2 | 3 {
  return o ? TIER[o.kind] : 0
}

export interface OpenOverlayOpts {
  from?: OverlayKind
}

export interface UseOverlayApi {
  current: Ref<Overlay | null>
  tier: ComputedRef<number>
  openOverlay: (next: Overlay | null, opts?: OpenOverlayOpts) => Promise<boolean>
  closeOverlay: () => Promise<boolean>
}

const _current = ref<Overlay | null>(null)
const _tier = computed(() => tierOf(_current.value))

export function useOverlay(): UseOverlayApi {
  const current = _current
  const modal = useModal()

  const tier = _tier

  async function confirmCancelCurrent(cur: Overlay): Promise<boolean> {
    const t = i18n.global.t
    if (cur.kind === 'takeover' && cur.cancelCopyKey === 'quit-setup') {
      return await modal.confirm({
        title: t('overlay.quitSetupTitle'),
        message: t('overlay.quitSetupMessage'),
        confirmLabel: t('overlay.quitSetupConfirm'),
        confirmStyle: 'danger'
      })
    }
    if (cur.kind === 'takeover' && cur.cancelCopyKey === 'discard-setup') {
      return await modal.confirm({
        title: t('overlay.discardSetupTitle'),
        message: t('overlay.discardSetupMessage'),
        confirmLabel: t('overlay.discardSetupConfirm'),
        confirmStyle: 'danger'
      })
    }
    const curName =
      cur.kind === 'progress' || cur.kind === 'takeover' ? cur.operationName : undefined
    const title = curName
      ? t('overlay.cancelNamedTitle', { name: curName })
      : t('overlay.cancelCurrentTitle')
    return await modal.confirm({
      title,
      message: t('overlay.cancelMessage'),
      confirmLabel: t('overlay.cancelConfirm'),
      confirmStyle: 'danger'
    })
  }

  async function openOverlay(next: Overlay | null, _opts: OpenOverlayOpts = {}): Promise<boolean> {
    const cur = current.value
    const curTier = tierOf(cur)
    const nextTier = next ? TIER[next.kind] : 0

    if (cur?.kind === 'progress' && nextTier >= 2) {
      const ok = await confirmCancelCurrent(cur)
      if (!ok) return false
      cur.onCancel?.()
    }
    if (next === null && (cur?.kind === 'progress' || cur?.kind === 'takeover')) {
      const ok = await confirmCancelCurrent(cur)
      if (!ok) return false
      cur.onCancel?.()
    }

    if (cur?.kind === 'takeover' && next?.kind === 'takeover') {
      const sameInstall =
        cur.installationId !== undefined && cur.installationId === next.installationId
      if (!sameInstall) cur.onCancel?.()
    }
    void curTier
    current.value = next
    return true
  }

  async function closeOverlay(): Promise<boolean> {
    return openOverlay(null)
  }

  return { current, tier, openOverlay, closeOverlay }
}
