import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import '../../assets/main.css'
import HomeTour from './HomeTour.vue'
import { __resetHomeTourForTest, useHomeTour } from './useHomeTour'
import type { HomeTourAnchor } from './homeTourSteps'
import { stubWindowApi } from '../../lib/stubWindowApi'
import { TELEMETRY_ACTION_EVENT_NAME } from '../../lib/telemetry'
import { useInstallationStore } from '../../stores/installationStore'

const saved = new Map<string, unknown>()
const getSetting = vi.fn(async (key: string): Promise<unknown> => saved.get(key))
const setSetting = vi.fn(async (key: string, value: unknown): Promise<void> => {
  saved.set(key, value)
})
const unsubscribe = () => () => {}
interface ReplayRecord {
  id: number
  pending: boolean
}
let replayRecord: ReplayRecord = { id: 0, pending: false }
let readReplay = async (): Promise<ReplayRecord> => replayRecord
let replayChanged: (state: ReplayRecord & { finished: boolean }) => void = () => {}
const requestHomeTourReplay = vi.fn(async (): Promise<number> => {
  replayRecord = { id: replayRecord.id + 1, pending: true }
  return replayRecord.id
})
const finishHomeTour = vi.fn(async (_shownReplayId: number | null): Promise<void> => {})
stubWindowApi({
  getSetting,
  setSetting,
  getHomeTourReplay: () => readReplay(),
  requestHomeTourReplay,
  finishHomeTour,
  onHomeTourReplayChanged: (callback: (state: ReplayRecord & { finished: boolean }) => void) => {
    replayChanged = callback
    return () => {}
  },
  onInstallationsChanged: unsubscribe,
  onInstallationsVersionsUpdated: unsubscribe
})

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

async function tourStateLoaded(): Promise<void> {
  await expect.poll(() => useHomeTour().loaded.value).toBe(true)
  await settle()
}

async function cardSettled(): Promise<void> {
  await expect.poll(() => tourCard()!.getAnimations().length, { timeout: 5000 }).toBe(0)
}

async function settle(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  await nextTick()
}

beforeAll(() => page.viewport(1200, 800))

const telemetry: string[] = []
function recordTelemetry(event: Event): void {
  telemetry.push((event as CustomEvent<{ actionName: string }>).detail.actionName)
}

beforeEach(() => {
  saved.clear()
  saved.set('homeTourAudience', 'new')
  getSetting.mockClear()
  setSetting.mockClear()
  telemetry.length = 0
  replayRecord = { id: 0, pending: false }
  readReplay = async () => replayRecord
  requestHomeTourReplay.mockClear()
  finishHomeTour.mockClear()
  window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, recordTelemetry)
  __resetHomeTourForTest()
  setActivePinia(createPinia())
  useInstallationStore().loading = false
})

