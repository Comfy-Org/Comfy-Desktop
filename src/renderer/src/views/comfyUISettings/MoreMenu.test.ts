import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import MoreMenu from './MoreMenu.vue'

function mountMenu() {
  return mount(
    defineComponent({
      components: { MoreMenu },
      setup() {
        return {
          open: ref(false),
          anchor: ref<HTMLElement | null>(null),
          picked: ref(''),
          actions: [
            { id: 'copy', label: 'Copy' },
            { id: 'delete', label: 'Delete', enabled: false }
          ]
        }
      },
      template: `<div>
      <button ref="anchor" type="button" data-testid="trigger" @click="open = !open">More</button>
      <MoreMenu :open="open" :anchor="anchor" :actions="actions" @close="open = false" @pick="picked = $event.id" />
      <output>{{ picked }}</output>
    </div>`
    }),
    { attachTo: document.body }
  )
}

const page = () => new DOMWrapper(document.body)

describe('MoreMenu', () => {
  it('runs an enabled action and closes the menu', async () => {
    const wrapper = mountMenu()
    await wrapper.get('[data-testid="trigger"]').trigger('click')
    await flushPromises()
    await page().get('[role="menuitem"]:not([data-disabled])').trigger('click')
    await flushPromises()
    expect(wrapper.get('output').text()).toBe('copy')
    expect(page().find('.more-menu').exists()).toBe(false)
  })

  it('lets the parent trigger close an open menu without reopening it', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('[data-testid="trigger"]')
    await trigger.trigger('click')
    await flushPromises()
    expect(page().find('.more-menu').exists()).toBe(true)
    await trigger.trigger('pointerdown', { button: 0, pointerType: 'mouse' })
    await trigger.trigger('click')
    await flushPromises()
    expect(page().find('.more-menu').exists()).toBe(false)
  })

  it('closes when focus moves to another Desktop window', async () => {
    const wrapper = mountMenu()
    await wrapper.get('[data-testid="trigger"]').trigger('click')
    await flushPromises()
    window.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(page().find('.more-menu').exists()).toBe(false)
  })
})
