import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApi } from '../../../types/ipc'
import type { CatalogWorkflow, Installation } from '../types/ipc'
import CatalogWorkflowDialog from './CatalogWorkflowDialog.vue'

const launchCatalogWorkflow = vi.fn<ElectronApi['launchCatalogWorkflow']>()
const openCatalogWorkflow = vi.fn<ElectronApi['openCatalogWorkflow']>()

const workflow: CatalogWorkflow = {
  id: 'upscale',
  title: 'Upscale',
  description: 'Restore detail',
  thumbnailUrl: null,
  canOpenLocal: true,
  canOpenCloud: true,
  minComfyUIVersion: '0.16.0'
}

const compatibleBuild: Installation = {
  id: 'studio',
  name: 'Studio',
  sourceId: 'standalone',
  sourceLabel: 'Local',
  sourceCategory: 'local',
  status: 'installed',
  version: '0.16.0'
}
const oldBuild: Installation = { ...compatibleBuild, id: 'old', name: 'Old', version: '0.15.0' }
const cloud: Installation = {
  id: 'shared-cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Comfy Cloud',
  sourceCategory: 'cloud',
  status: 'installed'
}

function mountDialog(installations: Installation[], item = workflow) {
  return mount(CatalogWorkflowDialog, {
    props: { workflow: item, installations, workspaceId: 'selected-workspace' },
    global: { stubs: { DesktopDialogSurface: { template: '<section><slot /></section>' } } }
  })
}

beforeEach(() => {
  launchCatalogWorkflow.mockReset().mockResolvedValue({ opened: true })
  openCatalogWorkflow.mockReset().mockResolvedValue(true)
  vi.stubGlobal('api', { launchCatalogWorkflow, openCatalogWorkflow })
})

afterEach(() => vi.unstubAllGlobals())

describe('CatalogWorkflowDialog', () => {
  it('opens the selected compatible local build and omits older builds', async () => {
    const dialog = mountDialog([oldBuild, compatibleBuild, cloud])
    expect(dialog.findAll('option').map((option) => option.text())).toEqual([
      'Studio',
      'Comfy Cloud'
    ])

    await dialog.get('form').trigger('submit')
    await flushPromises()

    expect(launchCatalogWorkflow).toHaveBeenCalledWith(
      'upscale',
      { where: 'local', build: 'studio' },
      'selected-workspace'
    )
    expect(dialog.emitted('close')).toEqual([[]])
  })

  it('offers Cloud and explains how to update an incompatible local build', async () => {
    const dialog = mountDialog([oldBuild, cloud])
    expect(dialog.text()).toContain('This workflow needs ComfyUI 0.16.0 or newer')

    await dialog.get('form').trigger('submit')
    await flushPromises()

    expect(launchCatalogWorkflow).toHaveBeenCalledWith(
      'upscale',
      { where: 'cloud' },
      'selected-workspace'
    )
  })

  it('keeps the picker open on failure and retries the chosen target', async () => {
    launchCatalogWorkflow.mockResolvedValueOnce({ opened: false, error: 'Could not start Studio.' })
    const dialog = mountDialog([compatibleBuild, cloud])

    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toBe('Could not start Studio.')
    expect(dialog.emitted('close')).toBeUndefined()

    await dialog.get('select').setValue('cloud')
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(launchCatalogWorkflow).toHaveBeenLastCalledWith(
      'upscale',
      { where: 'cloud' },
      'selected-workspace'
    )
    expect(dialog.emitted('close')).toEqual([[]])
  })

  it('offers the Hub for a catalog entry without a supported build target', async () => {
    const dialog = mountDialog([compatibleBuild, cloud], {
      ...workflow,
      canOpenLocal: false,
      canOpenCloud: false
    })
    expect(dialog.find('select').exists()).toBe(false)
    expect(dialog.find('button[type="submit"]').exists()).toBe(false)

    const hub = dialog.findAll('button').find((button) => button.text() === 'View on Comfy Hub')!
    await hub.trigger('click')
    await flushPromises()

    expect(openCatalogWorkflow).toHaveBeenCalledWith('upscale')
    expect(dialog.emitted('close')).toEqual([[]])
  })
})
