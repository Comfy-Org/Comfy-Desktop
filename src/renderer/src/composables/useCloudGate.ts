import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CloudUserTier, Installation } from '../types/ipc'

/**
 * Whether a Comfy Cloud offer may be shown, and how to open it.
 *
 * Both signals fail closed: an unreachable flag service or tier lookup leaves
 * the offer hidden rather than rendering a CTA we can't stand behind. The
 * `'paid'` exclusion matches the dashboard's rule — a subscriber has nothing to
 * gain from a free-tier pitch — and is deliberately looser than first-use's
 * `'unknown'` check, since by install time the user may already have signed in.
 */
export interface CloudGate {
  freeRunsEnabled: Ref<boolean>
  userTier: Ref<CloudUserTier>
  /** True once the flag and tier both allow an offer AND a cloud installation
   *  exists to launch. Never true before `resolve()` has run. */
  canOffer: ComputedRef<boolean>
  resolve: () => Promise<void>
  openCloud: () => Promise<boolean>
}

async function settled<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call()
  } catch {
    return fallback
  }
}

export function useCloudGate(options: { immediate?: boolean } = {}): CloudGate {
  const installationStore = useInstallationStore()
  const sessionStore = useSessionStore()

  const freeRunsEnabled = ref(false)
  const userTier = ref<CloudUserTier>('unknown')
  const cloudInstall = ref<Installation | null>(null)

  /** The auto-seeded cloud instance. The store isn't hydrated on a cold first
   *  launch, so a miss re-reads through main before giving up. */
  async function findCloudInstall(): Promise<Installation | null> {
    // `sourceId` is the persisted identity (main auto-seeds `'cloud'` every
    // boot); `sourceCategory` is decorated onto the record by
    // `getInstallations`. Matching either survives a store that hydrated
    // before the decoration landed.
    const isCloud = (i: Installation): boolean =>
      i.sourceId === 'cloud' || i.sourceCategory === 'cloud'
    const fromStore = installationStore.installations.find(isCloud) ?? null
    if (fromStore) return fromStore
    const all = await settled(() => window.api.getInstallations(), [] as Installation[])
    return all.find(isCloud) ?? null
  }

  async function resolve(): Promise<void> {
    const [enabled, tier, install] = await Promise.all([
      settled(() => window.api.getCloudFreeRunsEnabled(), false),
      settled(() => window.api.getCloudUserTier(), 'unknown' as CloudUserTier),
      findCloudInstall()
    ])
    freeRunsEnabled.value = enabled
    userTier.value = tier
    cloudInstall.value = install
  }

  const canOffer = computed(
    () => freeRunsEnabled.value && userTier.value !== 'paid' && cloudInstall.value !== null
  )

  /**
   * Open Cloud in its own window, leaving whatever is running here untouched.
   * Focuses an existing cloud window instead of launching a second one — a
   * focus miss (the window was closed but the session record lingers) falls
   * through to a normal launch. Returns false when there's nothing to open.
   *
   * The launch runs the install's own primary action rather than
   * `openInstallWindow`, which only focuses an already-open window and
   * otherwise drops the user on the chooser.
   */
  async function openCloud(): Promise<boolean> {
    const install = cloudInstall.value ?? (await findCloudInstall())
    if (!install) return false
    if (sessionStore.isRunning(install.id) || sessionStore.isLaunching(install.id)) {
      const focused = await settled(() => window.api.focusComfyWindow(install.id), false)
      if (focused) return true
    }
    const actions = await settled(() => window.api.getListActions(install.id), [])
    const launch =
      actions.find((a) => a.id === 'launch') ?? actions.find((a) => a.style === 'primary') ?? null
    if (!launch) return false
    const result = await settled(() => window.api.runAction(install.id, launch.id), null)
    return !!result?.ok
  }

  if (options.immediate !== false) onMounted(resolve)

  return { freeRunsEnabled, userTier, canOffer, resolve, openCloud }
}
