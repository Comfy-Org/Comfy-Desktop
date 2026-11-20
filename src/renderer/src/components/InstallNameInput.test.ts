import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { userEvent } from 'vitest/browser'

import '../assets/main.css'
import InstallNameInput from './InstallNameInput.vue'

const mounted: VueWrapper[] = []

function mountName(initial = 'ComfyUI') {
  const name = ref(initial)
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h('div', { class: 'grid grid-cols-[132px_minmax(0,1fr)]' }, [
          h('label', { for: 'inst-name-standalone' }, 'Name'),
          h(InstallNameInput, {
            modelValue: name.value,
            placeholder: 'ComfyUI',
            error: '',
            'onUpdate:modelValue': (value: string) => (name.value = value)
          })
        ])
    }),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  const input = () => wrapper.get<HTMLInputElement>('#inst-name-standalone').element
  return { name, wrapper, input }
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('InstallNameInput, edited in place', () => {
  it('shows a pencil right after the name, inside the field', () => {
    const { wrapper } = mountName()
    const field = wrapper.get('[data-testid="install-name-field"]')

    expect(field.find('[data-testid="install-name-edit-hint"]').exists()).toBe(true)
    expect(field.element.lastElementChild?.getAttribute('data-testid')).toBe(
      'install-name-edit-hint'
    )
  })

  it('selects the whole name when editing starts, so typing replaces it', async () => {
    const { input } = mountName()

    input().focus()

    expect(input().selectionStart).toBe(0)
    expect(input().selectionEnd).toBe('ComfyUI'.length)
  })

  it('starts editing when the pencil is clicked', async () => {
    const { wrapper, input } = mountName()

    await wrapper.get('[data-testid="install-name-edit-hint"]').trigger('click')

    expect(document.activeElement).toBe(input())
  })

  it('keeps the new name and stops editing on Enter', async () => {
    const { name, input } = mountName()

    input().focus()
    await userEvent.keyboard('Studio{Enter}')

    expect(name.value).toBe('Studio')
    expect(document.activeElement).not.toBe(input())
  })

  it('puts the old name back and stops editing on Escape, without the key reaching the dialog', async () => {
    const { name, input, wrapper } = mountName()
    const escapes: boolean[] = []
    wrapper.element.addEventListener('keydown', (event) => escapes.push(event.key === 'Escape'))

    input().focus()
    await userEvent.keyboard('Studio{Escape}')

    expect(name.value).toBe('ComfyUI')
    expect(document.activeElement).not.toBe(input())
    expect(escapes).not.toContain(true)
  })
})
