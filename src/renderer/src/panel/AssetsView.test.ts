import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  AssetSummary,
  Installation,
  OutputEntry,
  OutputFolder,
  OutputFolderListing
} from '../types/ipc'

const listAssets = vi.fn()
const downloadAsset = vi.fn()
const listOutputFolders = vi.fn()
const listOutputFolder = vi.fn()
const openPath = vi.fn()
const revealPath = vi.fn()
const alert = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })

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

const SHARED = '/Users/me/ComfyUI-Shared/output'
const APPS = '/Users/me/ComfyUI-Apps/output'

function outputFolders(): OutputFolder[] {
  return [
    { path: SHARED, shared: true, builds: ['Test Instance', 'My Local 1'] },
    { path: APPS, shared: false, builds: ['Apps'] }
  ]
}

function entry(dir: string, name: string, kind: OutputEntry['kind'], day = 1): OutputEntry {
  const path = `${dir}/${name}`
  return {
    name,
    path,
    isFolder: kind === null && !name.includes('.'),
    kind,
    sizeBytes: kind === null ? null : 2048,
    modifiedAt: `2026-11-0${day}T10:00:00.000Z`,
    previewUrl: kind ? `comfy-output://file/${encodeURIComponent(path)}` : null,
    thumbnailUrl:
      kind === 'image' ? `comfy-output://file/${encodeURIComponent(path)}?thumbnail` : null
  }
}

function listing(entries: OutputEntry[], truncated = false): OutputFolderListing {
  return { entries, truncated }
}

async function openThisComputer(wrapper: Awaited<ReturnType<typeof mountAssets>>): Promise<void> {
  const tab = wrapper.get('[data-testid="assets-place"]').findAll('button')[1]!
  await tab.trigger('mousedown')
  await tab.trigger('click')
  await flushPromises()
}

function build(id: string, name: string): Installation {
  return { id, name, sourceLabel: 'Standalone', sourceCategory: 'local' }
}

