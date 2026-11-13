import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SetupOptionCards from './SetupOptionCards.vue'

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B', disabled: true },
  { value: 'c', label: 'C' }
]

function mountCards(
  selectedValue: string | null = 'a',
  activation: 'automatic' | 'manual' = 'automatic'
) {
  return mount(SetupOptionCards, {
    props: { options, selectedValue, activation },
    attachTo: document.body
  })
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

  it('moves focus with arrow keys, skipping disabled options and wrapping', async () => {
    const wrapper = mountCards('a')
    const radios = wrapper.findAll('[role="radio"]')

    await radios[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(radios[2]!.element)
    await radios[2]!.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(radios[0]!.element)
    await radios[0]!.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(radios[2]!.element)
    wrapper.unmount()
  })

  it('picks the option it moves to, like a radio group', async () => {
    const wrapper = mountCards('a')
    const radios = wrapper.findAll('[role="radio"]')

    await radios[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('select')).toEqual([['c']])
    wrapper.unmount()
  })

  it('with manual activation, picks an option only when it is pressed, never while arrowing past it', async () => {
    const wrapper = mountCards('a', 'manual')
    const radios = wrapper.findAll('[role="radio"]')

    await radios[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(radios[2]!.element)
    expect(wrapper.emitted('select')).toBeUndefined()

    await radios[2]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['c']])
    wrapper.unmount()
  })
})
