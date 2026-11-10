import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseInput from './BaseInput.vue'

describe('BaseInput', () => {
  it('reports edits immediately and commits only when the field changes', async () => {
    const wrapper = mount(BaseInput, { props: { modelValue: '' } })
    const input = wrapper.get('input')
    input.element.value = '--port 8188'
    await input.trigger('input')

    expect(wrapper.emitted('update:modelValue')).toEqual([['--port 8188']])
    expect(wrapper.emitted('change')).toBeUndefined()

    await input.trigger('change')
    expect(wrapper.emitted('change')).toEqual([['--port 8188']])
  })

  it('forwards the field label, validation and native constraints to the input', () => {
    const wrapper = mount(BaseInput, {
      props: {
        modelValue: '8188',
        ariaLabel: 'Server port',
        type: 'number',
        min: 1,
        max: 65535,
        step: 1,
        invalid: true,
        readonly: true,
        spellcheck: false
      }
    })
    expect(wrapper.get('input').attributes()).toMatchObject({
      'aria-label': 'Server port',
      'aria-invalid': 'true',
      readonly: '',
      spellcheck: 'false',
      type: 'number',
      min: '1',
      max: '65535',
      step: '1'
    })
  })

  it('keeps trailing actions independent of committing the text', async () => {
    const browse = vi.fn()
    const wrapper = mount(BaseInput, {
      props: { modelValue: '/models' },
      slots: { trailing: '<button type="button">Browse</button>' }
    })
    wrapper.get('button').element.addEventListener('click', browse)
    await wrapper.get('button').trigger('click')

    expect(browse).toHaveBeenCalledOnce()
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
