import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { emitTelemetryAction } from '../lib/telemetry'
import AppRequestModal from './AppRequestModal.vue'

vi.mock('../lib/telemetry', () => ({ emitTelemetryAction: vi.fn() }))

const wrappers: VueWrapper[] = []

async function mountRequest(open = true) {
  const wrapper = mount(AppRequestModal, { attachTo: document.body, props: { open } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function input(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="app-request-input"]')!
}

function sendButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[data-testid="app-request-send"]')!
}

async function type(text: string): Promise<void> {
  input().value = text
  input().dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('AppRequestModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(emitTelemetryAction).mockClear()
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.useRealTimers()
  })

  it('asks what app the person wants and keeps Send off until they type something', async () => {
    await mountRequest()

    expect(document.body.textContent).toContain('What app do you want?')
    expect(input().maxLength).toBe(500)
    expect(sendButton().disabled).toBe(true)

    await type('   ')
    expect(sendButton().disabled).toBe(true)

    await type('An app that colors line art')
    expect(sendButton().disabled).toBe(false)
  })

  it('sends the request once as the survey answer, then thanks the person and closes', async () => {
    const wrapper = await mountRequest()
    await type('  An app that colors line art  ')

    sendButton().click()
    await flushPromises()

    expect(emitTelemetryAction).toHaveBeenCalledExactlyOnceWith('survey sent', {
      $survey_id: '01a1f22e-d672-0000-a5ce-85d8a1d81406',
      '$survey_response_0f16a789-5c8e-4871-b44e-ec11c54b8c9b': 'An app that colors line art'
    })
    expect(document.querySelector('[data-testid="app-request-thanks"]')?.textContent).toContain(
      'Thanks. We got your request.'
    )
    expect(document.querySelector('[data-testid="app-request-send"]')).toBeNull()

    vi.advanceTimersByTime(1999)
    expect(wrapper.emitted('close')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('sends with Cmd or Ctrl and Enter', async () => {
    await mountRequest()
    await type('An app that colors line art')

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    await flushPromises()

    expect(emitTelemetryAction).toHaveBeenCalledTimes(1)
  })

  it('closes on Cancel without sending anything', async () => {
    const wrapper = await mountRequest()
    await type('An app that colors line art')

    document.querySelector<HTMLButtonElement>('[data-testid="app-request-cancel"]')!.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(emitTelemetryAction).not.toHaveBeenCalled()
  })

  it('starts empty each time it opens', async () => {
    const wrapper = await mountRequest()
    await type('An app that colors line art')
    sendButton().click()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(input().value).toBe('')
    expect(sendButton().disabled).toBe(true)
  })
})
