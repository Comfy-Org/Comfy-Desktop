import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CloudUserTier, Installation } from '../types/ipc'

/** Whether a Comfy Cloud offer may be shown, and how to open it. Every signal
 *  fails closed, so an unreachable flag service hides the offer rather than
 *  rendering a CTA we cannot stand behind. */
export interface CloudGate {
  freeRunsEnabled: Ref<boolean>
  userTier: Ref<CloudUserTier>
  /** True once the free-runs flag is on, the user isn't a confirmed paying
   *  customer, AND a cloud installation exists to launch. Never true before
   *  `resolve()` has run. */
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
  // Distinguishes a resolved `'unknown'` (new/unsigned user — offer them) from a
  // failed tier fetch (we don't know their tier — fail closed). Both would read
  // `'unknown'` otherwise, and blindly advertising "free" on an error is wrong.
  const tierResolved = ref(false)
  const cloudInstall = ref<Installation | null>(null)

  /** A miss re-reads through main, since the store is empty on a cold start. */
  async function findCloudInstall(): Promise<Installation | null> {
    // `sourceId` is persisted; `sourceCategory` is decorated on by
    // `getInstallations`. Matching either survives an early-hydrated store.
    const isCloud = (i: Installation): boolean =>
      i.sourceId === 'cloud' || i.sourceCategory === 'cloud'
    const fromStore = installationStore.installations.find(isCloud) ?? null
    if (fromStore) return fromStore
    const all = await settled(() => window.api.getInstallations(), [] as Installation[])
    return all.find(isCloud) ?? null
  }

  async function resolveTier(): Promise<{ tier: CloudUserTier; resolved: boolean }> {
    try {
      return { tier: await window.api.getCloudUserTier(), resolved: true }
    } catch {
      // Fetch failed — leave `resolved` false so the offer fails closed rather
      // than treating an error as a new-user `'unknown'`.
      return { tier: 'unknown', resolved: false }
    }
  }

  async function resolve(): Promise<void> {
    const [enabled, tierResult, install] = await Promise.all([
      settled(() => window.api.getCloudFreeRunsEnabled(), false),
      resolveTier(),
      findCloudInstall()
    ])
    freeRunsEnabled.value = enabled
    userTier.value = tierResult.tier
    tierResolved.value = tierResult.resolved
    cloudInstall.value = install
  }

  // Offer to a non-paying user whose tier we actually resolved. The "Try Cloud
  // free" copy targets new/unsigned users, whose tier reads `'unknown'` until
  // the cloud page signs in — gating on `=== 'free'` hid it from exactly them on
  // a fresh launch. `!== 'paid'` covers `'free'` and a resolved `'unknown'`,
  // while `tierResolved` fails closed on a tier-fetch error (an unknown tier we
  // couldn't confirm), and paid users stay excluded since the copy says "free".
  const canOffer = computed(
    () =>
      freeRunsEnabled.value &&
      tierResolved.value &&
      userTier.value !== 'paid' &&
      cloudInstall.value !== null
  )

  /** Opens Cloud in its own window, leaving this install untouched. Runs the
   *  install's primary action rather than `openInstallWindow`, which only
   *  focuses an open window and otherwise drops the user on the chooser. */
  /** Shared so a double-click cannot fire two launches before the session
   *  store reflects the first. */
  let launching: Promise<boolean> | null = null

  async function openCloud(): Promise<boolean> {
    return (launching ??= run().finally(() => {
      launching = null
    }))
  }

  async function run(): Promise<boolean> {
    const install = cloudInstall.value ?? (await findCloudInstall())
    if (!install) return false
    if (sessionStore.isLaunching(install.id)) return true
    if (sessionStore.isRunning(install.id)) {
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
