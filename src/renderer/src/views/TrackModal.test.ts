import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import TrackModal from './TrackModal.vue'
import type { ProbeResult } from '../types/ipc'

interface MockApi {
  getUniqueName: ReturnType<typeof vi.fn>
  browseFolder: ReturnType<typeof vi.fn>
  probeInstallation: ReturnType<typeof vi.fn>
  trackInstallation: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
}

const gitProbe: ProbeResult = {
  sourceId: 'git',
  sourceLabel: 'Git',
  version: 'abcdef12',
  repo: 'https://github.com/comfyanonymous/ComfyUI.git',
  branch: 'master',
  commit: 'abcdef12'
}

function installMockApi(overrides: Partial<MockApi> = {}): MockApi {
  const api: MockApi = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    browseFolder: vi.fn().mockResolvedValue(undefined),
    probeInstallation: vi.fn().mockResolvedValue([gitProbe]),
    trackInstallation: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

function mountTrack() {
  return mount(TrackModal, {
    global: {
      stubs: {
        DesktopDialogSurface: { template: '<div><slot /></div>' },
        BaseSelect: true,
        HardDrive: true
      }
    }
  })
}

function browseButton(wrapper: ReturnType<typeof mountTrack>) {
  const button = wrapper.findAll('button').find((button) => button.text() === 'Browse')
  if (!button) throw new Error('Browse button not found')
  return button
}

function trackButton(wrapper: ReturnType<typeof mountTrack>) {
  return wrapper.get('button.track-save')
}

describe('TrackModal — browse-only install directory', () => {
  beforeEach(() => {
    installMockApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a non-clickable placeholder (no editable input) before a folder is picked', async () => {
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    const location = wrapper.get('.track-location')
    expect(location.find('input').exists()).toBe(false)
    expect(location.find('button.config-path-open').exists()).toBe(false)
    expect(location.get('.config-path-placeholder').text()).toBe('Select a directory…')
    expect(wrapper.findAll('.config-label').map((label) => label.text())).toEqual([
      'Install location',
      'Name',
      'Detected type'
    ])
  })

  it('opens the folder in the file manager when the populated path text is clicked', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await browseButton(wrapper).trigger('click')
    await flushPromises()

    const pathBtn = wrapper.get('.track-location button.config-path-open')
    expect(pathBtn.text()).toBe('/Users/jo/ComfyUI')
    await pathBtn.trigger('click')
    expect(api.openPath).toHaveBeenCalledWith('/Users/jo/ComfyUI')
  })

  it('probes and enables Add build when a folder is picked via Browse', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(trackButton(wrapper).attributes('disabled')).toBeDefined()

    await browseButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.probeInstallation).toHaveBeenCalledWith('/Users/jo/ComfyUI')
    expect(trackButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('keeps Add build disabled when no install is detected at the picked folder', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/tmp/not-comfy'),
      probeInstallation: vi.fn().mockResolvedValue([])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await browseButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.probeInstallation).toHaveBeenCalledWith('/tmp/not-comfy')
    expect(trackButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('TrackModal — modal layout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the detected details as rows and closes from the round close button', async () => {
    installMockApi({ browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI') })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(wrapper.get('.setup-modal-title').text()).toBe('Add existing build')
    await browseButton(wrapper).trigger('click')
    await flushPromises()

    expect(
      wrapper
        .findAll('.track-summary-row')
        .map((row) => [row.get('.config-label').text(), row.get('.track-summary-value').text()])
    ).toEqual([
      ['Version', 'abcdef12'],
      ['Repository', 'https://github.com/comfyanonymous/ComfyUI.git'],
      ['Branch', 'master']
    ])
    expect(trackButton(wrapper).text()).toBe('Add build')

    await wrapper.get('.setup-modal-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('TrackModal — virtual environment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function browseGitInstall(probe: ProbeResult) {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI'),
      probeInstallation: vi.fn().mockResolvedValue([probe])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await browseButton(wrapper).trigger('click')
    await flushPromises()
    return { api, wrapper }
  }

  it('shows the detected virtual environment as a path that opens the folder', async () => {
    const { api, wrapper } = await browseGitInstall({
      ...gitProbe,
      venvPath: '/Users/jo/ComfyUI/.venv'
    })

    const venv = wrapper.get('[data-testid="track-venv-field"]')
    expect(wrapper.findAll('[data-testid="install-location-field"]')).toHaveLength(1)
    const pathBtn = venv.get('button.config-path-open')
    expect(pathBtn.text()).toBe('/Users/jo/ComfyUI/.venv')
    await pathBtn.trigger('click')
    expect(api.openPath).toHaveBeenCalledWith('/Users/jo/ComfyUI/.venv')
  })

  it('says no virtual environment was found when the git install has none', async () => {
    const { wrapper } = await browseGitInstall(gitProbe)

    const venv = wrapper.get('[data-testid="track-venv-field"]')
    expect(venv.find('button.config-path-open').exists()).toBe(false)
    expect(venv.get('.config-path-placeholder').text()).toBe('No virtual environment found.')
  })
})

describe('TrackModal — install path resolution on save', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records the probe-resolved root when the user picked a nested folder', async () => {
    const standaloneProbe: ProbeResult = {
      sourceId: 'standalone',
      sourceLabel: 'Standalone',
      version: 'v0.1.0',
      installPath: '/Users/jo/standalone'
    }
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/standalone/ComfyUI'),
      probeInstallation: vi.fn().mockResolvedValue([standaloneProbe])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await browseButton(wrapper).trigger('click')
    await flushPromises()

    await trackButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledTimes(1)
    const data = api.trackInstallation.mock.calls[0]![0] as Record<string, unknown>
    expect(data.installPath).toBe('/Users/jo/standalone')
  })

  it('falls back to the picked folder when the probe has no resolved root', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await browseButton(wrapper).trigger('click')
    await flushPromises()

    await trackButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledTimes(1)
    const data = api.trackInstallation.mock.calls[0]![0] as Record<string, unknown>
    expect(data.installPath).toBe('/Users/jo/ComfyUI')
  })
})
