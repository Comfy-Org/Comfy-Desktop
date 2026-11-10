import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppsView from './AppsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AssetSummary, CatalogApp, Installation } from '../types/ipc'

const listAssets = vi.fn()
const downloadAsset = vi.fn()
const alert = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })
const showApps = vi.fn()
const hideApps = vi.fn()
let appsLoadFailed: ((info: { url: string }) => void) | null = null
const onAppsLoadFailed = vi.fn((callback: (info: { url: string }) => void) => {
  appsLoadFailed = callback
  return () => {
    appsLoadFailed = null
  }
})

const listCatalogApps = vi.fn()
let appsAppOpen: ((info: { open: boolean }) => void) | null = null
const onAppsAppOpen = vi.fn((callback: (info: { open: boolean }) => void) => {
  appsAppOpen = callback
  return () => {
    appsAppOpen = null
  }
})

vi.mock('../composables/useModal', () => ({
  useModal: () => ({ alert })
}))

function asset(id: string, name: string, kind: AssetSummary['kind']): AssetSummary {
  return {
    id,
    name,
    kind,
    sizeBytes: 1024,
    createdAt: null,
    mimeType: null,
    tags: ['output'],
    previewUrl: null
  }
}

function build(id: string, name: string): Installation {
  return { id, name, sourceLabel: 'Standalone', sourceCategory: 'local' }
}

async function mountAssets(
  running: Installation[],
  stopped: Installation[] = [],
  options: { attachTo?: HTMLElement } = {}
) {
  useInstallationStore().installations = [...running, ...stopped]
  const sessions = useSessionStore()
  for (const inst of running) {
    sessions.runningInstances.set(inst.id, {
      installationId: inst.id,
      installationName: inst.name,
      mode: 'app'
    })
  }
  const wrapper = mount(AppsView, options)
  await flushPromises()
  return wrapper
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper
    .findAll('[data-testid^="asset-open-"]')
    .map((card) => card.attributes('aria-label')!.replace('Inspect ', ''))
}

