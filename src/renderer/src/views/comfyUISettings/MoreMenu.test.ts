import { defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { userEvent } from 'vitest/browser'
import MoreMenu from './MoreMenu.vue'
import DialogHost from '../../components/DialogHost.vue'
import { useDialogs } from '../../composables/useDialogs'

function mountMenu({ canUninstall = false } = {}) {
  return mount(
    defineComponent({
      components: { MoreMenu, DialogHost },
      setup() {
        const dialogs = useDialogs()
        const field = ref<HTMLElement | null>(null)
        const picked = ref('')
        async function pick(action: { id: string }): Promise<void> {
          picked.value = action.id
          if (action.id === 'rename') field.value?.focus()
          if (action.id === 'delete') {
            picked.value = String(await dialogs.confirm({ title: 'Uninstall?', tone: 'danger' }))
          }
        }
        return {
          canUninstall,
          open: ref(false),
          anchor: ref<HTMLElement | null>(null),
          field,
          picked,
          pick,
          actions: [
            { id: 'copy', label: 'Copy' },
            { id: 'rename', label: 'Rename' },
            { id: 'delete', label: 'Uninstall', enabled: canUninstall, style: 'danger' as const }
          ]
        }
      },
      template: `<div>
      <button ref="anchor" type="button" data-testid="trigger" @click="open = !open">More</button>
      <input ref="field" data-testid="field" />
      <MoreMenu :open="open" :anchor="anchor" :actions="actions" @close="open = false" @pick="pick" />
      <DialogHost v-if="canUninstall" />
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

  it.each(['Cancel', 'Escape'] as const)(
    'puts keyboard focus back on the trigger after Uninstall is answered with %s',
    async (answer) => {
      const wrapper = mountMenu({ canUninstall: true })
      const trigger = wrapper.get<HTMLElement>('[data-testid="trigger"]').element
      trigger.focus()
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() =>
        expect(document.querySelector('.more-menu')?.contains(document.activeElement)).toBe(true)
      )
      await userEvent.keyboard('{End}')
      await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Uninstall'))
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() =>
        expect(
          document.querySelector('[role="alertdialog"]')?.contains(document.activeElement)
        ).toBe(true)
      )

      if (answer === 'Cancel') {
        document.querySelector<HTMLElement>('[data-testid="base-alert-cancel"]')!.focus()
        await userEvent.keyboard('{Enter}')
      } else {
        await userEvent.keyboard('{Escape}')
      }

      await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull())
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
      expect(page().find('.more-menu').exists()).toBe(false)
      expect(wrapper.get('output').text()).toBe('false')
      wrapper.unmount()
    }
  )
})
