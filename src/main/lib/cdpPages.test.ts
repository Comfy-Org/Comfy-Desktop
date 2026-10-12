// @vitest-environment node
import type { ElectronApplication } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebContentsPage } from '../../../e2e/support/cdpPages'

const lostResult = new Error('Resulting promise was garbage collected.')

function harness() {
  const executeJavaScript = vi.fn<(expr: string) => Promise<unknown>>().mockResolvedValue(true)
  const insertText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const wc = {
    id: 1,
    getURL: () => 'http://localhost/panel.html',
    isDestroyed: () => false,
    executeJavaScript,
    insertText
  }
  const electron = {
    BrowserWindow: { getAllWindows: () => [] },
    WebContentsView: class {},
    webContents: { getAllWebContents: () => [wc], fromId: () => wc }
  }
  const app = {
    evaluate: vi.fn(
      async (fn: (api: typeof electron, payload: unknown) => unknown, payload: unknown) =>
        fn(electron, payload)
    )
  } as unknown as ElectronApplication
  return { page: new WebContentsPage(app, 'panel.html'), executeJavaScript, insertText }
}

describe('WebContentsPage evaluation recovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('recovers a read-only DOM query when the result is lost', async () => {
    const { page, executeJavaScript } = harness()
    executeJavaScript.mockRejectedValueOnce(lostResult)
    const result = page.exists('.chooser-tile')
    const assertion = expect(result).resolves.toBe(true)
    await vi.runAllTimersAsync()
    await assertion
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['arbitrary evaluation', (page: WebContentsPage) => page.evaluate('window.api.launch()')],
    ['click', (page: WebContentsPage) => page.click('.chooser-tile')],
    ['indexed click', (page: WebContentsPage) => page.clickNth('.chooser-tile', 0)],
    ['text click', (page: WebContentsPage) => page.clickByText('.chooser-tile', 'Cloud')],
    ['key press', (page: WebContentsPage) => page.pressKey('Enter')]
  ])('does not repeat %s after dispatch when its result is lost', async (_name, action) => {
    const { page, executeJavaScript } = harness()
    let dispatched = 0
    executeJavaScript.mockImplementation(async () => {
      dispatched++
      throw lostResult
    })
    const result = action(page)
    const assertion = expect(result).rejects.toBe(lostResult)
    await vi.runAllTimersAsync()
    await assertion
    expect(dispatched).toBe(1)
  })

  it('does not repeat text input after dispatch when its result is lost', async () => {
    const { page, insertText } = harness()
    insertText.mockRejectedValue(lostResult)
    const result = page.fill('input', 'value')
    const assertion = expect(result).rejects.toBe(lostResult)
    await vi.runAllTimersAsync()
    await assertion
    expect(insertText).toHaveBeenCalledExactlyOnceWith('value')
  })

  it('recovers the final value read without repeating text input', async () => {
    const { page, executeJavaScript, insertText } = harness()
    executeJavaScript
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(lostResult)
      .mockResolvedValue('value')
    const result = page.fill('input', 'value')
    const assertion = expect(result).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    await assertion
    expect(insertText).toHaveBeenCalledExactlyOnceWith('value')
    expect(executeJavaScript).toHaveBeenCalledTimes(3)
  })
})