function catalogApp(id: string, title: string): CatalogApp {
  return {
    id,
    title,
    description: `${title} description`,
    thumbnailUrl: `https://comfy.org/catalog-media/${id}/v1`,
    url: `https://apps.example/apps/${id}/desktop.html`
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listCatalogApps.mockResolvedValue([])
  window.localStorage.clear()
  window.localStorage.setItem('comfy.desktop.apps.tab', 'files')
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    downloadAsset,
    showApps,
    hideApps,
    listCatalogApps,
    onAppsLoadFailed,
    onAppsAppOpen,
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      signIn,
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

describe('AppsView', () => {
  it('opens on All apps the first time, showing the app cards from the catalog', async () => {
    window.localStorage.clear()
    listCatalogApps.mockResolvedValue([
      catalogApp('studio', 'Cinematic Studio'),
      catalogApp('reshoot', 'Re-shoot a video')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    const cards = wrapper.findAll('[data-testid^="app-card-"]')
    expect(cards.map((card) => card.find('span span').text())).toEqual([
      'Cinematic Studio',
      'Re-shoot a video'
    ])
    expect(cards[0]!.text()).toContain('Cinematic Studio description')
    expect(cards[0]!.get('img').attributes('src')).toBe('https://comfy.org/catalog-media/studio/v1')
    expect(showApps).not.toHaveBeenCalled()
    expect(listAssets).not.toHaveBeenCalled()
  })

  it('opens an app from its card over the whole page and returns to the cards when the app goes back', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({
        fresh: true,
        url: 'https://apps.example/apps/studio/desktop.html'
      })
    )
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assets-toolbar"]').exists()).toBe(false)

    appsAppOpen!({ open: true })
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)

    appsAppOpen!({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(hideApps).toHaveBeenCalled()
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-card-studio"]').exists()).toBe(true)
    expect(listCatalogApps).toHaveBeenCalledOnce()
  })

  it('shows the address when an app cannot load, and opens it again from its card', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    appsLoadFailed!({ url: 'https://apps.example/apps/studio/desktop.html' })
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-load-failed"]').text()).toContain(
      'https://apps.example/apps/studio/desktop.html'
    )

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apps-load-failed"]').exists()).toBe(false)
  })

  it('shows Coming soon for an empty catalog and says so when it cannot be reached', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    const empty = await mountAssets([build('lab', 'Video Lab')])
    expect(empty.get('[data-testid="apps-coming-soon"]').text()).toBe('Coming soon')
    empty.unmount()

    listCatalogApps.mockRejectedValue(new Error('offline'))
    const offline = await mountAssets([build('lab', 'Video Lab')])
    expect(offline.get('[data-testid="apps-catalog-failed"]').text()).toBe(
      "Couldn't load the apps."
    )
    expect(offline.find('[data-testid="apps-coming-soon"]').exists()).toBe(false)
  })

  it('starts in masonry with file names and details hidden', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('columns-[200px]')
    expect(wrapper.get('[data-testid="asset-a"]').text()).not.toContain('forest.png')
  })

  it('opens with the view setup the user saved last time', async () => {
    window.localStorage.setItem('comfy.desktop.assets.layout', 'grid')
    window.localStorage.setItem('comfy.desktop.assets.showName', 'true')
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-grid"]').classes()).toContain('grid')
    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('forest.png')
  })

  it('shows the assets of every running build and skips stopped ones', async () => {
    listAssets.mockImplementation(async (id: string) =>
      id === 'lab' ? [asset('a', 'surfer.mp4', 'video')] : [asset('b', 'forest.png', 'image')]
    )

    const wrapper = await mountAssets(
      [build('lab', 'Video Lab'), build('flux', 'Flux Sandbox')],
      [build('old', 'My Local 1')]
    )

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['lab', 'flux'])
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('loads the Cloud assets once when the account has several Cloud builds', async () => {
    const cloud = (id: string) => ({ ...build(id, id), sourceCategory: 'cloud' })
    useInstallationStore().installations = [cloud('cloud-a'), cloud('cloud-b')]
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = mount(AppsView)
    await flushPromises()
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['cloud-a'])
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('filters by asset type and by name', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="assets-filter"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    document.querySelector<HTMLElement>('[data-testid="assets-filter-image"]')!.click()
    await flushPromises()
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
  })

  it('asks a signed-out user to log in to Comfy Cloud', async () => {
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]
    const wrapper = mount(AppsView)
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain(
      'Log in to see your assets'
    )
    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('still asks a signed-out user to log in when a local build has no assets', async () => {
    listAssets.mockResolvedValue([])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(listAssets).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('Log in to see your assets')
  })

  it('ignores a cancelled log-in', async () => {
    signIn.mockRejectedValueOnce(new Error('cancelled'))
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]
    const wrapper = mount(AppsView)
    await flushPromises()

    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="assets-empty-action"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('points a signed-in user with no assets to the apps', async () => {
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]
    listAssets.mockResolvedValue([])
    const wrapper = mount(AppsView)
    await flushPromises()
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe('Open an app to make assets.')
    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-coming-soon"]').exists()).toBe(true)
  })

  it('shows the app cards under All apps without loading assets, then loads Generated Files', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.find('[data-testid="apps-coming-soon"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assets-filter"]').exists()).toBe(false)
    expect(listAssets).not.toHaveBeenCalled()

    await wrapper
      .findAll('button')
      .find((n) => n.text() === 'Generated Files')!
      .trigger('click')
    await flushPromises()

    expect(listAssets).toHaveBeenCalledOnce()
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    listAssets.mockReturnValue(new Promise(() => {}))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('opens an asset in the detail view, steps through assets and returns', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    const detail = wrapper.get('[data-testid="asset-detail"]')
    expect(detail.text()).toContain('Video Lab · 1 / 2')

    await wrapper.get('[data-testid="asset-detail-next"]').trigger('click')
    expect(wrapper.get('[data-testid="asset-detail-panel"] h2').text()).toBe('forest.png')

    await wrapper.get('[data-testid="asset-detail-download"]').trigger('click')
    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('lab', 'b', 'forest.png')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="asset-detail"]').exists()).toBe(false)
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('tells the user when a download fails', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    downloadAsset.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await wrapper.get('[data-testid="asset-detail-download"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't download asset",
      message: 'forest.png'
    })
  })

  it('does not reload when the running builds stay the same', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    await mountAssets([build('lab', 'Video Lab')])

    useInstallationStore().installations = [{ ...build('lab', 'Video Lab Renamed') }]
    await flushPromises()

    expect(listAssets).toHaveBeenCalledOnce()
  })

  it('delays the first name tooltip, then shows the rest at once until the pointer leaves', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    const delays = () => wrapper.findAllComponents(Tooltip).map((tip) => tip.props('delayMs'))
    expect(delays()).toEqual([600, 600])

    vi.useFakeTimers()
    try {
      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerenter')
      await vi.advanceTimersByTimeAsync(600)
      expect(delays()).toEqual([0, 0])

      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerleave')
      expect(delays()).toEqual([600, 600])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the assets of builds that answered when another build fails', async () => {
    listAssets.mockImplementation(async (id: string) => {
      if (id === 'old') throw new Error('assets API disabled')
      return [asset('a', 'forest.png', 'image')]
    })

    const wrapper = await mountAssets([build('lab', 'Video Lab'), build('old', 'Old Build')])

    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('keeps showing the same file when the assets reload in a new order', async () => {
    const newer = (id: string, name: string, at: string) => ({
      ...asset(id, name, 'image'),
      createdAt: at
    })
    listAssets.mockResolvedValue([
      newer('a', 'first.png', '2026-01-02T00:00:00Z'),
      newer('b', 'second.png', '2026-01-01T00:00:00Z')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await wrapper.get('[data-testid="asset-open-b"]').trigger('click')
    expect(wrapper.get('[data-testid="asset-detail-panel"] h2').text()).toBe('second.png')

    listAssets.mockResolvedValue([
      newer('c', 'brand-new.png', '2026-01-03T00:00:00Z'),
      newer('a', 'first.png', '2026-01-02T00:00:00Z'),
      newer('b', 'second.png', '2026-01-01T00:00:00Z')
    ])
    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.get('[data-testid="asset-detail-panel"] h2').text()).toBe('second.png')
  })

  it('reloads when the signed-in workspace changes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    await mountAssets([build('lab', 'Video Lab')])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listAssets).toHaveBeenCalledTimes(2)
  })

  it('says nothing matches when a search hides every asset', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('input').setValue('zzz')

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
  })

  it('returns focus to the opened card when the detail view closes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')], [], { attachTo: document.body })

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await wrapper.get('[data-testid="asset-detail-back"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="asset-open-a"]').element)
    wrapper.unmount()
  })

  it('reports a failed load', async () => {
    listAssets.mockRejectedValue(new Error('offline'))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })
})
