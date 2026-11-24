import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  hasPage: true
}

const listHiddenApps = vi.fn<() => Promise<HiddenAppsList>>()
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
})
