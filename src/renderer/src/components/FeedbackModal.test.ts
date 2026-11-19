import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createWidget } from '@typeform/embed'
import { emitTelemetryAction } from '../lib/telemetry'
import FeedbackModal from './FeedbackModal.vue'

vi.mock('@typeform/embed', () => ({ createWidget: vi.fn() }))
vi.mock('../lib/telemetry', () => ({ emitTelemetryAction: vi.fn() }))

const hiddenFields = { ver: '1.1.10', platform: 'mac' }
const submission = { formId: 'VhOXmuaL', responseId: 'response-id' }
const ready = { formId: 'VhOXmuaL', isClosed: false }
const wrappers: VueWrapper[] = []

async function mountFeedback(open = true) {
  const wrapper = mount(FeedbackModal, {
    attachTo: document.body,
    props: { open, hiddenFields }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function widgetOptions(index = 0) {
  return vi.mocked(createWidget).mock.calls[index]![1]
}

describe('FeedbackModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(createWidget).mockReset()
    vi.mocked(createWidget).mockImplementation(() => ({
      unmount: vi.fn(),
      refresh: vi.fn(),
      focus: vi.fn()
    }))
    vi.mocked(emitTelemetryAction).mockClear()
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.useRealTimers()
  })

  it('creates the SDK widget on opening and waits for onReady to hide the loading indicator', async () => {
    const wrapper = await mountFeedback(false)
    expect(createWidget).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(createWidget).toHaveBeenCalledWith(
      'VhOXmuaL',
      expect.objectContaining({
        container: document.querySelector('[data-testid="feedback-widget"]'),
        hidden: hiddenFields,
        inlineOnMobile: true,
        redirectTarget: '_self',
        iframeProps: expect.objectContaining({ title: 'Send Feedback' })
      })
    )
    expect(document.querySelector('.feedback-modal-loading')).not.toBeNull()

    widgetOptions().onReady?.(ready)
    await flushPromises()
    expect(document.querySelector('.feedback-modal-loading')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(emitTelemetryAction).not.toHaveBeenCalled()
  })

  it('records one successful submission and closes after two seconds', async () => {
    const wrapper = await mountFeedback()
    widgetOptions().onSubmit?.(submission)
    widgetOptions().onSubmit?.(submission)

    expect(emitTelemetryAction).toHaveBeenCalledExactlyOnceWith(
      'comfy.desktop.feedback.submitted',
      {}
    )
    await vi.advanceTimersByTimeAsync(1999)
    expect(wrapper.emitted('close')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('preserves the current response when feedback is opened again while already visible', async () => {
    const wrapper = await mountFeedback()
    await wrapper.setProps({ open: true, hiddenFields: { ...hiddenFields } })
    await flushPromises()
    expect(createWidget).toHaveBeenCalledOnce()
  })

  it('unmounts the closed widget and cancels its pending automatic close', async () => {
    const wrapper = await mountFeedback()
    const options = widgetOptions()
    const widget = vi.mocked(createWidget).mock.results[0]!.value
    options.onSubmit?.(submission)

    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(widget.unmount).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(createWidget).toHaveBeenCalledTimes(2)
    vi.mocked(emitTelemetryAction).mockClear()
    options.onReady?.(ready)
    options.onSubmit?.(submission)
    await flushPromises()
    expect(document.querySelector('.feedback-modal-loading')).not.toBeNull()
    expect(emitTelemetryAction).not.toHaveBeenCalled()

    widgetOptions(1).onSubmit?.(submission)
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('cancels automatic closing when dismissed manually', async () => {
    const wrapper = await mountFeedback()
    widgetOptions().onSubmit?.(submission)
    const closeButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="base-modal-close"]'
    )
    expect(closeButton).not.toBeNull()
    closeButton!.click()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('unmounts the widget and ignores late callbacks when the component is removed', async () => {
    const wrapper = await mountFeedback()
    const options = widgetOptions()
    const widget = vi.mocked(createWidget).mock.results[0]!.value
    options.onSubmit?.(submission)
    wrapper.unmount()
    wrappers.pop()
    vi.mocked(emitTelemetryAction).mockClear()

    options.onSubmit?.(submission)
    await vi.advanceTimersByTimeAsync(2000)
    expect(widget.unmount).toHaveBeenCalledOnce()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(emitTelemetryAction).not.toHaveBeenCalled()
  })

  it('says the form did not load after ten seconds without onReady, and Try again reloads the same form with a fresh wait', async () => {
    await mountFeedback()
    const widget = vi.mocked(createWidget).mock.results[0]!.value

    await vi.advanceTimersByTimeAsync(9999)
    expect(document.querySelector('.feedback-modal-loading')).not.toBeNull()
    expect(document.querySelector('[data-testid="feedback-failed"]')).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(document.querySelector('.feedback-modal-loading')).toBeNull()
    const failed = document.querySelector('[data-testid="feedback-failed"]')
    expect(failed?.textContent).toContain("Feedback form didn't load")
    expect(failed?.textContent).toContain('Check your internet connection, then try again.')

    document.querySelector<HTMLButtonElement>('[data-testid="feedback-retry"]')!.click()
    await flushPromises()
    expect(widget.refresh).toHaveBeenCalledOnce()
    expect(widget.unmount).not.toHaveBeenCalled()
    expect(createWidget).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-testid="feedback-failed"]')).toBeNull()
    expect(document.querySelector('.feedback-modal-loading')).not.toBeNull()

    await vi.advanceTimersByTimeAsync(9999)
    expect(document.querySelector('[data-testid="feedback-failed"]')).toBeNull()
    widgetOptions().onReady?.(ready)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(document.querySelector('.feedback-modal-loading')).toBeNull()
    expect(document.querySelector('[data-testid="feedback-failed"]')).toBeNull()
  })

  it('never shows the failure once the form is ready', async () => {
    await mountFeedback()
    widgetOptions().onReady?.(ready)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(document.querySelector('[data-testid="feedback-failed"]')).toBeNull()
  })
})
