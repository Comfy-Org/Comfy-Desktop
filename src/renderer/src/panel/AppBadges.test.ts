import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import '../assets/main.css'
import AppBadges from './AppBadges.vue'
import { badgeDescriptionId } from './appCardBadges'
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
const NARROWEST_BADGE_ROW = 188
const PICTURE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="%23c96"/></svg>'

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
  it('draws the crown in a square of frosted glass with no words, beside every other badge in the order given', () => {
    const wrapper = mountBadges({ badges: [NEW_CHIP, CROWN, VIDEO_LABEL] })

    const drawn = wrapper.findAll('[data-badge-style]')
    expect(drawn.map((badge) => badge.attributes('data-badge-style'))).toEqual([
      'chip',
      'crown',
      'label'
    ])
    const square = wrapper.get('[data-testid="app-badge-square"]')
    const box = square.element.getBoundingClientRect()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    expect(
      (
        wrapper.get('[data-testid="app-badge-uses-credits"]').element as HTMLElement
      ).innerText.trim()
    ).toBe('')
    expect(
      (wrapper.get('[data-testid="app-badge-new"]').element as HTMLElement).innerText.trim()
    ).toBe('NEW')
    expect(wrapper.get('[data-testid="app-badge-video"]').text()).toContain('Video')
    const lefts = drawn.map((badge) => badge.element.getBoundingClientRect().left)
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
  })

  it('keeps a crown and a BETA chip on one line in the narrowest badge row a card gives them', () => {
    const beta: AppBadge = {
      id: 'beta',
      style: 'chip',
      text: { en: 'BETA', 'zh-CN': '测试版' },
      description: { en: 'This app is new. It may change.' }
    }
    const wrapper = mount(AppBadges, {
      attachTo: document.body,
      attrs: { style: `width: ${NARROWEST_BADGE_ROW}px` },
      props: { badges: [CROWN, beta], descriptionIdPrefix: 'card' }
    })
    mounted.push(wrapper)

    const [crown, chip] = wrapper
      .findAll('[data-badge-style]')
      .map((badge) => badge.element.getBoundingClientRect())
    expect(chip!.top).toBe(crown!.top)
    expect(chip!.left).toBeGreaterThan(crown!.right)
    expect(chip!.right).toBeLessThanOrEqual(wrapper.element.getBoundingClientRect().right)
  })

  it.each([
    ['crown', [CROWN], 'app-badge-square'],
    ['chip', [NEW_CHIP], 'app-badge-new']
  ] as const)(
    'keeps the picture behind the %s out of sight, with an almost opaque frosted fill from top to bottom',
    (_style, badges, testId) => {
      const wrapper = mountBadges({ badges: [...badges] })
      const glass =
        testId === 'app-badge-square'
          ? wrapper.get(`[data-testid="${testId}"]`).element
          : wrapper.get(`[data-testid="${testId}"] > span`).element
      const alphas = [
        ...getComputedStyle(glass).backgroundImage.matchAll(/rgba?\([^)]*?([\d.]+)\)/g)
      ].map((match) => Number(match[1]))

      expect(alphas.length, 'gradient stops').toBeGreaterThanOrEqual(2)
      for (const alpha of alphas) expect(alpha).toBeGreaterThanOrEqual(0.94)
    }
  )

  it('gives the chip the same corners and height as the crown square', () => {
    const crown = mountBadges({ badges: [CROWN] }).get('[data-testid="app-badge-square"]').element
    const chip = mountBadges({ badges: [NEW_CHIP] }).get(
      '[data-testid="app-badge-new"] > span'
    ).element

    expect(getComputedStyle(chip).borderRadius).toBe(getComputedStyle(crown).borderRadius)
    expect(chip.getBoundingClientRect().height).toBe(crown.getBoundingClientRect().height)
  })

  it('writes the chip in uppercase', () => {
    const chip = mountBadges({ badges: [NEW_CHIP] }).get('[data-testid="app-badge-new"] > span')
      .element as HTMLElement

    expect(chip.innerText).toBe('NEW')
  })

  it.each([
    ['crown', CROWN],
    ['chip', NEW_CHIP]
  ] as const)(
    "shows the card's picture blurred through the %s, lined up with the picture under it",
    async (_style, badge) => {
      const card = document.createElement('div')
      card.style.cssText = 'position: relative; width: 300px; height: 300px'
      document.body.append(card)
      const wrapper = mount(AppBadges, {
        attachTo: card,
        props: {
          badges: [badge],
          descriptionIdPrefix: 'card',
          glassPicture: PICTURE
        },
        attrs: { style: 'position: absolute; top: 8px; left: 8px' }
      })
      mounted.push(wrapper)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const picture = wrapper.get('[data-testid="app-badge-glass-picture"]').element as HTMLElement
      const glass = picture.parentElement!
      const cardBox = card.getBoundingClientRect()
      const pictureBox = picture.getBoundingClientRect()

      expect(pictureBox.left).toBeCloseTo(cardBox.left, 0)
      expect(pictureBox.top).toBeCloseTo(cardBox.top, 0)
      expect(pictureBox.width).toBeCloseTo(300, 0)
      expect(pictureBox.height).toBeCloseTo(300, 0)
      expect(getComputedStyle(picture).filter).toContain('blur(10px)')
      expect(getComputedStyle(glass).overflow).toBe('hidden')
      card.remove()
    }
  )

  it('keeps the frosted fill and no picture when the card has no picture to show', () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP] })

    expect(wrapper.find('[data-testid="app-badge-glass-picture"]').exists()).toBe(false)
  })

  it('gives the crown and the chip beside it each its own tooltip', async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP] })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-uses-credits"]').element)

    await expect.poll(tooltipText).toContain('Runs a paid partner model')
    expect(tooltipText()).not.toContain('Added this week')

    await userEvent.hover(wrapper.get('[data-testid="app-badge-new"]').element)

    await expect
      .poll(() =>
        [...document.querySelectorAll('.tooltip-bubble')].map((bubble) => bubble.textContent)
      )
      .toEqual([expect.stringContaining('Added this week')])
    expect(tooltipText()).not.toContain('Runs a paid partner model')
  })

  it('shows only its own words on hover for a crown with no description beside a chip', async () => {
    const wrapper = mountBadges({
      badges: [
        { id: 'cloud-credits', style: 'chip', text: { en: 'Uses credits on Cloud' } },
        PLAIN_CROWN
      ]
    })

    await userEvent.hover(wrapper.get('[data-testid="app-badge-pro"]').element)

    await expect.poll(tooltipText).toContain('Pro')
    expect(tooltipText()).not.toContain('Uses credits on Cloud')
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

    expect(document.getElementById('card:video')?.hidden).toBe(true)
    const crownNote = document.getElementById('card:uses-credits')
    expect(crownNote?.textContent).toBe('Uses credits: Runs a paid partner model')
    expect(crownNote?.hidden).toBe(true)
    expect(document.getElementById('card:video')?.textContent).toBe('Video')
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
    expect(document.getElementById('card:uses-credits')?.textContent).toContain('运行付费合作模型')
  })

  it("shows the first badge's description while its card has keyboard focus, and hides it after", async () => {
    const wrapper = mountBadges({ badges: [CROWN, NEW_CHIP], revealed: false })

    await wrapper.setProps({ revealed: true })

    await expect.poll(tooltipText).toContain('Runs a paid partner model')
    expect(tooltipText()).not.toContain('Added this week')
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

  it('wraps four long chips onto more lines instead of running past the card', () => {
    const chips: AppBadge[] = ['one', 'two', 'three', 'four'].map((id) => ({
      id,
      style: 'chip',
      text: { en: 'Twenty-four letters here' }
    }))
    const wrapper = mount(AppBadges, {
      attachTo: document.body,
      attrs: { style: 'width: 200px' },
      props: { badges: chips, descriptionIdPrefix: 'card' }
    })
    mounted.push(wrapper)

    const row = wrapper.element.getBoundingClientRect()
    const drawn = wrapper.findAll('[data-badge-style]')
    expect(drawn).toHaveLength(4)
    for (const badge of drawn) {
      expect(badge.element.getBoundingClientRect().right).toBeLessThanOrEqual(row.right)
    }
  })

  it('gives each badge a description id no other app and badge can share', () => {
    expect(badgeDescriptionId('apps-product-swap', NEW_CHIP)).not.toBe(
      badgeDescriptionId('apps-product', { ...NEW_CHIP, id: 'swap-new' })
    )
  })
})
