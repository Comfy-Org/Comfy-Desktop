// Radiogroup-member contract for ChoiceCard: roving tabindex, ARIA state,
// and the border-only selection language (no radio glyph).
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
    // Plain cards commit on click, so they stay in the natural tab order
    // rather than opting into roving-tabindex management.
    expect(wrapper.attributes('tabindex')).toBeUndefined()
  })

  it('exposes radio semantics when `selectable`', () => {
    const wrapper = mountCard({ selectable: true, selected: true })
    expect(wrapper.attributes('role')).toBe('radio')
    expect(wrapper.attributes('aria-checked')).toBe('true')
  })

  // Roving tabindex. `tabStop` exists because with nothing selected every
  // card would otherwise be `-1` and the radiogroup would drop out of the
  // tab order — WAI-ARIA APG §3.15 wants one reachable member regardless.
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
