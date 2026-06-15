import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import type { AdoptPromptRequest } from '../types/ipc'

const { alertMock, confirmMock } = vi.hoisted(() => ({
  alertMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('./useDialogs', () => ({
  useDialogs: () => ({ alert: alertMock, confirm: confirmMock }),
}))

import { useAdoptPromptBridge } from './useAdoptPromptBridge'

const Host = defineComponent({
  setup() {
    useAdoptPromptBridge()
    return () => h('div')
  },
})

function makeRequest(overrides: Partial<AdoptPromptRequest> = {}): AdoptPromptRequest {
  return {
    promptId: 'p-1',
    type: 'error',
    title: 'ComfyUI source unavailable',
    message: 'Could not get the source.',
    detail: 'git clone failed',
    detailLabel: 'Details',
    buttons: ['Retry', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    ...overrides,
  }
}

let capturedCallback: ((req: AdoptPromptRequest) => void) | null
let ackMock: ReturnType<typeof vi.fn>
let respondMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  capturedCallback = null
  ackMock = vi.fn()
  respondMock = vi.fn()
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      onAdoptPrompt: (cb: (req: AdoptPromptRequest) => void) => {
        capturedCallback = cb
        return () => {}
      },
      ackAdoptPrompt: ackMock,
      respondAdoptPrompt: respondMock,
    },
  }
})

describe('useAdoptPromptBridge', () => {
  it('ACKs immediately and responds with the primary button index for a confirm prompt', async () => {
    confirmMock.mockResolvedValue('primary')
    const wrapper = mount(Host)

    capturedCallback!(makeRequest())
    await flushPromises()

    expect(ackMock).toHaveBeenCalledWith({ promptId: 'p-1' })
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'ComfyUI source unavailable',
        confirmLabel: 'Retry',
        cancelLabel: 'Cancel',
        tone: 'danger',
        showCancel: true,
        messageDetails: [{ label: 'Details', items: ['git clone failed'] }],
      })
    )
    expect(respondMock).toHaveBeenCalledWith({ promptId: 'p-1', buttonIndex: 0 })
    wrapper.unmount()
  })

  it('responds with the cancel button index when the confirm is dismissed', async () => {
    confirmMock.mockResolvedValue(false)
    const wrapper = mount(Host)

    capturedCallback!(makeRequest())
    await flushPromises()

    expect(respondMock).toHaveBeenCalledWith({ promptId: 'p-1', buttonIndex: 1 })
    wrapper.unmount()
  })

  it('uses an alert (no cancel) for single-button prompts and responds with cancelId', async () => {
    alertMock.mockResolvedValue(undefined)
    const wrapper = mount(Host)

    capturedCallback!(
      makeRequest({ buttons: ['Cancel'], defaultId: 0, cancelId: 0, type: 'info' })
    )
    await flushPromises()

    expect(alertMock).toHaveBeenCalledWith(
      expect.objectContaining({ buttonLabel: 'Cancel', tone: 'primary' })
    )
    expect(confirmMock).not.toHaveBeenCalled()
    expect(respondMock).toHaveBeenCalledWith({ promptId: 'p-1', buttonIndex: 0 })
    wrapper.unmount()
  })

  it('falls back to cancelId if the dialog throws', async () => {
    confirmMock.mockRejectedValue(new Error('boom'))
    const wrapper = mount(Host)

    capturedCallback!(makeRequest())
    await flushPromises()

    expect(respondMock).toHaveBeenCalledWith({ promptId: 'p-1', buttonIndex: 1 })
    wrapper.unmount()
  })
})
