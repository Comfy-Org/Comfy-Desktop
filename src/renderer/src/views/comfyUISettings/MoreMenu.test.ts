import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import MoreMenu from './MoreMenu.vue'

function mountMenu() {
  return mount(
    defineComponent({
      components: { MoreMenu },
      setup() {
        const field = ref<HTMLElement | null>(null)
        const picked = ref('')
        function pick(action: { id: string }): void {
          picked.value = action.id
          if (action.id === 'rename') field.value?.focus()
        }
        return {
          open: ref(false),
          anchor: ref<HTMLElement | null>(null),
          field,
          picked,
          pick,
          actions: [
            { id: 'copy', label: 'Copy' },
            { id: 'rename', label: 'Rename' },
            { id: 'delete', label: 'Delete', enabled: false }
          ]
        }
      },
      template: `<div>
      <button ref="anchor" type="button" data-testid="trigger" @click="open = !open">More</button>
      <input ref="field" data-testid="field" />
      <MoreMenu :open="open" :anchor="anchor" :actions="actions" @close="open = false" @pick="pick" />
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
    trigger.element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
    await flushPromises()
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
  it('returns focus to the trigger after an action that leaves focus alone', async () => {
    const wrapper = mountMenu()
    await wrapper.get('[data-testid="trigger"]').trigger('click')
    await flushPromises()
    await page().get('[role="menuitem"]').trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(wrapper.get('[data-testid="trigger"]').element)
  })

  it('leaves focus where the picked action moved it', async () => {
    const wrapper = mountMenu()
    await wrapper.get('[data-testid="trigger"]').trigger('click')
    await flushPromises()
    const rename = page()
      .findAll('[role="menuitem"]')
      .find((item) => item.text() === 'Rename')!
    await rename.trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.get('output').text()).toBe('rename')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="field"]').element)
  })
})