afterEach(() => {
  window.removeEventListener(TELEMETRY_ACTION_EVENT_NAME, recordTelemetry)
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
    expect(button('next')?.innerText.trim()).toBe('Done')

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()).toBeNull()
    expect(setSetting).toHaveBeenCalledWith('homeTourDone', true)
  })

  it('never shows the tour again once it is done', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await settle()
    await tourStateLoaded()

    expect(tourCard()).toBeNull()
  })

  it('hides without saving it as done when Home stops being free, and picks up at the same step without counting a second showing', async () => {
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
    expect(telemetry.filter((name) => name === 'comfy.desktop.home_tour.shown')).toHaveLength(1)
  })

  it('shows the tour again after a replay, without saving the replay', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await settle()
    expect(tourCard()).toBeNull()

    await useHomeTour().replay()
    await waitForCard()
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('shows a finished tour when another window asks for a replay, and clears the request when it ends', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await settle()
    expect(tourCard()).toBeNull()

    replayChanged({ id: 4, pending: true, finished: false })
    await waitForCard()
    await userEvent.click(button('skip')!)

    await expect.poll(() => tourCard()).toBeNull()
    expect(finishHomeTour).toHaveBeenCalledWith(4)
  })

  it('shows a finished tour in a window that opens while a replay is waiting', async () => {
    saved.set('homeTourDone', true)
    replayRecord = { id: 3, pending: true }
    placeAnchors()
    mountTour()

    await waitForCard()
  })

  it('does not show the tour when no audience was ever recorded', async () => {
    saved.delete('homeTourAudience')
    placeAnchors()
    mountTour()
    await settle()
    await tourStateLoaded()

    expect(tourCard()).toBeNull()
  })

  it('waits for the build list to load, then counts every step', async () => {
    useInstallationStore().loading = true
    placeAnchors(ALL_ANCHORS.filter((anchor) => anchor !== 'home-builds'))
    mountTour()
    await settle()
    expect(tourCard()).toBeNull()

    placeAnchors(['home-builds'])
    useInstallationStore().loading = false
    const card = await waitForCard()
    expect(card.textContent).toContain('Builds run ComfyUI')
    expect(card.textContent).toContain('1 of 8')
  })

  it('keeps Back, Skip and Next in place when Next becomes Done', async () => {
    saved.set('homeTourAudience', 'updated')
    placeAnchors()
    mountTour()
    await waitForCard()
    for (let step = 1; step < 5; step++) {
      await userEvent.click(button('next')!)
      await expect.poll(() => tourCard()?.textContent).toContain(`${step + 1} of 6`)
    }
    await cardSettled()
    const before = button('next')!.getBoundingClientRect()

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('6 of 6')
    await cardSettled()
    expect(button('next')!.getBoundingClientRect().width).toBe(before.width)
  })

  it('keeps keyboard focus inside the tour card', async () => {
    placeAnchors()
    mountTour()
    const card = await waitForCard()

    for (let press = 0; press < 5; press++) {
      await userEvent.keyboard('{Tab}')
      expect(card.contains(document.activeElement)).toBe(true)
    }
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
    await cardSettled()
    const before = offsets()

    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')
    await cardSettled()
    expect(offsets()).toEqual(before)
  })

  it('scrolls a part below the fold into view before it lights it up', async () => {
    placeAnchors(ALL_ANCHORS.filter((anchor) => anchor !== 'home-builds'))
    const homePage = document.createElement('div')
    homePage.style.cssText =
      'position: fixed; left: 600px; top: 0; width: 300px; height: 300px; overflow: auto'
    const spacer = document.createElement('div')
    spacer.style.height = '900px'
    const builds = document.createElement('div')
    builds.dataset['homeTour'] = 'home-builds'
    builds.style.cssText = 'width: 200px; height: 80px'
    homePage.append(spacer, builds)
    document.body.append(homePage)
    anchors.push(homePage)
    mountTour()
    await waitForCard()

    await expect.poll(() => homePage.scrollTop).toBeGreaterThan(0)
    const rect = builds.getBoundingClientRect()
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(300)
  })

  it('keeps Skip and Next on screen on the builds step in a 600px tall window', async () => {
    await page.viewport(1200, 600)
    try {
      placeAnchors(ALL_ANCHORS.filter((anchor) => anchor !== 'home-builds'))
      const builds = document.createElement('div')
      builds.dataset['homeTour'] = 'home-builds'
      builds.style.cssText = 'position: fixed; left: 300px; top: 460px; width: 900px; height: 120px'
      document.body.append(builds)
      anchors.push(builds)
      mountTour()
      await waitForCard()
      await cardSettled()

      for (const name of ['skip', 'next'] as const) {
        const rect = button(name)!.getBoundingClientRect()
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(rect.bottom).toBeLessThanOrEqual(600)
      }
    } finally {
      await page.viewport(1200, 800)
    }
  })

  it('starts a replay at step 1 even when the tour was paused, and counts it as a new showing', async () => {
    placeAnchors()
    const wrapper = mountTour()
    await waitForCard()
    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')
    await wrapper.setProps({ active: false })
    await expect.poll(() => tourCard()).toBeNull()

    await useHomeTour().replay()
    await wrapper.setProps({ active: true })

    await expect.poll(() => tourCard()?.textContent).toContain('1 of 8')
    expect(telemetry.filter((name) => name === 'comfy.desktop.home_tour.shown')).toHaveLength(2)
  })

  it('keeps a replay asked for by another window while this window is still loading', async () => {
    saved.set('homeTourDone', true)
    let finishRead: (record: ReplayRecord) => void = () => {}
    readReplay = () => new Promise((resolve) => (finishRead = resolve))
    placeAnchors()
    mountTour()
    await settle()

    replayChanged({ id: 1, pending: true, finished: false })
    finishRead({ id: 0, pending: false })

    await waitForCard()
  })

  it('hides the tour when another window finishes it', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    replayChanged({ id: 0, pending: false, finished: true })

    await expect.poll(() => tourCard()).toBeNull()
  })

  it('tells main which replay it showed when that replay ends', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await tourStateLoaded()

    await useHomeTour().replay()
    await waitForCard()
    await userEvent.click(button('skip')!)
    await expect.poll(() => finishHomeTour.mock.calls).toContainEqual([1])
  })

  it('reports the automatic tour as showing no replay when it ends', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    await userEvent.click(button('skip')!)

    await expect.poll(() => finishHomeTour.mock.calls).toContainEqual([null])
  })

  it('keeps showing a newer replay that arrives after this window finished an older one', async () => {
    saved.set('homeTourDone', true)
    placeAnchors()
    mountTour()
    await tourStateLoaded()
    replayChanged({ id: 1, pending: true, finished: false })
    await waitForCard()
    await userEvent.click(button('skip')!)
    await expect.poll(() => tourCard()).toBeNull()

    replayChanged({ id: 2, pending: true, finished: true })

    await waitForCard()
  })

  it('picks up at the next step when the part of the paused step is gone', async () => {
    placeAnchors()
    const wrapper = mountTour()
    await waitForCard()
    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Comfy Cloud')

    await wrapper.setProps({ active: false })
    await expect.poll(() => tourCard()).toBeNull()
    anchors.find((el) => el.dataset['homeTour'] === 'cloud-build')!.remove()
    await wrapper.setProps({ active: true })

    await expect.poll(() => tourCard()?.textContent).toContain('Local build')
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

  async function goToAllBuilds() {
    placeAnchors()
    const allBuilds = anchors.find((el) => el.dataset['homeTour'] === 'all-builds')!
    const control = document.createElement('button')
    control.style.cssText = 'position: absolute; left: 0; top: 0; width: 80px; height: 40px'
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('width', '20')
    icon.setAttribute('height', '20')
    icon.style.cssText = 'position: absolute; left: 50px; top: 10px'
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    stroke.setAttribute('width', '20')
    stroke.setAttribute('height', '20')
    icon.append(stroke)
    control.append(icon)
    allBuilds.append(control)
    const wrapper = mountTour()
    await waitForCard()
    for (let step = 0; step < 3; step++) {
      await userEvent.click(button('next')!)
    }
    await expect.poll(() => tourCard()?.textContent).toContain('All your builds')
    return { control, wrapper }
  }

  function highlightedPart(): HTMLElement {
    return document.querySelector<HTMLElement>('[data-testid="home-tour-target"]')!
  }

  it('passes a click on the highlighted part to the control under it, and counts the tour as done once that control opens something', async () => {
    const { control, wrapper } = await goToAllBuilds()
    const opened = vi.fn(() => void wrapper.setProps({ active: false }))
    control.addEventListener('click', opened)

    await userEvent.click(highlightedPart(), { position: { x: 20, y: 20 } })

    await expect.poll(() => tourCard()).toBeNull()
    expect(opened).toHaveBeenCalledTimes(1)
    await expect.poll(() => setSetting.mock.calls).toContainEqual(['homeTourDone', true])
    expect(telemetry).toContain('comfy.desktop.home_tour.target_opened')
  })

  it('passes a click on an icon inside the highlighted control to that control', async () => {
    const { control } = await goToAllBuilds()
    const opened = vi.fn()
    control.addEventListener('click', opened)

    await userEvent.click(highlightedPart(), { position: { x: 64, y: 24 } })

    await expect.poll(() => opened.mock.calls.length).toBe(1)
  })

  it('keeps the tour running when the click opens nothing, like a side card that only turns the carousel', async () => {
    const { control } = await goToAllBuilds()
    const moved = vi.fn()
    control.addEventListener('click', moved)

    await userEvent.click(highlightedPart(), { position: { x: 20, y: 20 } })
    await settle()

    expect(moved).toHaveBeenCalledTimes(1)
    expect(tourCard()?.textContent).toContain('All your builds')
    expect(setSetting).not.toHaveBeenCalled()
    expect(telemetry).not.toContain('comfy.desktop.home_tour.target_opened')
  })

  it("does not count a click as done when What's new opens right after it", async () => {
    const { wrapper } = await goToAllBuilds()

    await userEvent.click(highlightedPart(), { position: { x: 20, y: 20 } })
    await wrapper.setProps({ active: false, interrupted: true })
    await settle()

    expect(setSetting).not.toHaveBeenCalled()
    expect(telemetry).not.toContain('comfy.desktop.home_tour.target_opened')
  })

  it('forgets a click that opened nothing once the user moves on with Next', async () => {
    const { wrapper } = await goToAllBuilds()

    await userEvent.click(highlightedPart(), { position: { x: 20, y: 20 } })
    await userEvent.click(button('next')!)
    await wrapper.setProps({ active: false })
    await settle()

    expect(setSetting).not.toHaveBeenCalled()
  })

  it('keeps the tour running when the control under the click is disabled', async () => {
    const { control, wrapper } = await goToAllBuilds()
    control.disabled = true
    control.addEventListener('click', () => void wrapper.setProps({ active: false }))

    await userEvent.click(highlightedPart(), { position: { x: 20, y: 20 } })
    await settle()

    expect(tourCard()?.textContent).toContain('All your builds')
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('moves on to the next step when the part of the current step disappears', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()
    await userEvent.click(button('next')!)
    await userEvent.click(button('next')!)
    await expect.poll(() => tourCard()?.textContent).toContain('Local build')

    anchors.find((el) => el.dataset['homeTour'] === 'local-build')!.remove()

    await expect.poll(() => tourCard()?.textContent).toContain('All your builds')
  })

  it('keeps the same steps after a pause, even when another part appears meanwhile', async () => {
    placeAnchors(ALL_ANCHORS.filter((anchor) => anchor !== 'apps-carousel'))
    const wrapper = mountTour()
    await waitForCard()
    expect(tourCard()?.textContent).toContain('1 of 7')

    await wrapper.setProps({ active: false })
    await expect.poll(() => tourCard()).toBeNull()
    placeAnchors(['apps-carousel'])
    await wrapper.setProps({ active: true })

    await expect.poll(() => tourCard()?.textContent).toContain('1 of 7')
  })

  it('keeps the tour open when the click lands on a part of the highlight with nothing under it', async () => {
    await goToAllBuilds()

    await userEvent.click(highlightedPart(), { position: { x: 160, y: 20 } })
    await settle()

    expect(tourCard()?.textContent).toContain('All your builds')
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('dims everything except the highlighted part and hides the page behind from screen readers', async () => {
    placeAnchors()
    mountTour()
    await waitForCard()

    expect(
      document.elementFromPoint(10, 10)?.closest('[data-testid="home-tour-dim"]')
    ).not.toBeNull()
    expect(anchors[0]!.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
