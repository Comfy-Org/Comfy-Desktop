import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import SidebarCredits from './SidebarCredits.vue'
import type { CreditBalanceState } from '../types/ipc'

const getCreditBalance = vi.fn<() => Promise<CreditBalanceState>>()
const refreshCreditBalance = vi.fn(async () => {})
const openManageCredits = vi.fn(async () => {})
const balanceListeners = new Set<(state: CreditBalanceState) => void>()
const pageClosedListeners = new Set<() => void>()
const wrappers: VueWrapper[] = []

beforeEach(() => {
  vi.clearAllMocks()
  balanceListeners.clear()
  pageClosedListeners.clear()
  getCreditBalance.mockResolvedValue({ status: 'ready', cents: 1_000 })
  ;(window as unknown as { api: unknown }).api = {
    getCreditBalance,
    refreshCreditBalance,
    openManageCredits,
    onCreditBalanceChanged: (callback: (state: CreditBalanceState) => void) => {
      balanceListeners.add(callback)
      return () => balanceListeners.delete(callback)
    },
    onAppPageClosed: (callback: () => void) => {
      pageClosedListeners.add(callback)
      return () => pageClosedListeners.delete(callback)
    }
  }
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  vi.useRealTimers()
})

async function mountCredits(collapsed = false) {
  const wrapper = mount(SidebarCredits, { props: { collapsed }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function row(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="app-sidebar-credits"]')
}

async function announce(state: CreditBalanceState) {
  for (const listener of balanceListeners) listener(state)
  await flushPromises()
}

describe('SidebarCredits', () => {
  it('shows the balance in credits, 211 to the dollar, and asks main for a fresh one', async () => {
    const wrapper = await mountCredits()

    expect(row(wrapper).text()).toBe('Credits2,110')
    expect(row(wrapper).attributes('aria-label')).toBe('Manage plan & credits')
    expect(wrapper.get('[data-testid="app-sidebar-credits-value"]').classes()).toContain(
      'tabular-nums'
    )
    expect(refreshCreditBalance).toHaveBeenCalledOnce()
  })

  it('rounds to whole credits and shows a negative balance', async () => {
    getCreditBalance.mockResolvedValue({ status: 'ready', cents: -5 })

    const wrapper = await mountCredits()

    expect(wrapper.get('[data-testid="app-sidebar-credits-value"]').text()).toBe('-11')
  })

  it('shows a spinner while loading and says so when the balance cannot load', async () => {
    getCreditBalance.mockResolvedValue({ status: 'loading' })
    const wrapper = await mountCredits()
    expect(wrapper.find('[data-testid="app-sidebar-credits-loading"]').exists()).toBe(true)

    await announce({ status: 'error' })

    expect(wrapper.get('[data-testid="app-sidebar-credits-error"]').text()).toBe(
      'Unable to load balance'
    )
  })

  it('is hidden while signed out and follows the balance main announces', async () => {
    getCreditBalance.mockResolvedValue({ status: 'signed_out' })
    const wrapper = await mountCredits()
    expect(row(wrapper).exists()).toBe(false)

    await announce({ status: 'ready', cents: 100 })
    expect(row(wrapper).text()).toBe('Credits211')

    await announce({ status: 'signed_out' })
    expect(row(wrapper).exists()).toBe(false)
  })

  it('keeps a balance main announced before its first answer arrived', async () => {
    let answer!: (state: CreditBalanceState) => void
    getCreditBalance.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const wrapper = await mountCredits()

    await announce({ status: 'ready', cents: 200 })
    answer({ status: 'loading' })
    await flushPromises()

    expect(row(wrapper).text()).toBe('Credits422')
  })

  it('opens Manage plan & credits on click', async () => {
    const wrapper = await mountCredits()

    await row(wrapper).trigger('click')

    expect(openManageCredits).toHaveBeenCalledOnce()
  })

  it('asks for a fresh balance on hover and when an app page closes', async () => {
    const wrapper = await mountCredits()
    refreshCreditBalance.mockClear()

    await row(wrapper).trigger('pointerenter')
    for (const listener of pageClosedListeners) listener()

    expect(refreshCreditBalance).toHaveBeenCalledTimes(2)
  })

  it('shows only the coin when collapsed, with the balance in a tooltip on the right', async () => {
    vi.useFakeTimers()
    const wrapper = mount(SidebarCredits, { props: { collapsed: true }, attachTo: document.body })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(row(wrapper).text()).toBe('')
    const icon = wrapper.get('[data-testid="app-sidebar-credits-icon"]')
    expect(icon.attributes('stroke')).toBe('currentColor')
    expect(icon.classes()).toContain('text-foreground')

    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    const bubble = document.querySelector<HTMLElement>('.tooltip-bubble')
    expect(bubble?.textContent).toContain('2,110 Credits')
    expect(bubble?.dataset['side']).toBe('right')
  })

  it('has no tooltip when expanded, where the label shows', async () => {
    vi.useFakeTimers()
    const wrapper = mount(SidebarCredits, { props: { collapsed: false }, attachTo: document.body })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })
})
