import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { useCloudGate } from './useCloudGate'
import { useSessionStore } from '../stores/sessionStore'

const cloudInstall = { id: 'inst-cloud', name: 'Comfy Cloud', sourceId: 'cloud' }
const localInstall = { id: 'inst-local', name: 'ComfyUI', sourceId: 'desktop' }

interface ApiStub {
  getCloudFreeRunsEnabled: ReturnType<typeof vi.fn>
  getCloudUserTier: ReturnType<typeof vi.fn>
  getInstallations: ReturnType<typeof vi.fn>
  getListActions: ReturnType<typeof vi.fn>
  runAction: ReturnType<typeof vi.fn>
  focusComfyWindow: ReturnType<typeof vi.fn>
  openInstallWindow: ReturnType<typeof vi.fn>
  onInstallationsChanged: ReturnType<typeof vi.fn>
}

let api: ApiStub

function stubApi(over: Partial<Record<keyof ApiStub, unknown>> = {}): void {
  api = {
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(true),
    getCloudUserTier: vi.fn().mockResolvedValue('free'),
    getInstallations: vi.fn().mockResolvedValue([localInstall, cloudInstall]),
    getListActions: vi.fn().mockResolvedValue([{ id: 'launch', label: 'Launch' }]),
    runAction: vi.fn().mockResolvedValue({ ok: true }),
    focusComfyWindow: vi.fn().mockResolvedValue(true),
    openInstallWindow: vi.fn().mockResolvedValue(true),
    onInstallationsChanged: vi.fn(),
    ...over
  } as ApiStub
  // The stores this composable pulls in subscribe to several `on*` channels;
  // a Proxy answers any of them with a no-op unsubscribe so the test only has
  // to spell out the calls it actually asserts on.
  const withListeners = new Proxy(api as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (prop.startsWith('on')) return () => () => {}
      return undefined
    },
    has: () => true
  })
  vi.stubGlobal('window', { api: withListeners })
}

let stops: Array<() => void> = []

function setup() {
  const scope = effectScope()
  const gate = scope.run(() => useCloudGate({ immediate: false }))!
  stops.push(() => scope.stop())
  return gate
}

beforeEach(() => {
  setActivePinia(createPinia())
  stops = []
  stubApi()
})

afterEach(() => {
  stops.forEach((stop) => stop())
  vi.unstubAllGlobals()
})

describe('finding the cloud install', () => {
  it('picks the cloud record out of the list', async () => {
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(true)
  })

  it('matches on sourceCategory when sourceId is absent', async () => {
    stubApi({
      getInstallations: vi
        .fn()
        .mockResolvedValue([{ id: 'inst-c', name: 'Comfy Cloud', sourceCategory: 'cloud' }])
    })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(true)
  })

  it('offers nothing when no cloud install exists', async () => {
    stubApi({ getInstallations: vi.fn().mockResolvedValue([localInstall]) })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(false)
  })
})

describe('the gate fails closed', () => {
  it('stays shut when the flag is off', async () => {
    stubApi({ getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(false) })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(false)
  })

  it('stays shut for a paying user', async () => {
    stubApi({ getCloudUserTier: vi.fn().mockResolvedValue('paid') })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(false)
  })

  it('stays shut when the flag fetch throws', async () => {
    stubApi({ getCloudFreeRunsEnabled: vi.fn().mockRejectedValue(new Error('offline')) })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(false)
  })

  // A tier-fetch error is NOT a new-user `'unknown'` — we don't know if they're
  // paying, so advertising "free" would be wrong. Fail closed.
  it('stays shut when the tier lookup throws', async () => {
    stubApi({ getCloudUserTier: vi.fn().mockRejectedValue(new Error('offline')) })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(false)
  })
})

