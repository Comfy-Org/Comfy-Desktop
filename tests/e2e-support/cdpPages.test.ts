// @vitest-environment node
import type { ElectronApplication } from '@playwright/test'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateWebContents, WebContentsPage } from '../../e2e/support/cdpPages'
import { isHoverActive } from '../../e2e/support/hoverGate'

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
    webContents: {
      getAllWebContents: () => [wc],
      fromId: (id: number) => (id === wc.id ? wc : undefined)
    }
  }
  const app = {
    evaluate: vi.fn(
      async (fn: (api: typeof electron, payload: unknown) => unknown, payload: unknown) =>
        fn(electron, payload)
    )
  } as unknown as ElectronApplication
  return { app, wc, page: new WebContentsPage(app, 'panel.html'), executeJavaScript, insertText }
}

async function finishAssertion(assertion: Promise<void>): Promise<void> {
  // Attach the rejection handler before advancing timers so failing controls
  // report their assertion without also becoming unhandled rejections.
  const result = assertion.then(
    () => ({ error: null }),
    (error: unknown) => ({ error })
  )
  await vi.runAllTimersAsync()
  const { error } = await result
  if (error) throw error
}

describe('WebContentsPage evaluation recovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('recovers a read-only DOM query when the result is lost', async () => {
    const { page, executeJavaScript } = harness()
    executeJavaScript.mockRejectedValueOnce(lostResult)
    const result = page.exists('.chooser-tile')
    const assertion = expect(result).resolves.toBe(true)
    await finishAssertion(assertion)
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('recovers an explicitly read-only evaluate call', async () => {
    const { page, executeJavaScript } = harness()
    executeJavaScript.mockRejectedValueOnce(lostResult).mockResolvedValue('label')
    const assertion = expect(page.evaluate('document.title', { readOnly: true })).resolves.toBe(
      'label'
    )
    await finishAssertion(assertion)
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('preserves recovery in the hover-gate polling predicate', async () => {
    const { page, executeJavaScript } = harness()
    executeJavaScript.mockRejectedValueOnce(lostResult)
    const assertion = expect(isHoverActive(page)).resolves.toBe(true)
    await finishAssertion(assertion)
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('re-resolves the webContents id after a read loses its context', async () => {
    const { page, wc, executeJavaScript } = harness()
    executeJavaScript.mockImplementationOnce(async () => {
      wc.id = 2
      throw lostResult
    })
    const assertion = expect(page.exists('.chooser-tile')).resolves.toBe(true)
    await finishAssertion(assertion)
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('does not replay an expression addressed directly by webContents id', async () => {
    const { app, executeJavaScript } = harness()
    executeJavaScript.mockRejectedValue(lostResult)
    const assertion = expect(
      evaluateWebContents(app, 1, "fetch('/prompt', { method: 'POST' })")
    ).rejects.toBe(lostResult)
    await finishAssertion(assertion)
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
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
    await finishAssertion(assertion)
    expect(dispatched).toBe(1)
  })

  it('does not repeat text input after dispatch when its result is lost', async () => {
    const { page, insertText } = harness()
    insertText.mockRejectedValue(lostResult)
    const result = page.fill('input', 'value')
    const assertion = expect(result).rejects.toBe(lostResult)
    await finishAssertion(assertion)
    expect(insertText).toHaveBeenCalledExactlyOnceWith('value')
  })

  it('recovers a lost focus result by checking focus without repeating it', async () => {
    const { page, executeJavaScript, insertText } = harness()
    executeJavaScript
      .mockRejectedValueOnce(lostResult)
      .mockResolvedValueOnce(true)
      .mockResolvedValue('value')
    const assertion = expect(page.fill('input', 'value')).resolves.toBeUndefined()
    await finishAssertion(assertion)
    expect(
      executeJavaScript.mock.calls.filter(([expr]) => expr.includes('el.focus()'))
    ).toHaveLength(1)
    expect(insertText).toHaveBeenCalledExactlyOnceWith('value')
  })

  it('does not insert text if a lost focus result leaves the input unready', async () => {
    const { page, executeJavaScript, insertText } = harness()
    executeJavaScript.mockRejectedValueOnce(lostResult).mockResolvedValue(false)
    const assertion = expect(page.fill('input', 'value')).rejects.toBe(lostResult)
    await finishAssertion(assertion)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('accepts a completed input after its result is lost without inserting again', async () => {
    const { page, executeJavaScript, insertText } = harness()
    executeJavaScript.mockResolvedValueOnce(true).mockResolvedValue('value')
    insertText.mockRejectedValue(lostResult)
    const assertion = expect(page.fill('input', 'value')).resolves.toBeUndefined()
    await finishAssertion(assertion)
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
    await finishAssertion(assertion)
    expect(insertText).toHaveBeenCalledExactlyOnceWith('value')
    expect(executeJavaScript).toHaveBeenCalledTimes(3)
  })
})

function toggleHarness(lostClick: 'toggle' | 'option', error = lostResult) {
  const { page, executeJavaScript } = harness()
  let expanded = false
  let selected = 'Initial'
  const trigger = {
    get textContent() {
      return selected
    },
    getAttribute: () => String(expanded),
    click: vi.fn(() => {
      expanded = !expanded
    })
  }
  const result = { getBoundingClientRect: () => ({ width: 100, height: 50 }) }
  const option = {
    textContent: 'Chosen',
    click: vi.fn(() => {
      selected = 'Chosen'
      expanded = false
    })
  }
  let loseResult = true
  executeJavaScript.mockImplementation(async (expr) => {
    const value = runInNewContext(expr, {
      document: {
        querySelector: (selector: string) =>
          selector === '#trigger' ? trigger : expanded ? result : null,
        querySelectorAll: () => (expanded ? [option] : [])
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    })
    const clicked =
      lostClick === 'toggle' ? expr.includes('el.click()') : expr.includes('match.click()')
    if (clicked && loseResult) {
      loseResult = false
      throw error
    }
    return value
  })
  return { page, trigger, option }
}

describe('WebContentsPage state-based action recovery', () => {
  it.each(['Execution context was destroyed', 'Resulting promise was garbage collected.'])(
    'observes an opened toggle after a lost click result: %s',
    async (message) => {
      const { page, trigger } = toggleHarness('toggle', new Error(message))
      await page.clickUntilVisible('#trigger', '#result')
      expect(trigger.click).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['toggle', 'option'] as const)(
    'observes selection after the %s click loses its result',
    async (lostClick) => {
      const { page, trigger, option } = toggleHarness(lostClick)
      await page.selectOption('#trigger', 'Chosen')
      expect(trigger.click).toHaveBeenCalledTimes(1)
      expect(option.click).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['toggle', 'option'] as const)(
    'propagates an unrelated %s click failure',
    async (lostClick) => {
      const error = new Error('click handler failed')
      const { page } = toggleHarness(lostClick, error)
      await expect(page.selectOption('#trigger', 'Chosen')).rejects.toBe(error)
    }
  )
})
