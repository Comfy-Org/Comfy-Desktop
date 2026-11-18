import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useAnnouncement } from './useAnnouncement'

describe('useAnnouncement', () => {
  const api = {
    closeAnnouncement: vi.fn(),
    closeCurrentPanel: vi.fn(),
    setSetting: vi.fn(),
    onOpenAnnouncement: vi.fn()
  }
  let open: () => void
  let announcement: ReturnType<typeof useAnnouncement>
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    api.onOpenAnnouncement.mockImplementation((cb: () => void) => {
      open = cb
      return () => {}
    })
    vi.stubGlobal('api', api)
    wrapper = mount(
      defineComponent({
        setup() {
          announcement = useAnnouncement()
          return () => h('div')
        }
      })
    )
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('marks the announcement seen when it opens', () => {
    open()

    expect(announcement.announcementOpen.value).toBe(true)
    expect(api.setSetting).toHaveBeenCalledWith('comfyApiAnnouncementSeen', true)
  })

  it("asks main to close only What's New, never to reset the current page", () => {
    open()

    announcement.closeAnnouncement()

    expect(announcement.announcementOpen.value).toBe(false)
    expect(api.closeAnnouncement).toHaveBeenCalledTimes(1)
    expect(api.closeCurrentPanel).not.toHaveBeenCalled()
  })
})
