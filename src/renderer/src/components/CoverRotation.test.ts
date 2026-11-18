import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

import '../assets/main.css'
import CoverRotation from './CoverRotation.vue'
import { COVER_FADE_MS, COVER_HOLD_MS } from '../composables/useCoverRotation'
import type { AppCover } from '../types/ipc'

function picture(fill: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5"><rect width="8" height="5" fill="${fill}"/></svg>`
  )}`
}

const COVERS: AppCover[] = [
  { url: picture('red'), stillUrl: picture('darkred') },
  { url: picture('green'), stillUrl: picture('darkgreen') },
  { url: picture('blue'), stillUrl: picture('darkblue') }
]
const URLS = COVERS.map((cover) => cover.url)
const STILLS = COVERS.map((cover) => cover.stillUrl)

const mounted: VueWrapper[] = []
let card: HTMLElement

function mountCovers(covers: readonly AppCover[] = COVERS, props: { paused?: boolean } = {}) {
  const wrapper = mount(CoverRotation, { attachTo: card, props: { pictures: covers, ...props } })
  mounted.push(wrapper)
  return wrapper
}

function layer(wrapper: VueWrapper, role: string) {
  return wrapper.find(`img[data-cover="${role}"]`)
}

const shownSrc = (wrapper: VueWrapper) => layer(wrapper, 'shown').attributes('src')

async function untilAllLoaded(wrapper: VueWrapper): Promise<void> {
  await expect
    .poll(() => wrapper.findAll('img').every((img) => img.attributes('data-loaded') === 'true'))
    .toBe(true)
}

async function untilTheCoverChanges(wrapper: VueWrapper, from: string | undefined) {
  await expect
    .poll(async () => {
      vi.advanceTimersByTime(COVER_HOLD_MS)
      await nextTick()
      return shownSrc(wrapper)
    })
    .not.toBe(from)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  card = document.createElement('div')
  card.style.cssText = 'position: fixed; left: 0; top: 0; width: 505px; height: 316px'
  document.body.append(card)
})

afterEach(() => {
  mounted.forEach((wrapper) => wrapper.unmount())
  mounted.length = 0
  card.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('CoverRotation', () => {
  it('shows one cover and loads the next one, hidden, behind it', async () => {
    const wrapper = mountCovers()
    await untilAllLoaded(wrapper)

    expect(URLS).toContain(shownSrc(wrapper))
    expect(URLS).toContain(layer(wrapper, 'upcoming').attributes('src'))
    expect(layer(wrapper, 'upcoming').attributes('src')).not.toBe(shownSrc(wrapper))
    expect(layer(wrapper, 'shown').classes()).toContain('opacity-100')
    expect(layer(wrapper, 'upcoming').classes()).toContain('opacity-0')
  })

  it('fades to the next cover after one loop, over the one before, and keeps going', async () => {
    const wrapper = mountCovers()
    await untilAllLoaded(wrapper)
    const first = shownSrc(wrapper)
    const second = layer(wrapper, 'upcoming').attributes('src')

    await untilTheCoverChanges(wrapper, first)

    expect(shownSrc(wrapper)).toBe(second)
    expect(layer(wrapper, 'leaving').attributes('src')).toBe(first)

    vi.advanceTimersByTime(COVER_FADE_MS)
    await nextTick()

    expect(layer(wrapper, 'leaving').exists()).toBe(false)
    await untilAllLoaded(wrapper)
    await untilTheCoverChanges(wrapper, second)
    expect(shownSrc(wrapper)).not.toBe(second)
  })

  it('shows a still while it is paused, with its moving cover loading hidden behind it', async () => {
    const wrapper = mountCovers(COVERS, { paused: true })
    await untilAllLoaded(wrapper)
    const still = shownSrc(wrapper)

    expect(STILLS).toContain(still)
    expect(layer(wrapper, 'shown').attributes('data-kind')).toBe('still')
    const behind = layer(wrapper, 'upcoming')
    expect(behind.attributes('data-kind')).toBe('cover')
    expect(URLS).toContain(behind.attributes('src'))
    expect(behind.classes()).toContain('opacity-0')

    vi.advanceTimersByTime(COVER_HOLD_MS * 6)
    await wrapper.vm.$nextTick()
    expect(shownSrc(wrapper)).toBe(still)
  })

  it('plays the moving cover once it is no longer paused', async () => {
    const wrapper = mountCovers(COVERS, { paused: true })
    await untilAllLoaded(wrapper)

    await wrapper.setProps({ paused: false })
    await untilAllLoaded(wrapper)
    const first = shownSrc(wrapper)

    expect(URLS).toContain(first)
    expect(layer(wrapper, 'shown').attributes('data-kind')).toBe('cover')
    await untilTheCoverChanges(wrapper, first)
  })

  it('shows nothing moving while it is paused and the cover has no still', async () => {
    const wrapper = mountCovers(
      COVERS.map((cover) => ({ ...cover, stillUrl: null })),
      { paused: true }
    )
    await untilAllLoaded(wrapper)

    expect(layer(wrapper, 'shown').exists()).toBe(false)
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(layer(wrapper, 'upcoming').classes()).toContain('opacity-0')
    expect(wrapper.emitted('broken')).toBeUndefined()
  })

  it('keeps the still of a paused card when its moving cover fails, also once it plays', async () => {
    const broken = 'data:image/png;base64,broken'
    const wrapper = mountCovers([{ ...COVERS[0]!, url: broken }], { paused: true })

    await expect.poll(() => wrapper.findAll('img')).toHaveLength(1)
    await untilAllLoaded(wrapper)
    expect(shownSrc(wrapper)).toBe(STILLS[0])
    expect(wrapper.emitted('broken')).toBeUndefined()

    await wrapper.setProps({ paused: false })
    await untilAllLoaded(wrapper)
    expect(shownSrc(wrapper)).toBe(STILLS[0])
    expect(wrapper.emitted('broken')).toBeUndefined()
  })

  it('reports broken when a paused card has no still and its moving cover fails', async () => {
    const broken = 'data:image/png;base64,broken'
    const wrapper = mountCovers([{ url: broken, stillUrl: null }], { paused: true })

    await expect.poll(() => wrapper.emitted('broken')).toHaveLength(1)
  })

  it('stands still while it is off screen', async () => {
    const wrapper = mountCovers()
    const rotation = wrapper.get('[data-testid="cover-rotation"]')
    await untilAllLoaded(wrapper)
    await expect.poll(() => rotation.attributes('data-playing')).toBe('true')
    card.style.top = '-4000px'
    await expect.poll(() => rotation.attributes('data-playing')).toBe('false')
    const first = shownSrc(wrapper)

    vi.advanceTimersByTime(COVER_HOLD_MS * 6)
    await nextTick()
    expect(shownSrc(wrapper)).toBe(first)

    card.style.top = '0'
    await expect.poll(() => rotation.attributes('data-playing')).toBe('true')
    await untilTheCoverChanges(wrapper, first)
  })

  it('draws each of two covers once while one fades over the other', async () => {
    const wrapper = mountCovers(COVERS.slice(0, 2))
    await untilAllLoaded(wrapper)
    const first = shownSrc(wrapper)

    await untilTheCoverChanges(wrapper, first)

    const sources = wrapper.findAll('img').map((img) => img.attributes('src'))
    expect(sources).toHaveLength(2)
    expect(new Set(sources).size).toBe(2)
    expect(layer(wrapper, 'leaving').attributes('src')).toBe(first)

    vi.advanceTimersByTime(COVER_FADE_MS)
    await nextTick()
    expect(layer(wrapper, 'upcoming').attributes('src')).toBe(first)
  })

  it('shows the covers again when the list changes but keeps a cover it had', async () => {
    const wrapper = mountCovers(COVERS.slice(0, 2))
    await untilAllLoaded(wrapper)

    await wrapper.setProps({ pictures: [COVERS[0]!, COVERS[2]!] })

    await untilAllLoaded(wrapper)
    expect(layer(wrapper, 'shown').classes()).toContain('opacity-100')
  })

  it('shows only a still, and never changes it, when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }))
    const wrapper = mountCovers()
    await untilAllLoaded(wrapper)
    const still = shownSrc(wrapper)

    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(STILLS).toContain(still)

    vi.advanceTimersByTime(COVER_HOLD_MS * 6)
    await wrapper.vm.$nextTick()
    expect(shownSrc(wrapper)).toBe(still)
  })

  it('shows no moving cover when reduced motion is preferred and no cover has a still', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }))
    const wrapper = mountCovers(COVERS.map((cover) => ({ ...cover, stillUrl: null })))
    await nextTick()

    expect(wrapper.findAll('img')).toHaveLength(0)
  })

  it('skips a still that fails to load in reduced motion, and says so once none is left', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }))
    const broken = 'data:image/png;base64,broken'
    const wrapper = mountCovers([
      { ...COVERS[0]!, stillUrl: null },
      { ...COVERS[1]!, stillUrl: broken },
      COVERS[2]!
    ])

    await expect.poll(() => shownSrc(wrapper)).toBe(STILLS[2])
    expect(wrapper.emitted('broken')).toBeUndefined()

    await wrapper.setProps({
      pictures: [
        { ...COVERS[0]!, stillUrl: broken },
        { ...COVERS[1]!, stillUrl: `${broken}2` }
      ]
    })
    await expect.poll(() => wrapper.emitted('broken')).toHaveLength(1)
  })

  it('shows the still of a cover whose moving picture failed, when reduced motion is turned on', async () => {
    let reduce = false
    const listeners: Array<(event: { matches: boolean }) => void> = []
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return reduce && query === '(prefers-reduced-motion: reduce)'
      },
      media: query,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
        listeners.push(listener),
      removeEventListener: () => {}
    }))
    const broken = 'data:image/png;base64,broken'
    const wrapper = mountCovers([
      { url: broken, stillUrl: STILLS[0]! },
      { url: URLS[1]!, stillUrl: null }
    ])
    await expect.poll(() => shownSrc(wrapper)).toBe(URLS[1])

    reduce = true
    listeners.forEach((listener) => listener({ matches: true }))

    await expect.poll(() => shownSrc(wrapper)).toBe(STILLS[0])
    expect(wrapper.emitted('broken')).toBeUndefined()
  })

  it('keeps the one cover of an app that has only one', async () => {
    const wrapper = mountCovers([COVERS[0]!])
    await untilAllLoaded(wrapper)

    vi.advanceTimersByTime(COVER_HOLD_MS * 6)
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(shownSrc(wrapper)).toBe(URLS[0])
  })

  it('leaves out a cover that fails to load and says so once none is left', async () => {
    const broken = 'data:image/png;base64,broken'
    const wrapper = mountCovers([
      { url: broken, stillUrl: null },
      { url: `${broken}2`, stillUrl: null }
    ])

    await expect.poll(() => wrapper.emitted('broken')).toHaveLength(1)
    expect(wrapper.findAll('img')).toHaveLength(0)
  })
})
