import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppsView from './AppsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AppCard, AppExample, AssetSummary, Installation } from '../types/ipc'

const listAssets = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })
const showApps = vi.fn()
const hideApps = vi.fn()
const listApps = vi.fn()
const getAppCover = vi.fn()
const getAppExampleThumb = vi.fn()
let appsLoadFailed: ((info: { url: string }) => void) | null = null
const onAppsLoadFailed = vi.fn((callback: (info: { url: string }) => void) => {
  appsLoadFailed = callback
  return () => {
    appsLoadFailed = null
  }
})
let appsBack: (() => void) | null = null
const onAppsBack = vi.fn((callback: () => void) => {
  appsBack = callback
  return () => {
    appsBack = null
  }
})

function appCard(id: string, over: Partial<AppCard> = {}): AppCard {
  return {
    id,
    title: 'Doodle to Image',
    description: 'Draw the shapes, say what it is, and get a finished picture.',
    page: `/apps/${id}/desktop.html`,
    runsOn: ['cloud', 'local'],
    accent: ['#f472b6', '#d7fd52'],
    sortOrder: 17,
    hasCover: true,
    ...over
  }
}

function example(key: string, over: Partial<AppExample> = {}): AppExample {
  const [appId = '', id = ''] = key.split('/')
  return {
    key,
    appId,
    appTitle: 'Doodle to Image',
    title: id,
    kind: 'image',
    page: `/apps/${appId}/desktop.html?example=${id}`,
    ...over
  }
}

const watchedExamples = new Set<Element>()
let seeExamples: ((entries: Array<{ isIntersecting: boolean; target: Element }>) => void) | null =
  null

class FakeIntersectionObserver {
  constructor(callback: typeof seeExamples) {
    seeExamples = callback
  }
  observe(el: Element): void {
    watchedExamples.add(el)
  }
  unobserve(el: Element): void {
    watchedExamples.delete(el)
  }
  disconnect(): void {
    watchedExamples.clear()
  }
}

