import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useStaffApps } from './useStaffApps'
import type { StaffApps } from './useStaffApps'
import type { HiddenAppCard, HiddenAppsList } from '../types/ipc'

const WORLDS: HiddenAppCard = {
  id: 'explore-worlds',
  title: 'Explore Worlds',
  description: '',
  covers: [],
  reasons: ['hub_only'],
  page: 'live'
}

const listHiddenApps = vi.fn<() => Promise<HiddenAppsList | undefined>>()
let listChanged: () => void = () => {}
const stopListening = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    listHiddenApps,
    onAppsListChanged: (listener: () => void) => {
      listChanged = listener
      return stopListening
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

async function mountStaffApps() {
  let staff: StaffApps | null = null
  const wrapper = mount(
    defineComponent({
      setup() {
        staff = useStaffApps()
        return () => h('div')
      }
    })
  )
  await flushPromises()
  return { wrapper, staff: staff as unknown as StaffApps }
}

describe('useStaffApps', () => {
  it('shows the staff apps once Desktop lists some', async () => {
    listHiddenApps.mockResolvedValue({ apps: [WORLDS] })
    const { staff } = await mountStaffApps()

    expect(staff.shown.value).toBe(true)
    expect(staff.apps.value.map((app) => app.id)).toEqual(['explore-worlds'])
  })

  it('shows nothing when the list does not answer', async () => {
    listHiddenApps.mockRejectedValue(new Error('refused'))
    const { staff } = await mountStaffApps()

    expect(staff.shown.value).toBe(false)
  })

  it('lists again when Desktop says the list changed, and stops listening when unmounted', async () => {
    listHiddenApps.mockResolvedValue({ apps: [WORLDS] })
    const { wrapper, staff } = await mountStaffApps()

    listHiddenApps.mockResolvedValue({ apps: [] })
    listChanged()
    await flushPromises()

    expect(listHiddenApps).toHaveBeenCalledTimes(2)
    expect(staff.shown.value).toBe(false)
    wrapper.unmount()
    expect(stopListening).toHaveBeenCalledOnce()
  })

  it('keeps the newest list when an older one answers after it', async () => {
    listHiddenApps.mockResolvedValue({ apps: [] })
    const { staff } = await mountStaffApps()
    let answerOlder: (list: HiddenAppsList) => void = () => {}
    listHiddenApps.mockReturnValueOnce(
      new Promise<HiddenAppsList>((resolve) => {
        answerOlder = resolve
      })
    )
    listHiddenApps.mockReturnValueOnce(Promise.resolve({ apps: [] }))

    listChanged()
    listChanged()
    await flushPromises()
    answerOlder({ apps: [WORLDS] })
    await flushPromises()

    expect(staff.shown.value).toBe(false)
  })

  it.each([
    ['no list', undefined],
    ['a list with no apps array', { apps: 'none' } as unknown as HiddenAppsList],
    ['nothing at all', null as unknown as HiddenAppsList]
  ])(
    'shows nothing, and leaves no failure behind, when Desktop answers %s',
    async (_label, answer) => {
      listHiddenApps.mockResolvedValue(answer)
      const { staff } = await mountStaffApps()

      expect(staff.shown.value).toBe(false)
    }
  )

  it('shows nothing when the bridge has no list to ask', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.listHiddenApps = undefined
    const { staff } = await mountStaffApps()

    expect(staff.shown.value).toBe(false)
  })
})

describe('useStaffApps after a failed list', () => {
  it('asks again after 5, 10 and 20 seconds, and stops once the list answers', async () => {
    vi.useFakeTimers()
    listHiddenApps.mockRejectedValue(new Error('timed out'))
    const { staff } = await mountStaffApps()
    expect(listHiddenApps).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(listHiddenApps).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(listHiddenApps).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(3)

    listHiddenApps.mockResolvedValue({ apps: [WORLDS] })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(4)
    expect(staff.shown.value).toBe(true)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(4)
  })

  it('asks again when Desktop says its list is out of date, keeping the apps it has', async () => {
    vi.useFakeTimers()
    listHiddenApps.mockResolvedValue({ apps: [WORLDS], stale: true })
    const { staff } = await mountStaffApps()
    expect(staff.shown.value).toBe(true)

    listHiddenApps.mockRejectedValue(new Error('timed out'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(listHiddenApps).toHaveBeenCalledTimes(2)
    expect(staff.apps.value.map((app) => app.id)).toEqual(['explore-worlds'])
  })

  it('never waits more than five minutes between asks', async () => {
    vi.useFakeTimers()
    listHiddenApps.mockResolvedValue({ apps: [], stale: true })
    await mountStaffApps()

    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 40_000 + 80_000 + 160_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(8)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(9)
  })

  it('asks again at once when the window gets focus while it is waiting to retry', async () => {
    vi.useFakeTimers()
    listHiddenApps.mockRejectedValue(new Error('timed out'))
    const { staff } = await mountStaffApps()

    listHiddenApps.mockResolvedValue({ apps: [WORLDS] })
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)

    expect(listHiddenApps).toHaveBeenCalledTimes(2)
    expect(staff.shown.value).toBe(true)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(listHiddenApps).toHaveBeenCalledTimes(2)
  })

  it('does not ask again on focus once the list has answered', async () => {
    listHiddenApps.mockResolvedValue({ apps: [WORLDS] })
    await mountStaffApps()

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(listHiddenApps).toHaveBeenCalledOnce()
  })

  it('stops asking once unmounted', async () => {
    vi.useFakeTimers()
    listHiddenApps.mockRejectedValue(new Error('timed out'))
    const { wrapper } = await mountStaffApps()

    wrapper.unmount()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60 * 60_000)

    expect(listHiddenApps).toHaveBeenCalledOnce()
  })
})
