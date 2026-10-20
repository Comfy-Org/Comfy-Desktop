import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MenuView from './MenuView.vue'
import StatusDot from '../design-system/components/StatusDot.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (_k: string, fallback: string) => fallback }) }))

describe('MenuView', () => {
  it('renders a file-menu row with its check, and activates it', async () => {
    const wrapper = mount(MenuView, {
      props: { items: [{ id: 'reset-zoom', label: 'Reset zoom', checked: true }] }
    })
    const row = wrapper.get('[role="menuitem"]')
    expect(row.text()).toBe('Reset zoom')
    expect(row.find('.check svg').exists()).toBe(true)
    await row.trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['reset-zoom']])
  })

  it("renders a switcher row's status, second line and note", () => {
    const wrapper = mount(MenuView, {
      props: {
        items: [
          { kind: 'heading', label: 'Open' },
          {
            id: 'switcher:open:a',
            label: 'Studio',
            icon: 'local',
            status: 'running',
            detail: 'Running',
            meta: 'Current',
            checked: true
          }
        ]
      }
    })
    expect(wrapper.get('.heading').text()).toBe('Open')
    const row = wrapper.get('.item.rich')
    expect(row.classes()).toEqual(expect.arrayContaining(['has-detail', 'is-current']))
    expect(row.getComponent(StatusDot).props('status')).toBe('running')
    expect(row.get('.detail').text()).toBe('Running')
    expect(row.get('.meta').text()).toBe('Current')
  })

  it("renders an info card's title and facts, which are not actions", async () => {
    const wrapper = mount(MenuView, {
      props: {
        items: [
          {
            kind: 'title',
            label: 'Studio',
            icon: 'local',
            status: 'idle',
            detail: 'Standalone'
          },
          { kind: 'info', label: 'ComfyUI', icon: 'version', meta: 'v0.3.40' }
        ]
      }
    })
    expect(wrapper.get('.title-label').text()).toBe('Studio')
    expect(wrapper.get('.title .detail').text()).toBe('Standalone')
    expect(wrapper.get('.info-label').text()).toBe('ComfyUI')
    expect(wrapper.get('.info-value').text()).toBe('v0.3.40')
    expect(wrapper.find('[role="menuitem"]').exists()).toBe(false)
    await wrapper.get('.info').trigger('click')
    expect(wrapper.emitted('activate')).toBeUndefined()
  })
})
