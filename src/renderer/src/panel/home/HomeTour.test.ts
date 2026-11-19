import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import '../../assets/main.css'
import HomeTour from './HomeTour.vue'
import { __resetHomeTourForTest, useHomeTour } from './useHomeTour'
import type { HomeTourAnchor } from './homeTourSteps'
import { stubWindowApi } from '../../lib/stubWindowApi'

const saved = new Map<string, unknown>()
const getSetting = vi.fn(async (key: string): Promise<unknown> => saved.get(key))
const setSetting = vi.fn(async (key: string, value: unknown): Promise<void> => {
  saved.set(key, value)
})
stubWindowApi({ getSetting, setSetting })

const ALL_ANCHORS: HomeTourAnchor[] = [
  'home-builds',
  'cloud-build',
  'local-build',
  'all-builds',
  'new-build',
  'apps-carousel',
  'apps',
  'assets'
]

const anchors: HTMLElement[] = []

function placeAnchors(list: HomeTourAnchor[] = ALL_ANCHORS): void {
  list.forEach((anchor, i) => {
    const el = document.createElement('div')
    el.dataset['homeTour'] = anchor
    el.style.cssText = `position: fixed; left: 300px; top: ${40 + i * 60}px; width: 200px; height: 40px`
    document.body.append(el)
    anchors.push(el)
  })
}

function tourCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="home-tour"]')
}

function button(name: 'next' | 'back' | 'skip'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="home-tour-${name}"]`)
}

async function waitForCard(): Promise<HTMLElement> {
  await expect.poll(() => tourCard()).not.toBeNull()
  return tourCard()!
}

function mountTour() {
  const host = document.createElement('div')
  document.body.append(host)
  anchors.push(host)
  return mount(HomeTour, { attachTo: host, props: { active: true } })
}

async function settle(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  await nextTick()
}

beforeAll(() => page.viewport(1200, 800))

beforeEach(() => {
  saved.clear()
  getSetting.mockClear()
  setSetting.mockClear()
  __resetHomeTourForTest()
})

afterEach(() => {
  while (anchors.length) anchors.pop()?.remove()
})

describe('HomeTour', () => {
  it('starts a new user on the builds row of Home, with no Back button', async () => {
    placeAnchors()
    mountTour()

    const card = await waitForCard()
    expect(card.textContent).toContain('Builds run ComfyUI')
    expect(card.textContent).toContain('1 of 8')
    expect(button('back')).not.toBeVisible()
    expect(document.activeElement).toBe(button('next'))
  })

  it('starts an updated user on the renamed builds', async () => {
    saved.set('homeTourAudience', 'updated')
    placeAnchors()
    mountTour()

    const card = await waitForCard()
    expect(card.textContent).toContain('Instances are now builds')
    expect(card.textContent).toContain('1 of 6')
  })

  it('moves forward with Next and back with Back', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')
    await userEvent.click(button('back')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Builds run ComfyUI')
  })

  it('leaves out a step whose part is not on screen', async () => {
    placeAnchors(ALL_ANCHORS.filter((anchor) => anchor !== 'cloud-build'))
    mountTour()
    await waitForCard()

    expect(tourCard()?.textContent).toContain('1 of 7')
    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Local build')
  })

  it('saves the tour as done when the user skips it, and hides it', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    await userEvent.click(button('skip')!)
    await expect.poll(() => tourCard()).toBeNull()
    expect(setSetting).toHaveBeenCalledWith('homeTourDone', true)
  })

  it('saves the tour as done when the user presses Escape', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => tourCard()).toBeNull()
    expect(setSetting).toHaveBeenCalledWith('homeTourDone', true)
  })

  it('saves the tour as done after Done on the last step, which names where to replay it', async () => {
    saved.set('homeTourAudience', 'updated')
    placeAnchors()
    mountTour()
    await waitForCard()

    for (let step = 1; step < 6; step++) {
      await userEvent.click(button('next')!)
      await expect.poll(() => tourCard()?.textContent).toContain(`${step + 1} of 6`)
    }
    expect(tourCard()?.textContent).toContain('Assets')
    expect(tourCard()?.textContent).toContain('Everything you generate is saved here.')
    expect(tourCard()?.textContent).toContain('Replay this tour from the bell in the title bar.')
    expect(button('skip')).not.toBeVisible()
    expect(button('next')?.textContent?.trim()).toBe('Done')

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()).toBeNull()
    expect(setSetting).toHaveBeenCalledWith('homeTourDone', true)
  })

  it('never shows the tour again once it is done', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(tourCard()).toBeNull()
  })

  it('hides without saving it as done when Home stops being free, and picks up at the same step', async () => {
    placeAnchors()
    const wrapper = mountTour()
    await waitForCard()
    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')

    await wrapper.setProps({ active: false })
    await expect.poll(() => tourCard()).toBeNull()
    expect(setSetting).not.toHaveBeenCalled()

    await wrapper.setProps({ active: true })
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')
  })

  it('shows the tour again after a replay', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await settle()
    expect(tourCard()).toBeNull()

    await useHomeTour().replay()
    await waitForCard()
    expect(setSetting).toHaveBeenCalledWith('homeTourDone', false)
  })

  it('keeps Skip, Back and Next in the same place on every step', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()
    const offsets = () => {
      const card = tourCard()!.getBoundingClientRect()
      return [button('skip')!, button('next')!].map(
        (el) => (el.getBoundingClientRect().left - card.left) / card.width
      )
    }
    await expect.poll(() => tourCard()!.getAnimations().length).toBe(0)
    const before = offsets()

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')
    await expect.poll(() => tourCard()!.getAnimations().length).toBe(0)
    expect(offsets()).toEqual(before)
  })

  it('leaves out the steps for sidebar parts that are folded away', async () => {
    placeAnchors()
    const folded = anchors.find((el) => el.dataset['homeTour'] === 'all-builds')!
    folded.style.opacity = '0'
    mountTour()
    await waitForCard()

    expect(tourCard()?.textContent).toContain('1 of 7')
  })

  it('returns focus to where it was after the tour ends', async () => {
    const field = document.createElement('input')
    document.body.append(field)
    anchors.push(field)
    field.focus()
    placeAnchors()
    mountTour()
    await waitForCard()

    await userEvent.click(button('skip')!)
    await expect.poll(() => tourCard()).toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('dims everything except the highlighted part', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    const target = anchors[0]!.getBoundingClientRect()
    const centerX = target.left + target.width / 2
    const centerY = target.top + target.height / 2
    expect(document.elementFromPoint(centerX, centerY)).toBe(anchors[0])
    expect(
      document.elementFromPoint(10, 10)?.closest('[data-testid="home-tour-dim"]')
    ).not.toBeNull()
  })
})
