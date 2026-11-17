import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SidebarCredits from './SidebarCredits.vue'
import { useAuthStore } from '../stores/authStore'
import type { CreditBalanceState } from '../types/ipc'

const refreshCreditBalance = vi.fn<() => Promise<CreditBalanceState>>()
const openSettingsPage = vi.fn(async () => {})
const balanceListeners = new Set<(state: CreditBalanceState) => void>()
const pageClosedListeners = new Set<() => void>()
const wrappers: VueWrapper[] = []

beforeEach(() => {
  vi.clearAllMocks()
  balanceListeners.clear()
  pageClosedListeners.clear()
  refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: 1_000 })
  ;(window as unknown as { api: unknown }).api = {
    refreshCreditBalance,
    comfybuilder: { openSettingsPage, onAuthChanged: () => () => {} },
    onCreditBalanceChanged: (callback: (state: CreditBalanceState) => void) => {
      balanceListeners.add(callback)
      return () => balanceListeners.delete(callback)
    },
    onAppPageClosed: (callback: () => void) => {
      pageClosedListeners.add(callback)
      return () => pageClosedListeners.delete(callback)
    }
  }
  setActivePinia(createPinia())
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
    refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: -5 })

    const wrapper = await mountCredits()

    expect(wrapper.get('[data-testid="app-sidebar-credits-value"]').text()).toBe('-11')
  })

  it('shows a spinner while loading and says so when the balance cannot load', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'loading' })
    const wrapper = await mountCredits()
    expect(wrapper.find('[data-testid="app-sidebar-credits-loading"]').exists()).toBe(true)

    await announce({ status: 'error' })

    expect(row(wrapper).text()).toBe('CreditsUnable to load balance')
  })

  it('is hidden while signed out and follows the balance main announces', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'signed_out' })
    const wrapper = await mountCredits()
    expect(row(wrapper).exists()).toBe(false)

    await announce({ status: 'ready', cents: 100 })
    expect(row(wrapper).text()).toBe('Credits211')

    await announce({ status: 'signed_out' })
    expect(row(wrapper).exists()).toBe(false)
  })

  it('opens the Platform billing settings of the signed-in workspace on click', async () => {
    useAuthStore().status = { signedIn: true, workspaceId: 'ws-1' }
    const wrapper = await mountCredits()

    await row(wrapper).trigger('click')

    expect(openSettingsPage).toHaveBeenCalledExactlyOnceWith('billing', 'ws-1')
  })

  it('asks for a fresh balance on hover and when an app page closes, and shows it', async () => {
    const wrapper = await mountCredits()
    refreshCreditBalance.mockClear()
    refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: 200 })

    await row(wrapper).trigger('pointerenter')
    for (const listener of pageClosedListeners) listener()
    await flushPromises()

    expect(refreshCreditBalance).toHaveBeenCalledTimes(2)
    expect(row(wrapper).text()).toBe('Credits422')
  })

  it('shows only the coin when collapsed, with the balance in a tooltip on the right', async () => {
    vi.useFakeTimers()
    const wrapper = mount(SidebarCredits, { props: { collapsed: true }, attachTo: document.body })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(row(wrapper).text()).toBe('')
    expect(row(wrapper).get('svg').classes()).toEqual(
      expect.arrayContaining(['stroke-current', 'text-foreground'])
    )

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