function scrollIntoView(testId: string): void {
  const target = document.querySelector(`[data-testid="${testId}"]`)!
  seeExamples!([{ isIntersecting: true, target }])
}

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
    .get('[data-testid="assets-grid"]')
    .findAllComponents(Tooltip)
    .map((tip) => tip.props('text') as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  listApps.mockResolvedValue({
    source: 'website',
    apps: [appCard('doodle-to-image')],
    examples: []
  })
  getAppCover.mockResolvedValue('data:image/jpeg;base64,AQID')
  getAppExampleThumb.mockResolvedValue('data:image/jpeg;base64,BAUG')
  watchedExamples.clear()
  seeExamples = null
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  window.localStorage.clear()
  window.localStorage.setItem('comfy.desktop.apps.tab', 'files')
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    showApps,
    hideApps,
    listApps,
    getAppCover,
    getAppExampleThumb,
    onAppsLoadFailed,
    onAppsBack,
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
  it('opens on All apps the first time, showing the app grid', async () => {
    window.localStorage.clear()
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(showApps).not.toHaveBeenCalled()
    expect(listAssets).not.toHaveBeenCalled()
  })

  it('shows each app with its cover, title, one line and where it runs', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listApps.mockResolvedValue({
      source: 'catalog',
      apps: [
        appCard('doodle-to-image'),
        appCard('make-image', {
          title: 'Make an image',
          description: 'Describe it and get a picture in a few seconds.',
          runsOn: ['cloud'],
          hasCover: false
        })
      ],
      examples: []
    })

    const wrapper = await mountAssets([])

    const doodle = wrapper.get('[data-testid="app-doodle-to-image"]')
    expect(doodle.get('img').attributes('src')).toBe('data:image/jpeg;base64,AQID')
    expect(doodle.text()).toContain('Doodle to Image')
    expect(doodle.get('[data-testid="app-description"]').text()).toBe(
      'Draw the shapes, say what it is, and get a finished picture.'
    )
    expect(doodle.get('[data-testid="app-runs-on"]').text()).toMatch(/Cloud\s*This computer/)

    const make = wrapper.get('[data-testid="app-make-image"]')
    expect(make.find('img').exists()).toBe(false)
    expect(make.get('[data-testid="app-cover"]').attributes('style')).toContain('#f472b6')
    expect(make.get('[data-testid="app-runs-on"]').text()).toBe('Cloud')
    expect(getAppCover).toHaveBeenCalledExactlyOnceWith('doodle-to-image')
  })

  it('lists every example under the apps, loading each picture as it shows', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listApps.mockResolvedValue({
      source: 'catalog',
      apps: [appCard('doodle-to-image')],
      examples: [
        example('doodle-to-image/cottage', { title: 'A cottage' }),
        example('doodle-to-image/rocket', { title: 'A rocket', kind: 'video' })
      ]
    })

    const wrapper = await mountAssets([], [], { attachTo: document.body })

    const section = wrapper.get('[data-testid="apps-examples"]')
    expect(section.text()).toContain('Examples')
    const cottage = wrapper.get('[data-testid="app-example-doodle-to-image/cottage"]')
    expect(cottage.text()).toContain('A cottage')
    expect(cottage.text()).toContain('Doodle to Image')
    expect(cottage.find('img').exists()).toBe(false)
    expect(getAppExampleThumb).not.toHaveBeenCalled()
    expect(watchedExamples.size).toBe(2)

    scrollIntoView('app-example-doodle-to-image/cottage')
    await flushPromises()

    expect(getAppExampleThumb).toHaveBeenCalledExactlyOnceWith('doodle-to-image/cottage')
    expect(cottage.get('img').attributes('src')).toBe('data:image/jpeg;base64,BAUG')
    expect(watchedExamples.size).toBe(1)
    wrapper.unmount()
  })

  it('opens the app page asking for the example when one is clicked', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listApps.mockResolvedValue({
      source: 'catalog',
      apps: [appCard('doodle-to-image')],
      examples: [example('doodle-to-image/cottage'), example('gone-app/cat')]
    })
    const wrapper = await mountAssets([])

    await wrapper.get('[data-testid="app-example-open-gone-app/cat"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)

    await wrapper.get('[data-testid="app-example-open-doodle-to-image/cottage"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="apps-open-title"]').text()).toBe('Doodle to Image')
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({
        page: '/apps/doodle-to-image/desktop.html?example=cottage',
        fresh: true
      })
    )
  })

  it('shows no Examples section when no app has examples', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')

    const wrapper = await mountAssets([])

    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apps-examples"]').exists()).toBe(false)
  })

  it('shows skeleton cards while the app list loads', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listApps.mockReturnValue(new Promise(() => {}))

    const wrapper = await mountAssets([])

    expect(wrapper.findAll('[data-testid="apps-skeleton"] > li')).toHaveLength(8)
  })

  it('shows Coming soon when no app list loads, and tries again on request', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listApps.mockRejectedValueOnce(new Error('offline'))

    const wrapper = await mountAssets([])

    expect(wrapper.get('[data-testid="apps-coming-soon"]').text()).toBe('Coming soon')
    expect(wrapper.get('[data-testid="apps-empty"]').text()).toContain(
      "Couldn't load the list of apps."
    )

    await wrapper.get('[data-testid="apps-retry"]').trigger('click')
    await flushPromises()

    expect(listApps).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
  })

  it('opens an app page from its card and returns to the grid with the back button', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    const wrapper = await mountAssets([])

    await wrapper.get('[data-testid="app-open-doodle-to-image"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="apps-open-title"]').text()).toBe('Doodle to Image')
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({ page: '/apps/doodle-to-image/desktop.html', fresh: true })
    )

    await wrapper.get('[data-testid="apps-back"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
    expect(hideApps).toHaveBeenCalled()
  })

  it('returns to the grid when the app page links back to the app list', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    const wrapper = await mountAssets([])
    await wrapper.get('[data-testid="app-open-doodle-to-image"]').trigger('click')
    await flushPromises()

    appsBack!()
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
  })

  it('shows Coming soon and the address when an app page cannot load, and retries on reopening', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    const wrapper = await mountAssets([])
    await wrapper.get('[data-testid="app-open-doodle-to-image"]').trigger('click')
    await flushPromises()

    appsLoadFailed!({ url: 'https://apps.example/apps/doodle-to-image/desktop.html' })
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-coming-soon"]').text()).toBe('Coming soon')
    expect(wrapper.get('[data-testid="apps-load-failed"]').text()).toContain(
      'https://apps.example/apps/doodle-to-image/desktop.html'
    )
    expect(hideApps).toHaveBeenCalled()

    showApps.mockClear()
    await wrapper.get('[data-testid="apps-back"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="app-open-doodle-to-image"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apps-load-failed"]').exists()).toBe(false)
    expect(showApps).toHaveBeenCalledWith(expect.objectContaining({ fresh: true }))
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

    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
  })

  it('shows the app grid under All apps without loading assets, then loads Generated Files', async () => {
    window.localStorage.setItem('comfy.desktop.apps.tab', 'all')
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assets-filter"]').exists()).toBe(false)
    expect(listAssets).not.toHaveBeenCalled()

    await wrapper
      .findAll('button')
      .find((n) => n.text() === 'Generated Files')!
      .trigger('click')
    await flushPromises()

    expect(listAssets).toHaveBeenCalledOnce()
    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="apps-grid"]').exists()).toBe(false)
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    listAssets.mockReturnValue(new Promise(() => {}))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
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

  it('reports a failed load', async () => {
    listAssets.mockRejectedValue(new Error('offline'))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })
})
