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
  it('draws the crown alone in a square of glass, with no words beside it, when a card has a crown', () => {
    const wrapper = mountBadges({ badges: [NEW_CHIP, CROWN, VIDEO_LABEL] })

    expect(
      wrapper.findAll('[data-badge-style]').map((badge) => badge.attributes('data-badge-style'))
    ).toEqual(['crown'])
    const square = wrapper.get('[data-testid="app-badge-square"]')
    const box = square.element.getBoundingClientRect()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    expect(getComputedStyle(square.element).backdropFilter).toContain('blur(14px)')
    expect(
      (wrapper.get('[data-testid="app-badges"]').element as HTMLElement).innerText.trim()
    ).toBe('')
  })

  it("puts the other badges' words in the crown's one-line tooltip", async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP, VIDEO_LABEL] })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-uses-credits"]').element)

    await expect.poll(tooltipText).toContain('Runs a paid partner model · Added this week · Video')
  })

  it("leaves the crown's own words out of its tooltip when other badges join it", async () => {
    const wrapper = mountBadges({
      badges: [
        { id: 'cloud-credits', style: 'chip', text: { en: 'Uses credits on Cloud' } },
        PLAIN_CROWN
      ]
    })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-pro"]').element)

    await expect.poll(tooltipText).toContain('Uses credits on Cloud')
    expect(tooltipText()).not.toContain('Pro')
  })

  it('draws chips and labels in the order given, with their words, on a card with no crown', () => {
    const wrapper = mountBadges({ badges: [NEW_CHIP, VIDEO_LABEL] })

    const drawn = wrapper.findAll('[data-badge-style]')
    expect(drawn.map((badge) => badge.attributes('data-badge-style'))).toEqual(['chip', 'label'])
    expect(wrapper.get('[data-testid="app-badge-new"]').text()).toContain('New')
    expect(wrapper.get('[data-testid="app-badge-video"]').text()).toContain('Video')
    const lefts = drawn.map((badge) => badge.element.getBoundingClientRect().left)
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
  })

  it("carries each badge's words and description for its card to point at", () => {
    mountBadges({ badges: [CROWN, VIDEO_LABEL] })

    expect(document.getElementById('card-video')?.hidden).toBe(true)
    const crownNote = document.getElementById('card-uses-credits')
    expect(crownNote?.textContent).toBe('Uses credits: Runs a paid partner model')
    expect(crownNote?.hidden).toBe(true)
    expect(document.getElementById('card-video')?.textContent).toBe('Video')
  })

  it('shows the description on hover', async () => {
    const wrapper = mountBadges({ badges: [NEW_CHIP, VIDEO_LABEL] })

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
    const wrapper = mountBadges({ badges: [NEW_CHIP, VIDEO_LABEL] }, [chinese])

    expect(wrapper.get('[data-testid="app-badge-new"]').text()).toContain('新')
    expect(wrapper.get('[data-testid="app-badge-video"]').text()).toContain('Video')

    await userEvent.hover(wrapper.get('[data-testid="app-badge-new"]').element)

    await expect.poll(tooltipText).toContain('Added this week')
    wrapper.unmount()
    mounted.pop()

    mountBadges({ badges: [CROWN] }, [chinese])
    expect(document.getElementById('card-uses-credits')?.textContent).toContain('运行付费合作模型')
  })

  it("shows the first badge's description while its card has keyboard focus, and hides it after", async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP], revealed: false })

    await wrapper.setProps({ revealed: true })

    await expect.poll(tooltipText).toContain('Runs a paid partner model · Added this week')
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
