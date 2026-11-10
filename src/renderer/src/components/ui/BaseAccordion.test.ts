import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import BaseAccordion from './BaseAccordion.vue'

describe('BaseAccordion', () => {
  it('preserves fields across collapse while excluding hidden controls from interaction', async () => {
    const wrapper = mount(BaseAccordion, {
      props: { open: false },
      slots: {
        default: defineComponent({
          setup: () => ({ draft: ref('initial') }),
          template: '<input v-model="draft" aria-label="Draft" />'
        })
      }
    })
    const input = wrapper.get('input').element
    expect(wrapper.get('.ui-accordion').attributes('inert')).toBeDefined()
    expect(wrapper.get('.ui-accordion').attributes('aria-hidden')).toBe('true')

    await wrapper.setProps({ open: true })
    expect(wrapper.get('.ui-accordion').attributes('inert')).toBeUndefined()
    await wrapper.get('input').setValue('unsaved draft')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.get('input').element).toBe(input)
    expect(input.value).toBe('unsaved draft')
  })
})
