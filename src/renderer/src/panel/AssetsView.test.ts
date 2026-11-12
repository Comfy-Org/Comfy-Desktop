import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  options: { attachTo?: HTMLElement; props?: { focusName?: string } } = {}
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

    listAssets.mockResolvedValue([
      newer('c', 'brand-new.png', '2026-01-03T00:00:00Z'),
      newer('a', 'first.png', '2026-01-02T00:00:00Z'),
      newer('b', 'second.png', '2026-01-01T00:00:00Z')
    ])
    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

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

describe('AssetsView opened for one Cloud file', () => {
  it('shows the Comfy Cloud assets with the newest Cloud file of that name open, for this visit only', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'computer')
    listOutputFolders.mockResolvedValue([])
    listAssets.mockImplementation(async (id: string) =>
      id === 'cloud'
        ? [
            { ...asset('old', 'cloud-cutout.png', 'image'), createdAt: '2026-11-01T12:00:00Z' },
            asset('a', 'forest.png', 'image'),
            { ...asset('new', 'cloud-cutout.png', 'image'), createdAt: '2026-11-10T12:00:00Z' }
          ]
        : [{ ...asset('local', 'cloud-cutout.png', 'image'), createdAt: '2026-11-12T12:00:00Z' }]
    )

    const wrapper = await mountAssets(
      [{ ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }, build('lab', 'Video Lab')],
      [],
      { props: { focusName: 'cloud-cutout.png' } }
    )
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('cloud-cutout.png')
    expect(wrapper.get('[data-testid="output-detail-panel"]').text()).toContain('11/10/2026')
    expect(wrapper.emitted('focus-used')).toHaveLength(1)
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('computer')
  })

  it('does not open the file if the user moved to This computer before it loaded', async () => {
    listOutputFolders.mockResolvedValue([])
    let finish: (assets: AssetSummary[]) => void = () => {}
    listAssets.mockImplementation(
      () => new Promise<AssetSummary[]>((resolve) => (finish = resolve))
    )
    const wrapper = await mountAssets(
      [{ ...build('cloud', 'Comfy Cloud'), sourceCategory: 'cloud' }],
      [],
      { props: { focusName: 'cloud-cutout.png' } }
    )

    useAuthStore().status = { signedIn: true }
    await flushPromises()
    await openThisComputer(wrapper)
    finish([asset('new', 'cloud-cutout.png', 'image')])
    await flushPromises()

    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
  })

  it('just shows the Comfy Cloud assets when the file is not there', async () => {
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])

    const wrapper = await mountAssets([build('lab', 'Video Lab')], [], {
      props: { focusName: 'missing.png' }
    })

    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('focus-used')).toHaveLength(1)
  })
})

describe('AssetsView on This computer', () => {
  beforeEach(() => {
    listAssets.mockResolvedValue([])
    listOutputFolders.mockResolvedValue(outputFolders())
  })

  it('shows each output folder with the builds that save there, without the file tools', async () => {
    const wrapper = await mountAssets([build('lab', 'Video Lab')])
    await openThisComputer(wrapper)
    const cloudLoads = listAssets.mock.calls.length

    const shared = wrapper.get(`[data-testid="local-folder-${SHARED}"]`)
    expect(shared.text()).toContain('Shared output')
    expect(shared.text()).toContain('Used by Test Instance, My Local 1')
    expect(shared.text()).toContain(SHARED)
    expect(wrapper.get(`[data-testid="local-folder-${APPS}"]`).text()).toContain('Apps output')
    expect(wrapper.find('[data-testid="assets-filter"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="local-open-folder"]').exists()).toBe(false)

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()
    expect(listOutputFolders).toHaveBeenCalledTimes(2)
    expect(listAssets).toHaveBeenCalledTimes(cloudLoads)
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
    expect(wrapper.get('nav').text()).toContain('Shared output')
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

    await wrapper.get('[data-testid="local-show-cutout.png"]').trigger('click')
    expect(revealPath).toHaveBeenCalledExactlyOnceWith(`${SHARED}/cutout.png`)
  })

  it('opens a local file in the output dialog with where it is saved and no download', async () => {
    listOutputFolder.mockResolvedValue(listing([entry(SHARED, 'cutout.png', 'image')]))
    const wrapper = await mountAssets([])
    await openThisComputer(wrapper)
    await wrapper.get(`[data-testid="local-folder-${SHARED}"]`).trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="local-file-cutout.png"] button').trigger('click')

    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('cutout.png')
    const savedIn = wrapper.get('[data-testid="output-detail-saved-in"]').text()
    expect(savedIn).toContain('output')
    expect(savedIn).toContain('/Users/me/ComfyUI-Shared')
    expect(wrapper.find('[data-testid="output-detail-download"]').exists()).toBe(false)
    await wrapper.get('[data-testid="output-detail-show-in-folder"]').trigger('click')
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
