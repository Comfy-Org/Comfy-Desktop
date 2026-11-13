import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SetupOptionCards from './SetupOptionCards.vue'

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B', disabled: true },
  { value: 'c', label: 'C' }
]

function mountCards(selectedValue: string | null = 'a') {
  return mount(SetupOptionCards, { props: { options, selectedValue }, attachTo: document.body })
}

describe('SetupOptionCards keyboard', () => {
  it('keeps one tab stop on the picked option', () => {
    const wrapper = mountCards('c')
    expect(wrapper.findAll('[role="radio"]').map((el) => el.attributes('tabindex'))).toEqual([
      '-1',
      '-1',
      '0'
    ])
    wrapper.unmount()
  })

  it('puts the tab stop on the first enabled option when nothing is picked', () => {
    const wrapper = mountCards(null)
    expect(wrapper.findAll('[role="radio"]')[0]!.attributes('tabindex')).toBe('0')
    wrapper.unmount()
  })

  it('moves the pick with arrow keys, skipping disabled options and wrapping', async () => {
    const wrapper = mountCards('a')
    const radios = wrapper.findAll('[role="radio"]')

    await radios[0]!.trigger('keydown', { key: 'ArrowDown' })
    await radios[2]!.trigger('keydown', { key: 'ArrowRight' })
    await radios[0]!.trigger('keydown', { key: 'ArrowUp' })

    expect(wrapper.emitted('select')).toEqual([['c'], ['a'], ['c']])
    expect(document.activeElement).toBe(radios[2]!.element)
    wrapper.unmount()
  })
})
