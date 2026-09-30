import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createAppI18n } from '../../lib/i18nFactory'
import BetaArgsPill from './BetaArgsPill.vue'
import type { BetaArgView } from '../../types/ipc'

// Real English catalog, so a missing or mis-pluralized key fails here rather than rendering the
// raw key path in the settings view.

const ONE: BetaArgView[] = [{ arg: '--enable-assets', name: 'Asset browser' }]
const TWO: BetaArgView[] = [...ONE, { arg: '--enable-asset-hashing', name: null }]

let openGlobalSettings: ReturnType<typeof vi.fn>
const wrappers: VueWrapper[] = []

function mountPill(args: readonly BetaArgView[]): VueWrapper {
  const wrapper = mount(BetaArgsPill, {
    props: { args },
    global: { plugins: [createAppI18n()] },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}

const pill = (wrapper: VueWrapper) => wrapper.find('button.beta-args-pill')
const popover = (wrapper: VueWrapper) => wrapper.find('.beta-args-popover')

beforeEach(() => {
  openGlobalSettings = vi.fn()
  ;(window as unknown as { api: unknown }).api = { openGlobalSettings }
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  delete (window as unknown as { api?: unknown }).api
  vi.useRealTimers()
})

describe('BetaArgsPill', () => {
  it('renders nothing when no grant is active', () => {
    const wrapper = mountPill([])
    expect(wrapper.find('.beta-args').exists()).toBe(false)
  })

  it.each([
    [ONE, '+1 beta', '1 beta argument added, show details'],
    [TWO, '+2 beta', '2 beta arguments added, show details']
  ])('labels %# with the grant count', (args, label, ariaLabel) => {
    const wrapper = mountPill(args)
    expect(pill(wrapper).text()).toBe(label)
    expect(pill(wrapper).attributes('aria-label')).toBe(ariaLabel)
    expect(pill(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('explains the pill on hover', async () => {
    vi.useFakeTimers()
    const wrapper = mountPill(ONE)
    await wrapper.find('.tooltip-wrap').trigger('mouseenter')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain(
      '1 beta argument added for this session. Click to see which.'
    )
  })

  it('lists each grant with its feature name when opened', async () => {
    const wrapper = mountPill(TWO)
    await pill(wrapper).trigger('click')

    expect(pill(wrapper).attributes('aria-expanded')).toBe('true')
    expect(popover(wrapper).attributes('id')).toBe(pill(wrapper).attributes('aria-controls'))
    expect(popover(wrapper).attributes('role')).toBe('dialog')
    expect(popover(wrapper).text()).toContain('Added at launch by beta features')
    const rows = popover(wrapper)
      .findAll('.beta-args-row')
      .map((row) => [row.find('.beta-args-flag').text(), row.find('.beta-args-name').text()])
    // A grant whose payload named no feature falls back to the generic name.
    expect(rows).toEqual([
      ['--enable-assets', 'Asset browser'],
      ['--enable-asset-hashing', 'Beta feature']
    ])
  })

  it('suppresses the hover tooltip while the popover is open', async () => {
    vi.useFakeTimers()
    const wrapper = mountPill(ONE)
    await pill(wrapper).trigger('click')
    await wrapper.find('.tooltip-wrap').trigger('mouseenter')
    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('closes on a second click', async () => {
    const wrapper = mountPill(ONE)
    await pill(wrapper).trigger('click')
    await pill(wrapper).trigger('click')
    expect(popover(wrapper).exists()).toBe(false)
    expect(pill(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('closes on Escape, returns focus to the pill, and keeps Escape from the host popup', async () => {
    const hostEscape = vi.fn()
    window.addEventListener('keydown', hostEscape)
    try {
      const wrapper = mountPill(ONE)
      await pill(wrapper).trigger('click')
      await popover(wrapper).find('.beta-args-manage').trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(popover(wrapper).exists()).toBe(false)
      expect(document.activeElement).toBe(pill(wrapper).element)
      expect(hostEscape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', hostEscape)
    }
  })

  it('lets Escape through to the host popup while closed', async () => {
    const hostEscape = vi.fn()
    window.addEventListener('keydown', hostEscape)
    try {
      const wrapper = mountPill(ONE)
      await pill(wrapper).trigger('keydown', { key: 'Escape' })
      expect(hostEscape).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('keydown', hostEscape)
    }
  })

  it('closes on a click outside', async () => {
    const wrapper = mountPill(ONE)
    await pill(wrapper).trigger('click')
    // onClickOutside drops a second click in the same macrotask; a real one never is.
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(popover(wrapper).exists()).toBe(false)
  })

  it('closes when the window loses focus', async () => {
    const wrapper = mountPill(ONE)
    await pill(wrapper).trigger('click')
    window.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(popover(wrapper).exists()).toBe(false)
  })

  it('opens Global Settings on the beta opt-in switch from "Manage beta features"', async () => {
    const wrapper = mountPill(ONE)
    await pill(wrapper).trigger('click')
    const manage = popover(wrapper).find('.beta-args-manage')
    expect(manage.text()).toBe('Manage beta features')

    await manage.trigger('click')

    expect(openGlobalSettings).toHaveBeenCalledExactlyOnceWith('general', {
      highlightField: 'betaFeaturesEnabled'
    })
    expect(popover(wrapper).exists()).toBe(false)
  })
})
