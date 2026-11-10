import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChoiceCard from './ChoiceCard.vue'

function mountCard(props: Record<string, unknown> = {}) {
  return mount(ChoiceCard, {
    props: { label: 'Cloud', description: 'Best for **most users**.', ...props }
  })
}

describe('ChoiceCard', () => {
  it('is not a radio at all unless `selectable`', () => {
    const wrapper = mountCard()
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.attributes('aria-checked')).toBeUndefined()
    expect(wrapper.attributes('tabindex')).toBeUndefined()
  })

  it('exposes radio semantics when `selectable`', () => {
    const wrapper = mountCard({ selectable: true, selected: true })
    expect(wrapper.attributes('role')).toBe('radio')
    expect(wrapper.attributes('aria-checked')).toBe('true')
  })

  it.each([
    ['selected', { selected: true, tabStop: false }, '0'],
    ['unselected', { selected: false, tabStop: false }, '-1'],
    ['unselected but the tab stop', { selected: false, tabStop: true }, '0']
  ])('a %s card has tabindex %s', (_label, props, expected) => {
    expect(mountCard({ selectable: true, ...props }).attributes('tabindex')).toBe(expected)
  })

  it('being the tab stop is not being selected', () => {
    const wrapper = mountCard({ selectable: true, selected: false, tabStop: true })
    expect(wrapper.attributes('aria-checked')).toBe('false')
  })

  it('`tabStop` is inert on a non-selectable card', () => {
    expect(mountCard({ tabStop: true }).attributes('tabindex')).toBeUndefined()
  })

  it('renders no radio glyph — selection reads from the card itself', () => {
    const wrapper = mountCard({ selectable: true, selected: true })
    expect(wrapper.find('.choice-card__radio').exists()).toBe(false)
    expect(wrapper.classes()).toContain('choice-card--selected')
  })
})
