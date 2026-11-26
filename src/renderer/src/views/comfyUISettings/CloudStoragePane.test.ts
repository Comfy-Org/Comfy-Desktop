import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import BaseSelect from '../../components/ui/BaseSelect.vue'
import CloudStoragePane from './CloudStoragePane.vue'
import type { StorageSnapshot } from './StoragePane.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

const SHARED_OUTPUT = '/Users/ada/ComfyUI-Shared/output'
const OWN_OUTPUT = '/Users/ada/Renders'

interface ApiCalls {
  openPath: string[]
  openGlobalSettings: Array<string | undefined>
  browseFolder: Array<string | undefined>
}

function installApi(browseFolderReturn: string | null = null): ApiCalls {
  const calls: ApiCalls = { openPath: [], openGlobalSettings: [], browseFolder: [] }
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    platform: 'darwin',
    browseFolder: async (start?: string) => {
      calls.browseFolder.push(start)
      return browseFolderReturn
    },
    openPath: async (path: string) => {
      calls.openPath.push(path)
    },
    openGlobalSettings: (tab?: string) => {
      calls.openGlobalSettings.push(tab)
    }
  }
  return calls
}

const SNAPSHOT: StorageSnapshot = {
  sharedDirectoriesFields: [{ id: 'outputDir', label: 'Shared output', value: SHARED_OUTPUT }],
  modelsDirs: [],
  modelsSystemDefault: ''
}

function cloudSections(opts: {
  autoDownload: boolean
  sharedOutput?: boolean
  partition?: string
}): DetailSection[] {
  const sharedOutput = opts.sharedOutput ?? true
  const fields: DetailField[] = [
    {
      id: 'browserPartition',
      label: 'Browser cache',
      value: opts.partition ?? 'shared',
      editable: true,
      editType: 'select',
      options: [
        { value: 'shared', label: 'Shared' },
        { value: 'unique', label: 'Separate' }
      ]
    },
    {
      id: 'autoDownloadOutputs',
      label: 'Auto-download outputs',
      value: opts.autoDownload,
      editable: true,
      editType: 'boolean',
      refreshSection: true
    }
  ]
  if (opts.autoDownload) {
    fields.push({
      id: 'useSharedOutputDir',
      label: 'Use shared output directory',
      value: sharedOutput,
      editable: true,
      editType: 'boolean',
      refreshSection: true,
      nested: true
    })
    if (!sharedOutput) {
      fields.push({
        id: 'outputDir',
        label: 'Shared output',
        value: OWN_OUTPUT,
        editable: true,
        editType: 'path',
        browseOnly: true,
        nested: true
      })
    }
  }
  return [{ tab: 'settings', title: 'Launch settings', fields }]
}

function mountPane(sections: DetailSection[]) {
  return mount(CloudStoragePane, {
    props: { snapshot: SNAPSHOT, sections },
    attachTo: document.body
  })
}

function emittedUpdates(wrapper: ReturnType<typeof mountPane>): Array<[string, unknown]> {
  return (wrapper.emitted('update-field') ?? []).map(([field, value]) => [
    (field as DetailField).id,
    value
  ])
}

describe('CloudStoragePane', () => {
  it('shows the shared output folder the outputs download to, marked Shared', () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: true }))

    const row = wrapper.get('[data-testid="cloud-storage-output-dir"]')
    expect(row.get('.storage-dir-name').text()).toBe(SHARED_OUTPUT)
    expect(row.get('.storage-dir-shared-tag').text()).toBe('Shared')
    expect(row.find('.storage-dir-tag').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-storage-shared-output"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-storage-outputs-stay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it("shows this build's own output folder, marked Build, when the shared folder is off", () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: true, sharedOutput: false }))

    const row = wrapper.get('[data-testid="cloud-storage-output-dir"]')
    expect(row.get('.storage-dir-name').text()).toBe(OWN_OUTPUT)
    expect(row.get('.storage-dir-tag').text()).toBe('Build')
    expect(row.find('.storage-dir-shared-tag').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides the folder row and the shared toggle when auto-download is off', () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: false }))

    expect(wrapper.find('[data-testid="cloud-storage-output-dir"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cloud-storage-shared-output"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="cloud-storage-outputs-stay"]').text()).toBe(
      'Outputs stay on Comfy Cloud.'
    )
    expect(wrapper.find('[data-testid="cloud-storage-auto-download"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('saves autoDownloadOutputs and useSharedOutputDir from the header toggles', async () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: true }))

    await wrapper.get('[data-testid="cloud-storage-auto-download"] .bt-switch').trigger('click')
    await wrapper.get('[data-testid="cloud-storage-shared-output"] .bt-switch').trigger('click')

    expect(emittedUpdates(wrapper)).toEqual([
      ['autoDownloadOutputs', false],
      ['useSharedOutputDir', false]
    ])
    wrapper.unmount()
  })

  it('turns auto-download back on with the same setting', async () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: false }))

    await wrapper.get('[data-testid="cloud-storage-auto-download"] .bt-switch').trigger('click')

    expect(emittedUpdates(wrapper)).toEqual([['autoDownloadOutputs', true]])
    wrapper.unmount()
  })

  it('saves browserPartition from the compact select', async () => {
    installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: true }))

    const select = wrapper.getComponent(BaseSelect)
    expect(select.props('modelValue')).toBe('shared')
    select.vm.$emit('update:modelValue', 'unique')

    expect(emittedUpdates(wrapper)).toEqual([['browserPartition', 'unique']])
    wrapper.unmount()
  })

  it("saves the picked folder as this build's outputDir", async () => {
    const calls = installApi('/Volumes/Work/out')
    const wrapper = mountPane(cloudSections({ autoDownload: true, sharedOutput: false }))

    wrapper.getComponent({ name: 'StorageDirRow' }).vm.$emit('browse')
    await flushPromises()

    expect(calls.browseFolder).toEqual([OWN_OUTPUT])
    expect(emittedUpdates(wrapper)).toEqual([['outputDir', '/Volumes/Work/out']])
    wrapper.unmount()
  })

  it('opens the output folder from its reveal button', async () => {
    const calls = installApi()
    const wrapper = mountPane(cloudSections({ autoDownload: true }))

    await wrapper
      .get('[data-testid="cloud-storage-output-dir"] .reveal-folder-button')
      .trigger('click')

    expect(calls.openPath).toEqual([SHARED_OUTPUT])
    wrapper.unmount()
  })

  it('shows the save error beside the browser cache select when an update fails', () => {
    installApi()
    const wrapper = mount(CloudStoragePane, {
      props: {
        snapshot: SNAPSHOT,
        sections: cloudSections({ autoDownload: false }),
        fieldErrorMessages: new Map([['browserPartition', 'Could not save']])
      },
      attachTo: document.body
    })

    const errors = wrapper.findAll('[data-testid="cloud-storage-field-error"]')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.text()).toBe('Could not save')
    expect(
      wrapper.get('[data-testid="cloud-storage-browser-cache"]').find('[role="alert"]').exists()
    ).toBe(true)
    wrapper.unmount()
  })
})