async function mountAssets(
  running: Installation[],
  stopped: Installation[] = [],
  options: { attachTo?: HTMLElement; props?: { startOnCloud?: boolean } } = {}
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
  const wrapper = mount(AssetsView, {
    attachTo: options.attachTo,
    props: options.props,
    global: { stubs: { teleport: { template: '<div><slot /></div>' } } }
  })
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
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    downloadAsset,
    listOutputFolders,
    listOutputFolder,
    openPath,
    revealPath,
    platform: 'darwin',
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

describe('AssetsView', () => {
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
    const wrapper = mount(AssetsView)
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
    await wrapper.get('[data-testid="assets-filter-image"]').trigger('click')
    await flushPromises()
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
  })

  it('asks a signed-out user to log in to Comfy Cloud', async () => {
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]
    const wrapper = mount(AssetsView)
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
    const wrapper = mount(AssetsView)
    await flushPromises()

    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="assets-empty-action"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('tells a signed-in user with no assets where they come from', async () => {
    const cloud = { ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }
    useInstallationStore().installations = [cloud]
    listAssets.mockResolvedValue([])
    const wrapper = mount(AssetsView)
    await flushPromises()
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe('Open an app to make assets.')
    expect(wrapper.find('[data-testid="assets-empty-action"]').exists()).toBe(false)
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    listAssets.mockReturnValue(new Promise(() => {}))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('downloads a file from its card', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-download-b"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('lab', 'b', 'forest.png')
  })

  it('opens an asset in the output dialog over the cards, steps through assets and closes', async () => {
    listAssets.mockResolvedValue([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('surfer.mp4')
    expect(wrapper.get('[data-testid="asset-open-b"]').isVisible()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('forest.png')
    expect(wrapper.find('[data-testid="output-detail-workflow"]').exists()).toBe(false)

    await wrapper.get('[data-testid="output-detail-download"]').trigger('click')
    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('lab', 'b', 'forest.png')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('leaves the arrow keys to a video that has focus', async () => {
    listAssets.mockResolvedValue([
      { ...asset('a', 'surfer.mp4', 'video'), previewUrl: 'http://127.0.0.1:8188/surfer.mp4' },
      asset('b', 'forest.png', 'image')
    ])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')

    wrapper
      .get('video[controls]')
      .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('surfer.mp4')
  })

  it('starts one download at a time for a file', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    let finish: () => void = () => {}
    downloadAsset.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    const button = wrapper.get('[data-testid="asset-download-a"]')

    await button.trigger('click')
    await button.trigger('click')

    expect(downloadAsset).toHaveBeenCalledOnce()
    expect(button.attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('tells the user when a download fails', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    downloadAsset.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-download-a"]').trigger('click')
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

  it('reloads when the signed-in workspace changes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    await mountAssets([build('lab', 'Video Lab')])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listAssets).toHaveBeenCalledTimes(2)
  })

  it('clears the previous workspace assets while the new workspace loads', async () => {
    listAssets.mockResolvedValueOnce([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    listAssets.mockReturnValueOnce(new Promise(() => {}))

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assets-skeleton"]').exists()).toBe(true)
  })

  it('reports a failed load when one build fails and the others have no assets', async () => {
    listAssets.mockImplementation(async (id: string) => {
      if (id === 'old') throw new Error('offline')
      return []
    })

    const wrapper = await mountAssets([build('lab', 'Video Lab'), build('old', 'Old Build')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('says nothing matches when a search hides every asset', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('input').setValue('zzz')

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
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
    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('second.png')

    listAssets.mockImplementation(async (installationId: string) =>
      installationId === 'lab'
        ? [
            newer('c', 'brand-new.png', '2026-01-03T00:00:00Z'),
            newer('a', 'first.png', '2026-01-02T00:00:00Z'),
            newer('b', 'second.png', '2026-01-01T00:00:00Z')
          ]
        : []
    )
    const other = build('other', 'Other Lab')
    useInstallationStore().installations = [build('lab', 'Video Lab'), other]
    useSessionStore().runningInstances.set(other.id, {
      installationId: other.id,
      installationName: other.name,
      mode: 'app'
    })
    await flushPromises()

    expect(listAssets).toHaveBeenCalledWith('other')

    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('second.png')
  })

  it('closes the detail view for good when its file goes away on a reload', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')

    listAssets.mockResolvedValue([])
    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)

    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    useAuthStore().status = { signedIn: true, workspaceId: 'team-c' }
    await flushPromises()
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
  })

  it('returns focus to the opened card when the detail view closes', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')], [], { attachTo: document.body })

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await wrapper.get('[data-testid="output-detail-close"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="asset-open-a"]').element)
    wrapper.unmount()
  })

  it('reports a failed load', async () => {
    listAssets.mockRejectedValue(new Error('offline'))

    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('keeps the white Download button readable', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets([build('lab', 'Video Lab')])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')

    expect(wrapper.get('[data-testid="output-detail-download"]').classes()).toContain(
      'text-background'
    )
  })
})

describe('AssetsView opened from an app result', () => {
  it('shows the Comfy Cloud assets for this visit only, without opening a file', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'computer')
    listOutputFolders.mockResolvedValue([])
    listAssets.mockResolvedValue([
      asset('a', 'forest.png', 'image'),
      asset('b', 'cloud-cutout.png', 'image')
    ])

    const wrapper = await mountAssets(
      [{ ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }],
      [],
      { props: { startOnCloud: true } }
    )
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(assetNames(wrapper)).toEqual(['forest.png', 'cloud-cutout.png'])
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('computer')
  })
})

describe('AssetsView on This computer', () => {
  beforeEach(() => {
    listAssets.mockResolvedValue([])
    listOutputFolders.mockResolvedValue(outputFolders())
  })

  it('shows each output folder by its own name and where it is, under the builds that save there', async () => {
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await openThisComputer(wrapper)
    const cloudLoads = listAssets.mock.calls.length

    const heading = (path: string) => wrapper.get(`[data-testid="local-folder-heading-${path}"] h2`)
    const card = (path: string) => wrapper.get(`[data-testid="local-folder-${path}"]`)
    expect(heading(SHARED).text()).toBe('Test Instance, My Local 1')
    expect(
      card(SHARED)
        .findAll('span')
        .map((span) => span.text())
    ).toEqual(['output', '/Users/…/ComfyUI-Shared'])
    expect(card(SHARED).attributes('title')).toBe(SHARED)
    expect(heading(APPS).text()).toBe('Apps')
    expect(
      card(APPS)
        .findAll('span')
        .map((span) => span.text())
    ).toEqual(['output', '/Users/…/ComfyUI-Apps'])
    expect(wrapper.find('[data-testid="assets-filter"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="local-open-folder"]').exists()).toBe(false)

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()
    expect(listOutputFolders).toHaveBeenCalledTimes(2)
    expect(listAssets).toHaveBeenCalledTimes(cloudLoads)
  })

  it.each([
    ['C:\\Users\\me\\ComfyUI-Shared\\output', 'C:\\…\\ComfyUI-Shared'],
    ['\\\\server\\share\\renders\\output', '\\\\server\\share\\renders'],
    ['\\\\server\\shareB\\jobs\\renders\\output', '\\\\server\\shareB\\…\\renders'],
    ['C:\\output', 'C:\\'],
    ['/output', '/'],
    ['/Users/me/output', '/Users/me']
  ])('shortens the folder that holds %s to %s', async (path, shown) => {
    listOutputFolders.mockResolvedValue([{ path, shared: true, builds: ['Test Instance'] }])
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    expect(
      wrapper.get(`[data-testid="local-folder-${CSS.escape(path)}"] span:last-child`).text()
    ).toBe(shown)
  })

  it('says when no build saves to a folder yet', async () => {
    listOutputFolders.mockResolvedValue([{ path: SHARED, shared: true, builds: [] }])
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)

    expect(wrapper.get(`[data-testid="local-folder-heading-${SHARED}"] h2`).text()).toBe(
      'No build saves here yet'
    )
    const card = wrapper.get(`[data-testid="local-folder-${SHARED}"]`)
    expect(document.getElementById(card.attributes('aria-describedby')!)?.textContent).toBe(
      'No build saves here yet'
    )
  })

  it('shows two build names and lists all of them from the +N button', async () => {
    const builds = ['Test Instance', 'My Local 1', 'MyLocalComfy', 'ComfyUI (1)']
    listOutputFolders.mockResolvedValue([{ path: SHARED, shared: true, builds }])
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const more = wrapper.get(`[data-testid="local-folder-more-${SHARED}"]`)
    expect(more.text()).toBe('+2')
    expect(document.getElementById(more.attributes('aria-describedby')!)?.textContent).toBe(
      builds.join(', ')
    )
    ;(more.element as HTMLButtonElement).focus()
    await flushPromises()

    const bubble = document.querySelector('.tooltip-bubble')?.textContent
    expect(bubble).toContain('Saved here by')
    for (const name of builds) expect(bubble).toContain(name)
  })

  it('lists at most ten builds in the tooltip and counts the rest', async () => {
    const builds = Array.from({ length: 13 }, (_, n) => `Build ${n + 1}`)
    listOutputFolders.mockResolvedValue([{ path: SHARED, shared: true, builds }])
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    ;(
      wrapper.get(`[data-testid="local-folder-more-${SHARED}"]`).element as HTMLButtonElement
    ).focus()
    await flushPromises()

    const bubble = document.querySelector('.tooltip-bubble')?.textContent
    expect(bubble).toContain('Build 10')
    expect(bubble).not.toContain('Build 11')
    expect(bubble).toContain('and 3 more')
  })

  it('lists cut-off build names on hover and from a keyboard button', async () => {
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const trigger = wrapper.get(`[data-testid="local-folder-heading-${SHARED}"]`)
    expect(wrapper.find(`[data-testid="local-folder-names-${SHARED}"]`).exists()).toBe(false)

    trigger.get('h2').element.style.maxWidth = '40px'
    const names = await vi.waitFor(() =>
      wrapper.get(`[data-testid="local-folder-names-${SHARED}"]`)
    )
    expect(names.attributes('aria-label')).toBe('Show build names')
    ;(names.element as HTMLButtonElement).focus()
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('My Local 1')
  })

  it('says who saves to a folder on hover, with no +N button when every name fits', async () => {
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const trigger = wrapper.get(`[data-testid="local-folder-heading-${APPS}"]`)

    await trigger.trigger('pointermove', { pointerType: 'mouse' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.find(`[data-testid="local-folder-more-${APPS}"]`).exists()).toBe(false)
    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('Saved here by')
  })

  it('shows the build list only for a folder that builds use', async () => {
    listOutputFolders.mockResolvedValue([
      { path: SHARED, shared: true, builds: [] },
      { path: APPS, shared: false, builds: ['Apps'] }
    ])
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const hover = async (path: string): Promise<void> => {
      await wrapper
        .get(`[data-testid="local-folder-heading-${path}"]`)
        .trigger('pointermove', { pointerType: 'mouse' })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await flushPromises()
    }

    await hover(SHARED)
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    await hover(APPS)
    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('Apps')
  })

  it('explains how the folders work on focus and to screen readers', async () => {
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const help = wrapper.get('[data-testid="local-folders-help"] button')
    const hint =
      'The names above each folder are the builds that save their images and videos there. Most builds share one folder.'
    expect(document.getElementById(help.attributes('aria-describedby')!)?.textContent).toBe(hint)
    ;(help.element as HTMLButtonElement).focus()
    await flushPromises()

    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain(hint)
  })

  it('keeps the help button in place while the folders load', async () => {
    listOutputFolders.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    expect(wrapper.find('[data-testid="local-folders-help"]').exists()).toBe(true)
  })

  it('shows a folder in Finder from its menu without opening it', async () => {
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    await wrapper
      .get(`[data-testid="local-folder-menu-${SHARED}"]`)
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const reveal = wrapper.get('[data-testid="local-folder-reveal"]')
    expect(reveal.text()).toBe('Show in Finder')
    await reveal.trigger('click')
    await flushPromises()

    expect(revealPath).toHaveBeenCalledWith(SHARED)
    expect(listOutputFolder).not.toHaveBeenCalled()
  })

  it('copies a folder path from its menu and says it was copied', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    onTestFinished(() => writeText.mockRestore())
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    await wrapper
      .get(`[data-testid="local-folder-menu-${APPS}"]`)
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('[data-testid="local-folder-copy-path"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(APPS)
    expect(wrapper.get('[data-testid="local-folder-copy-path"]').text()).toBe('Path copied')
    expect(listOutputFolder).not.toHaveBeenCalled()
  })

  it('says when a folder path could not be copied and lets the user try again', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('denied'))
    onTestFinished(() => writeText.mockRestore())
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    await wrapper
      .get(`[data-testid="local-folder-menu-${APPS}"]`)
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('[data-testid="local-folder-copy-path"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="local-folder-copy-path"]').text()).toBe(
      "Couldn't copy. Try again"
    )

    writeText.mockResolvedValue()
    await wrapper.get('[data-testid="local-folder-copy-path"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="local-folder-copy-path"]').text()).toBe('Path copied')
  })

  it('does not show an old copy result when the menu opens again', async () => {
    let finishCopy = (): void => {}
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockReturnValue(new Promise<void>((resolve) => (finishCopy = resolve)))
    onTestFinished(() => writeText.mockRestore())
    const wrapper = await mountAssets([], [], { attachTo: document.body })
    await openThisComputer(wrapper)
    const trigger = wrapper.get(`[data-testid="local-folder-menu-${APPS}"]`)

    await trigger.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('[data-testid="local-folder-copy-path"]').trigger('click')
    await wrapper
      .get('[data-testid="local-folder-copy-path"]')
      .trigger('keydown', { key: 'Escape' })
    await flushPromises()
    await trigger.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    finishCopy()
    await flushPromises()

    expect(wrapper.get('[data-testid="local-folder-copy-path"]').text()).toBe('Copy path')
  })

  it('opens on This computer when the user left it there', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'computer')

    const wrapper = await mountAssets([])

    expect(wrapper.find(`[data-testid="local-folder-${SHARED}"]`).exists()).toBe(true)
  })

  it('says where files will appear when no output folder exists yet', async () => {
    listOutputFolders.mockResolvedValue([])
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    expect(wrapper.get('[data-testid="local-no-folders"]').text()).toContain(
      'No output folders yet'
    )
  })

  it('walks into a folder and its subfolders and back along the path', async () => {
    let finish: (value: OutputFolderListing) => void = () => {}
    listOutputFolder.mockImplementation(
      (path: string) =>
        new Promise<OutputFolderListing>((resolve) => {
          if (path === SHARED) finish = resolve
          else resolve(listing([entry(`${SHARED}/apps`, 'cutout.png', 'image')]))
        })
    )
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)

    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    finish(
      listing([
        entry(SHARED, 'old.png', 'image', 1),
        entry(SHARED, 'apps', null),
        entry(SHARED, 'new.mp4', 'video', 5),
        entry(SHARED, 'notes.txt', null)
      ])
    )
    await flushPromises()

    expect(wrapper.get('nav').text()).toContain('This computer')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('output')
    expect(
      wrapper.findAll('[data-testid^="local-file-"]').map((c) => c.attributes('data-testid'))
    ).toEqual(['local-file-new.mp4', 'local-file-old.png'])
    expect(wrapper.find('[data-testid="assets-filter"]').exists()).toBe(true)

    await wrapper.get('[data-testid="local-subfolder-apps"]').trigger('click')
    await flushPromises()
    expect(listOutputFolder).toHaveBeenLastCalledWith(`${SHARED}/apps`)
    expect(wrapper.get('nav').text()).toContain('apps')

    await wrapper.get('[data-testid="local-crumb-0"]').trigger('click')
    await flushPromises()
    expect(wrapper.find(`[data-testid="local-folder-${SHARED}"]`).exists()).toBe(true)
  })

  it('opens the folder and shows a file in its folder on this computer', async () => {
    listOutputFolder.mockResolvedValue(listing([entry(SHARED, 'cutout.png', 'image')]))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="local-open-folder"]').trigger('click')
    expect(openPath).toHaveBeenCalledExactlyOnceWith(SHARED)

    const show = wrapper.get('[data-testid="local-show-cutout.png"]')
    expect(show.attributes('aria-label')).toBe('Show in Finder')
    await show.trigger('click')
    expect(revealPath).toHaveBeenCalledExactlyOnceWith(`${SHARED}/cutout.png`)
  })

  it('opens a local file in the output dialog with when it changed, where it is saved and no download', async () => {
    listOutputFolder.mockResolvedValue(listing([entry(SHARED, 'cutout.png', 'image')]))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="local-file-cutout.png"] button').trigger('click')

    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('cutout.png')
    const subtitle = wrapper.get('[data-testid="output-detail-panel"] p').text()
    expect(subtitle).toContain('Modified')
    expect(subtitle).not.toContain('Created')
    const savedIn = wrapper.get('[data-testid="output-detail-saved-in"]').text()
    expect(savedIn).toContain('output')
    expect(savedIn).toContain('/Users/me/ComfyUI-Shared')
    expect(wrapper.find('[data-testid="output-detail-download"]').exists()).toBe(false)
    const show = wrapper.get('[data-testid="output-detail-show-in-folder"]')
    expect(show.text()).toBe('Show in Finder')
    await show.trigger('click')
    expect(revealPath).toHaveBeenCalledExactlyOnceWith(`${SHARED}/cutout.png`)
  })

  it('says nothing matches a filter and clears it, and says when a folder is cut short', async () => {
    listOutputFolder.mockResolvedValue(
      listing([entry(SHARED, 'cutout.png', 'image'), entry(SHARED, 'mask.png', 'image')], true)
    )
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Showing the newest 2 files.')

    await wrapper.get('input').setValue('nothing-like-this')
    expect(wrapper.get('[data-testid="local-empty"]').text()).toContain('No matching assets')

    await wrapper.get('[data-testid="local-clear-filters"]').trigger('click')
    expect(wrapper.find('[data-testid="local-file-cutout.png"]').exists()).toBe(true)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('says so when the folder cannot be opened on this computer any more', async () => {
    listOutputFolder.mockResolvedValue(listing([entry(SHARED, 'cutout.png', 'image')]))
    openPath.mockResolvedValueOnce('The folder does not exist.')
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="local-open-folder"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't open this folder. It may have been moved or deleted.",
      message: SHARED
    })
  })

  it('shows a subfolder in Finder and copies its path from its menu without opening it', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    onTestFinished(() => writeText.mockRestore())
    listOutputFolder.mockResolvedValueOnce(listing([entry(SHARED, 'apps', null)]))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    const menu = wrapper.get('[data-testid="local-subfolder-menu-apps"]')
    await menu.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('[data-testid="local-folder-reveal"]').trigger('click')
    await flushPromises()
    await menu.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.get('[data-testid="local-folder-copy-path"]').trigger('click')
    await flushPromises()

    expect(revealPath).toHaveBeenCalledWith(`${SHARED}/apps`)
    expect(writeText).toHaveBeenCalledWith(`${SHARED}/apps`)
    expect(listOutputFolder).toHaveBeenCalledTimes(1)
  })

  it('shows only the subfolders of a folder with no files, and the cut-short note when nothing matches', async () => {
    listOutputFolder.mockResolvedValueOnce(listing([entry(SHARED, 'apps', null)]))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="local-subfolder-apps"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="local-empty"]').exists()).toBe(false)

    listOutputFolder.mockResolvedValueOnce(
      listing([entry(`${SHARED}/apps`, 'cutout.png', 'image')], true)
    )
    await wrapper.get('[data-testid="local-subfolder-apps"]').trigger('click')
    await flushPromises()
    await wrapper.get('input').setValue('nothing-like-this')
    expect(wrapper.get('[data-testid="local-empty"]').text()).toContain('Showing the newest file.')
  })

  it('says a folder could not be opened and leads back to This computer', async () => {
    listOutputFolder.mockResolvedValue(null)
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    const failed = wrapper.get('[data-testid="local-failed"]')
    expect(failed.text()).toContain("Couldn't open this folder.")
    await failed.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find(`[data-testid="local-folder-${SHARED}"]`).exists()).toBe(true)
  })
})
