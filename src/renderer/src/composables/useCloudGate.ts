import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CloudUserTier, Installation } from '../types/ipc'

export interface CloudGate {
  freeRunsEnabled: Ref<boolean>
  userTier: Ref<CloudUserTier>
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

  async function findCloudInstall(): Promise<Installation | null> {
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
    () => freeRunsEnabled.value && userTier.value === 'free' && cloudInstall.value !== null
  )

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
