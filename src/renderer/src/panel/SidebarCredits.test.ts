import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
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
  useAuthStore().status = { signedIn: true, workspaceId: 'ws-1' }
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
  refreshCreditBalance.mockResolvedValue(state)
  for (const listener of balanceListeners) listener(state)
  await flushPromises()
}

async function openTooltip(wrapper: VueWrapper, how: 'hover' | 'focus') {
  if (how === 'hover') {
    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
  } else {
    row(wrapper).element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  }
  await vi.advanceTimersByTimeAsync(200)
  await flushPromises()
  return document.querySelector<HTMLElement>('.tooltip-bubble')
}

async function mountWithTimers(collapsed: boolean) {
  vi.useFakeTimers()
  const wrapper = mount(SidebarCredits, { props: { collapsed }, attachTo: document.body })
  wrappers.push(wrapper)
  await vi.advanceTimersByTimeAsync(1)
  await flushPromises()
  return wrapper
}

describe('SidebarCredits', () => {
  it('shows the balance in credits, 211 to the dollar, and asks main for a fresh one', async () => {
    const wrapper = await mountCredits()

    expect(row(wrapper).text()).toBe('Credits2,110')
    expect(row(wrapper).attributes('aria-label')).toBe('2,110 Credits. Manage plan & credits')
    expect(refreshCreditBalance).toHaveBeenCalledOnce()
  })

  it('lines the number up in fixed-width digits and draws the coin in the row icon color', async () => {
    const wrapper = await mountCredits()

    const value = wrapper.get('[data-testid="app-sidebar-credits-value"]').element
    const coin = row(wrapper).get('svg').element
    expect(getComputedStyle(value).fontVariantNumeric).toContain('tabular-nums')
    expect(getComputedStyle(coin).stroke).toBe(getComputedStyle(row(wrapper).element).color)
    expect(getComputedStyle(coin).fill).toBe('none')
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
    expect(row(wrapper).attributes('aria-label')).toBe(
      'Unable to load balance. Manage plan & credits'
    )
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
    const wrapper = await mountCredits()

    await row(wrapper).trigger('click')

    expect(openSettingsPage).toHaveBeenCalledExactlyOnceWith('billing', 'ws-1')
  })

  it('cannot be clicked while Desktop knows no workspace to open billing for', async () => {
    useAuthStore().status = { signedIn: true }
    const wrapper = await mountCredits()

    await row(wrapper).trigger('click')

    expect(row(wrapper).attributes('disabled')).toBeDefined()
    expect(openSettingsPage).not.toHaveBeenCalled()
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

  it.each([
    [393.37, '830'],
    [3966, '8.4K'],
    [39663, '84K'],
    [585103, '1.2M'],
    [-3966, '-8.4K']
  ])('folds %s cents to the short count %s under the coin', async (cents, short) => {
    refreshCreditBalance.mockResolvedValue({ status: 'ready', cents })

    const wrapper = await mountCredits(true)

    expect(row(wrapper).text()).toBe(short)
  })

  it('shows nothing under the folded coin while loading and a dash on error', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'loading' })
    const wrapper = await mountCredits(true)
    expect(row(wrapper).text()).toBe('')

    await announce({ status: 'error' })

    expect(row(wrapper).text()).toBe('–')
  })

  it.each(['hover', 'focus'] as const)(
    'gives the full balance in a tooltip on the right when folded, on %s',
    async (how) => {
      refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: 39663 })
      const wrapper = await mountWithTimers(true)

      const bubble = await openTooltip(wrapper, how)

      expect(row(wrapper).text()).toBe('84K')
      expect(bubble?.textContent).toContain('83,689 Credits')
      expect(bubble?.dataset['side']).toBe('right')
      expect(row(wrapper).attributes('aria-label')).toBe('83,689 Credits. Manage plan & credits')
    }
  )

  it('says the balance cannot load in the folded tooltip', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'error' })
    const wrapper = await mountWithTimers(true)

    const bubble = await openTooltip(wrapper, 'hover')

    expect(bubble?.textContent).toContain('Unable to load balance')
  })

  it('has no tooltip when expanded, where the label shows', async () => {
    const wrapper = await mountWithTimers(false)

    expect(await openTooltip(wrapper, 'hover')).toBeNull()
  })
})
