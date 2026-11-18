import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import '../assets/main.css'
import AppBadges from './AppBadges.vue'
import { appI18nOptions } from '../lib/i18nOptions'
import type { AppBadge } from '../types/ipc'

const CROWN: AppBadge = {
  id: 'uses-credits',
  style: 'crown',
  text: { en: 'Uses credits', 'zh-CN': '使用积分' },
  description: { en: 'Runs a paid partner model', 'zh-CN': '运行付费合作模型' }
}
const NEW_CHIP: AppBadge = {
  id: 'new',
  style: 'chip',
  text: { en: 'New', 'zh-CN': '新' },
  description: { en: 'Added this week' }
}
const VIDEO_LABEL: AppBadge = { id: 'video', style: 'label', text: { en: 'Video' } }
const PLAIN_CROWN: AppBadge = { id: 'pro', style: 'crown', text: { en: 'Pro' } }

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

function mountBadges(
  props: { badges?: AppBadge[]; revealed?: boolean } = {},
  plugins: ReturnType<typeof createI18n>[] = []
) {
  const wrapper = mount(AppBadges, {
    attachTo: document.body,
    props: { badges: [CROWN], descriptionIdPrefix: 'card', ...props },
    global: { plugins }
  })
  mounted.push(wrapper)
  return wrapper
}

function tooltipText(): string {
  return document.querySelector('.tooltip-bubble')?.textContent ?? ''
}

describe('AppBadges', () => {
  it('draws each badge in the order given: the crown alone in a square of glass, a chip and a label with their words', () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP, VIDEO_LABEL] })

    const drawn = wrapper.findAll('[data-badge-style]')
    expect(drawn.map((badge) => badge.attributes('data-badge-style'))).toEqual([
      'crown',
      'chip',
      'label'
    ])
    const square = wrapper.get('[data-testid="app-badge-square"]')
    const box = square.element.getBoundingClientRect()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    expect(getComputedStyle(square.element).backdropFilter).toContain('blur(14px)')
    expect(square.text()).toBe('')
    expect(wrapper.get('[data-testid="app-badge-new"]').text()).toContain('New')
    expect(wrapper.get('[data-testid="app-badge-video"]').text()).toContain('Video')
    const lefts = drawn.map((badge) => badge.element.getBoundingClientRect().left)
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
  })

  it("carries each badge's words and description for its card to point at", () => {
    mountBadges({ badges: [CROWN, VIDEO_LABEL] })

    const crownNote = document.getElementById('card-uses-credits')
    expect(crownNote?.textContent).toBe('Uses credits: Runs a paid partner model')
    expect(crownNote?.hidden).toBe(true)
    expect(document.getElementById('card-video')?.textContent).toBe('Video')
  })

  it('shows the description on hover', async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP] })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-new"]').element)

    await expect.poll(tooltipText).toContain('Added this week')
  })

  it('shows the words of a crown with no description on hover, since the crown shows none', async () => {
    const wrapper = mountBadges({ badges: [PLAIN_CROWN] })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-pro"]').element)

    await expect.poll(tooltipText).toContain('Pro')
  })

  it('uses the Chinese words in Chinese, and the English ones where a badge has none', async () => {
    const chinese = createI18n({ ...appI18nOptions, locale: 'zh' })
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP, VIDEO_LABEL] }, [chinese])

    expect(wrapper.get('[data-testid="app-badge-new"]').text()).toContain('新')
    expect(wrapper.get('[data-testid="app-badge-video"]').text()).toContain('Video')
    expect(document.getElementById('card-uses-credits')?.textContent).toContain(
      '运行付费合作模型'
    )

    await userEvent.hover(wrapper.get('[data-testid="app-badge-new"]').element)

    await expect.poll(tooltipText).toContain('Added this week')
  })

  it("shows the first badge's description while its card has keyboard focus, and hides it after", async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP], revealed: false })

    await wrapper.setProps({ revealed: true })

    await expect.poll(tooltipText).toContain('Runs a paid partner model')
    expect(document.querySelectorAll('.tooltip-bubble')).toHaveLength(1)

    await wrapper.setProps({ revealed: false })

    await expect.poll(() => document.querySelector('.tooltip-bubble')).toBe(null)
  })

  it('opens at once when its card already has keyboard focus as it appears', async () => {
    mountBadges({ revealed: true })

    await expect.poll(tooltipText).toContain('Runs a paid partner model')
  })

  it('stays open under the pointer when keyboard focus moves on to another card', async () => {
    const wrapper = mountBadges({ revealed: true })
    await userEvent.hover(wrapper.get('[data-testid="app-badge-uses-credits"]').element)

    await wrapper.setProps({ revealed: false })

    await expect.poll(tooltipText).toContain('Runs a paid partner model')
  })

  it('closes on Escape while it is shown for keyboard focus', async () => {
    mountBadges({ revealed: true })
    await expect.poll(() => document.querySelector('.tooltip-bubble')).not.toBe(null)

    await userEvent.keyboard('{Escape}')

    await expect.poll(() => document.querySelector('.tooltip-bubble')).toBe(null)
  })
})
