import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import '../assets/main.css'
import { stubWindowApi } from '../lib/stubWindowApi'
import AppRequestModal from './AppRequestModal.vue'

const sendAppRequest = vi.fn<(text: string) => Promise<boolean>>()

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

function thanks(): Element | null {
  return document.querySelector('[data-testid="app-request-thanks"]')
}

function errorLine(): Element | null {
  return document.querySelector('[data-testid="app-request-error"]')
}

async function type(text: string): Promise<void> {
  input().value = text
  input().dispatchEvent(new Event('input'))
  await flushPromises()
}

function pendingSend(): { resolve: (delivered: boolean) => void; reject: (error: Error) => void } {
  let resolve: (delivered: boolean) => void = () => {}
  let reject: (error: Error) => void = () => {}
  sendAppRequest.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
  )
  return { resolve: (delivered) => resolve(delivered), reject: (error) => reject(error) }
}

describe('AppRequestModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    sendAppRequest.mockReset()
    sendAppRequest.mockResolvedValue(true)
    stubWindowApi({ sendAppRequest })
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  it('sends the trimmed request once and thanks the person only after it was accepted', async () => {
    const wrapper = await mountRequest()
    const request = pendingSend()
    await type('  An app that colors line art  ')

    sendButton().click()
    await flushPromises()

    expect(sendAppRequest).toHaveBeenCalledExactlyOnceWith('An app that colors line art')
    expect(thanks()).toBeNull()
    expect(sendButton().disabled).toBe(true)
    expect(sendButton().textContent).toContain('Sending…')
    expect(input().readOnly).toBe(true)

    request.resolve(true)
    await flushPromises()

    expect(thanks()?.textContent).toContain('Thanks. We got your request.')
    expect(document.querySelector('[data-testid="app-request-send"]')).toBeNull()

    vi.advanceTimersByTime(1999)
    expect(wrapper.emitted('close')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps the text and offers another try when the request was not accepted', async () => {
    const wrapper = await mountRequest()
    sendAppRequest.mockResolvedValueOnce(false)
    await type('An app that colors line art')

    sendButton().click()
    await flushPromises()

    expect(thanks()).toBeNull()
    expect(errorLine()?.textContent).toContain("Couldn't send your request. Try again.")
    expect(input().value).toBe('An app that colors line art')
    expect(input().readOnly).toBe(false)
    expect(sendButton().disabled).toBe(false)
    expect(sendButton().textContent?.trim()).toBe('Send')
    vi.advanceTimersByTime(2000)
    expect(wrapper.emitted('close')).toBeUndefined()

    sendButton().click()
    await flushPromises()

    expect(sendAppRequest).toHaveBeenCalledTimes(2)
    expect(errorLine()).toBeNull()
    expect(thanks()?.textContent).toContain('Thanks. We got your request.')
  })

  it('thanks the person in the middle of the window and closes right away from Done', async () => {
    const wrapper = await mountRequest()
    sendAppRequest.mockResolvedValue(true)
    await type('An app that colors line art')
    sendButton().click()
    await flushPromises()

    const body = document.querySelector('.base-modal-body')!.getBoundingClientRect()
    const note = thanks()!.getBoundingClientRect()
    expect(note.top - body.top).toBeCloseTo(body.bottom - note.bottom, 0)
    expect(document.querySelectorAll('.base-modal-footer button')).toHaveLength(1)

    document.querySelector<HTMLButtonElement>('[data-testid="app-request-done"]')!.click()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('treats a failed send call like a request that was not accepted', async () => {
    await mountRequest()
    sendAppRequest.mockRejectedValueOnce(new Error('ipc failed'))
    await type('An app that colors line art')

    sendButton().click()
    await flushPromises()

    expect(thanks()).toBeNull()
    expect(errorLine()?.textContent).toContain("Couldn't send your request. Try again.")
    expect(input().value).toBe('An app that colors line art')
    expect(sendButton().disabled).toBe(false)
  })

  it('sends once when Send is pressed again while the first send is still going', async () => {
    await mountRequest()
    const request = pendingSend()
    await type('An app that colors line art')

    sendButton().click()
    await flushPromises()
    sendButton().click()
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    await flushPromises()

    expect(sendAppRequest).toHaveBeenCalledTimes(1)
    request.resolve(true)
    await flushPromises()
    expect(sendAppRequest).toHaveBeenCalledTimes(1)
  })

  it('shows nothing more when the window was closed before the send finished', async () => {
    const wrapper = await mountRequest()
    const request = pendingSend()
    await type('An app that colors line art')

    sendButton().click()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="base-modal-close"]')!.click()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)

    request.resolve(true)
    await flushPromises()
    vi.advanceTimersByTime(2000)

    expect(thanks()).toBeNull()
    expect(errorLine()).toBeNull()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows nothing when a failed send finishes after the window was closed and opened again', async () => {
    const wrapper = await mountRequest()
    const request = pendingSend()
    await type('An app that colors line art')

    sendButton().click()
    await flushPromises()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    request.resolve(false)
    await flushPromises()

    expect(errorLine()).toBeNull()
    expect(input().value).toBe('')
    expect(sendButton().textContent?.trim()).toBe('Send')
  })

  it('sends with Cmd or Ctrl and Enter', async () => {
    await mountRequest()
    await type('An app that colors line art')

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    await flushPromises()

    expect(sendAppRequest).toHaveBeenCalledTimes(1)
  })

  it('does not send with Ctrl and Enter while an input method is still composing', async () => {
    await mountRequest()
    await type('An app that colors line art')

    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true })
    )
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true })
    )
    await flushPromises()

    expect(sendAppRequest).not.toHaveBeenCalled()
    expect(input()).not.toBeNull()
  })

  it('closes from the round × without sending anything, with Send as the only footer button', async () => {
    const wrapper = await mountRequest()
    await type('An app that colors line art')
    expect(document.querySelectorAll('.base-modal-footer button')).toHaveLength(1)

    document.querySelector<HTMLButtonElement>('[data-testid="base-modal-close"]')!.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(sendAppRequest).not.toHaveBeenCalled()
  })

  it('starts empty each time it opens', async () => {
    const wrapper = await mountRequest()
    await type('An app that colors line art')
    sendButton().click()
    await flushPromises()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(input().value).toBe('')
    expect(sendButton().disabled).toBe(true)
  })

  it('shows an app example beside the form on a wide window, hidden from screen readers, and drops it when narrow', async () => {
    await page.viewport(900, 700)
    await mountRequest()
    const art = document.querySelector('[data-testid="app-request-art"]')!
    const artBox = art.getBoundingClientRect()
    const title = document.querySelector('h2')!.getBoundingClientRect()

    expect(art.getAttribute('aria-hidden')).toBe('true')
    expect(art.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(art.textContent?.trim()).toBe('')
    const card = document.querySelector('.base-modal-panel')!.getBoundingClientRect()
    expect(artBox.width).toBeCloseTo(216, 0)
    expect(artBox.left - card.left).toBeCloseTo(9, 0)
    expect(artBox.top - card.top).toBeCloseTo(9, 0)
    expect(card.bottom - artBox.bottom).toBeCloseTo(9, 0)
    expect(getComputedStyle(art).borderTopLeftRadius).toBe('8px')
    expect(artBox.right).toBeLessThanOrEqual(title.left)
    expect(artBox.top).toBeLessThanOrEqual(title.top)

    await page.viewport(520, 700)
    await expect.poll(() => art.getBoundingClientRect().width).toBe(0)
    expect(input().getBoundingClientRect().width).toBeGreaterThan(0)
    await page.viewport(1280, 800)
  })
})
