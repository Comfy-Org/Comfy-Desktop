import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import DevelopmentSection from './DevelopmentSection.vue'

type Answer = { kind: 'asked' } | { kind: 'refused'; title: string; message: string } | null

function installBridge(answer: Answer) {
  const bridge = {
    close: vi.fn(),
    globalSettingsOpenDraftApp: vi.fn(async (_address: string) => answer)
  }
  ;(window as unknown as { __comfyTitlePopup: typeof bridge }).__comfyTitlePopup = bridge
  return bridge
}

async function pasteAndOpen(wrapper: VueWrapper, address: string): Promise<void> {
  await wrapper.get('.gs-draft-app-input input').setValue(address)
  await wrapper.get('.gs-draft-app-open').trigger('click')
  await flushPromises()
}

describe('DevelopmentSection', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the address field with an example and no help line', () => {
    installBridge({ kind: 'asked' })
    const wrapper = mount(DevelopmentSection)
    expect(wrapper.get('.gs-draft-app-input input').attributes('placeholder')).toBe(
      'https://pr-706.drafts.comfy.org/apps/depth-swap/'
    )
    expect(wrapper.find('.gs-draft-app-hint').exists()).toBe(false)
  })

  it('keeps Open off until an address is pasted', async () => {
    installBridge({ kind: 'asked' })
    const wrapper = mount(DevelopmentSection)
    expect(wrapper.get('.gs-draft-app-open').attributes('disabled')).toBeDefined()
    await wrapper.get('.gs-draft-app-input input').setValue('   ')
    expect(wrapper.get('.gs-draft-app-open').attributes('disabled')).toBeDefined()
  })

  it('sends the address and closes settings so the question in the home window shows', async () => {
    const bridge = installBridge({ kind: 'asked' })
    const wrapper = mount(DevelopmentSection, { attachTo: document.body })

    await pasteAndOpen(wrapper, '  http://localhost:4321/apps/depth-swap/ ')

    expect(bridge.globalSettingsOpenDraftApp).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:4321/apps/depth-swap/'
    )
    expect(bridge.close).toHaveBeenCalledOnce()
    expect(wrapper.find('.gs-draft-app-refusal').exists()).toBe(false)
  })

  it('shows why an address was refused, under the field, and stays open', async () => {
    const bridge = installBridge({
      kind: 'refused',
      title: "Couldn't open this draft app",
      message: 'Paste a web address that starts with https:// or http://.'
    })
    const wrapper = mount(DevelopmentSection, { attachTo: document.body })

    await pasteAndOpen(wrapper, 'ftp://my.dev.box/apps/x/')

    const refusal = wrapper.get('.gs-draft-app-refusal')
    expect(refusal.attributes('role')).toBe('alert')
    expect(refusal.text()).toContain("Couldn't open this draft app")
    expect(refusal.text()).toContain('Paste a web address that starts with https:// or http://.')
    expect(bridge.close).not.toHaveBeenCalled()

    await wrapper.get('.gs-draft-app-input input').setValue('https://pr-1.drafts.comfy.org/apps/x/')
    expect(wrapper.find('.gs-draft-app-refusal').exists(), 'editing clears the refusal').toBe(false)
  })
})