describe('the offer targets non-paying users', () => {
  it('offers to a confirmed free user', async () => {
    stubApi({ getCloudUserTier: vi.fn().mockResolvedValue('free') })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(true)
  })

  // The "Try Cloud free" copy targets new/unsigned users, whose tier resolves to
  // `'unknown'` until the cloud page signs in. A *resolved* unknown must offer —
  // distinct from a fetch error, which fails closed above.
  it('offers when the tier resolves to unknown (fresh, unsigned launch)', async () => {
    stubApi({ getCloudUserTier: vi.fn().mockResolvedValue('unknown') })
    const gate = setup()
    await gate.resolve()
    expect(gate.canOffer.value).toBe(true)
  })
})

describe('opening cloud', () => {
  it('launches the install rather than opening the chooser', async () => {
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(true)
    expect(api.runAction).toHaveBeenCalledWith('inst-cloud', 'launch')
    expect(api.openInstallWindow).not.toHaveBeenCalled()
  })

  it('resolves the install on demand when resolve has not run', async () => {
    const gate = setup()
    expect(await gate.openCloud()).toBe(true)
    expect(api.runAction).toHaveBeenCalledWith('inst-cloud', 'launch')
  })

  it('falls back to the primary action when there is no launch id', async () => {
    stubApi({
      getListActions: vi.fn().mockResolvedValue([{ id: 'open', label: 'Open', style: 'primary' }])
    })
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(true)
    expect(api.runAction).toHaveBeenCalledWith('inst-cloud', 'open')
  })

  it('focuses an already-running cloud window instead of launching twice', async () => {
    const gate = setup()
    await gate.resolve()
    useSessionStore().runningInstances.set('inst-cloud', {} as never)

    expect(await gate.openCloud()).toBe(true)
    expect(api.focusComfyWindow).toHaveBeenCalledWith('inst-cloud')
    expect(api.runAction).not.toHaveBeenCalled()
  })

  it('does not relaunch cloud while a launch is already in progress', async () => {
    const gate = setup()
    await gate.resolve()
    useSessionStore().launchingInstances.set('inst-cloud', { installationName: 'Comfy Cloud' })

    expect(await gate.openCloud()).toBe(true)
    expect(api.focusComfyWindow).not.toHaveBeenCalled()
    expect(api.runAction).not.toHaveBeenCalled()
  })

  it('launches when the focus misses, so a stale session cannot strand it', async () => {
    stubApi({ focusComfyWindow: vi.fn().mockResolvedValue(false) })
    const gate = setup()
    await gate.resolve()
    useSessionStore().runningInstances.set('inst-cloud', {} as never)

    expect(await gate.openCloud()).toBe(true)
    expect(api.runAction).toHaveBeenCalledWith('inst-cloud', 'launch')
  })

  it('reports failure when there is nothing to open', async () => {
    stubApi({ getInstallations: vi.fn().mockResolvedValue([localInstall]) })
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(false)
  })

  it('reports failure when the action list is empty', async () => {
    stubApi({ getListActions: vi.fn().mockResolvedValue([]) })
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(false)
  })

  it('reports failure when the launch itself is rejected', async () => {
    stubApi({ runAction: vi.fn().mockResolvedValue({ ok: false, message: 'nope' }) })
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(false)
  })
})

describe('concurrent clicks', () => {
  it('launches once when clicked twice in a row', async () => {
    const gate = setup()
    await gate.resolve()

    const [a, b] = await Promise.all([gate.openCloud(), gate.openCloud()])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(api.runAction).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh attempt once the first has settled', async () => {
    const gate = setup()
    await gate.resolve()

    await gate.openCloud()
    await gate.openCloud()
    expect(api.runAction).toHaveBeenCalledTimes(2)
  })

  it('does not latch a failure, so a retry can still launch', async () => {
    stubApi({ runAction: vi.fn().mockResolvedValue({ ok: false }) })
    const gate = setup()
    await gate.resolve()
    expect(await gate.openCloud()).toBe(false)

    api.runAction.mockResolvedValue({ ok: true })
    expect(await gate.openCloud()).toBe(true)
  })
})
