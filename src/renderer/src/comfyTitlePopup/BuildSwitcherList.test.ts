import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import BuildSwitcherList from './BuildSwitcherList.vue'

const pickInstall = vi.fn()
const close = vi.fn()

function build(id: string, name: string, sourceCategory = 'local') {
  return { id, name, sourceLabel: 'Standalone', sourceCategory }
}

function mountList(activeInstallationId: string | null, running: string[] = []) {
  return mount(BuildSwitcherList, {
    props: {
      snapshot: {
        installs: [
          build('apps', 'Apps'),
          build('test', 'Test Instance'),
          build('cloud', 'Comfy Cloud', 'cloud')
        ],
        activeInstallationId,
        runningInstallationIds: running
      }
    }
  })
}

beforeEach(() => {
  pickInstall.mockReset()
  close.mockReset()
  ;(window as unknown as { __comfyTitlePopup: unknown }).__comfyTitlePopup = { pickInstall, close }
})

describe('BuildSwitcherList', () => {
  it('lists every build by name, marks the one in this window and the running ones', () => {
    const wrapper = mountList('test', ['test'])

    const rows = wrapper.findAll('[role="option"]')
    expect(rows.map((row) => row.text())).toEqual(['Apps', 'Test Instance', 'Comfy Cloud'])
    expect(rows.map((row) => row.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(wrapper.get('[data-testid="build-list-test"] [aria-label="Running"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="build-list-apps"] [aria-label="Running"]').exists()).toBe(
      false
    )
  })

  it('asks to switch to another build, and just closes for the build already open', async () => {
    const wrapper = mountList('test')

    await wrapper.get('[data-testid="build-list-test"]').trigger('click')
    expect(pickInstall).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()

    await wrapper.get('[data-testid="build-list-apps"]').trigger('click')
    expect(pickInstall).toHaveBeenCalledExactlyOnceWith('apps')
  })

  it('starts on the open build and moves with the arrow keys, wrapping around', async () => {
    const wrapper = mount(BuildSwitcherList, {
      attachTo: document.body,
      props: {
        snapshot: {
          installs: [build('apps', 'Apps'), build('test', 'Test Instance')],
          activeInstallationId: 'test',
          runningInstallationIds: []
        }
      }
    })
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="build-list-test"]').element)

    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('[data-testid="build-list-apps"]').element)
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(wrapper.get('[data-testid="build-list-test"]').element)
    wrapper.unmount()
  })
})
