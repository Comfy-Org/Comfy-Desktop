import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import LoadSnapshotModal from './LoadSnapshotModal.vue'

function mountLoadSnapshot() {
  return mount(LoadSnapshotModal, {
    global: {
      stubs: {
        BrandTakeoverLayout: { template: '<div><slot /><slot name="footer-left" /></div>' },
        TakeoverBack: true
      }
    }
  })
}

describe('LoadSnapshotModal', () => {
  it('names the screen Load Snapshot and says it installs a build', async () => {
    const wrapper = mountLoadSnapshot()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(wrapper.get('.load-snapshot-title').text()).toBe('Load Snapshot')
    expect(wrapper.get('.load-snapshot-lead').text()).toBe(
      'Load a snapshot file to install a build.'
    )
  })
})
