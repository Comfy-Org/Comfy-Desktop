import type { ElectronApplication } from '@playwright/test'
import { expect } from '@playwright/test'
import { evalWithRetry } from './evalRetry'

const PAGE_GONE_PATTERN = /webContents (not found|destroyed)/

function isPageGone(err: unknown): boolean {
  return PAGE_GONE_PATTERN.test(err instanceof Error ? err.message : String(err))
}

export function findWebContentsId(
  app: ElectronApplication,
  marker: string
): Promise<number | null> {
  return evalWithRetry(() =>
    app.evaluate(({ BrowserWindow, WebContentsView, webContents }, m) => {
      for (const win of BrowserWindow.getAllWindows()) {
        for (const child of win.contentView.children) {
          if (!(child instanceof WebContentsView) || !child.getVisible()) continue
          if (child.webContents.getURL().includes(m)) return child.webContents.id
        }
      }
      for (const wc of webContents.getAllWebContents()) {
        if (wc.getURL().includes(m)) return wc.id
      }
      return null
    }, marker)
  )
}

export async function waitForWebContents(
  app: ElectronApplication,
  marker: string,
  timeoutMs = 30_000
): Promise<number> {
  let id: number | null = null
  await expect
    .poll(
      async () => {
        id = await findWebContentsId(app, marker)
        return id !== null
      },
      { timeout: timeoutMs, intervals: [250, 500, 1000] }
    )
    .toBe(true)
  return id!
}

export class WebContentsPage {
  constructor(
    private readonly app: ElectronApplication,
    private readonly marker: string
  ) {}

  private async wcEval<T>(expr: string): Promise<T> {
    return this.evaluate<T>(expr)
  }

  async evaluate<T>(expr: string): Promise<T> {
    const id = await findWebContentsId(this.app, this.marker)
    if (id === null) throw new Error(`webContents not found (marker=${this.marker})`)
    return evalWithRetry(() =>
      this.app.evaluate(
        async ({ webContents }, payload) => {
          const wc = webContents.fromId(payload.id)
          if (!wc || wc.isDestroyed()) throw new Error('webContents destroyed')
          return wc.executeJavaScript(payload.expr) as Promise<unknown>
        },
        { id, expr }
      )
    ) as Promise<T>
  }

  url(): Promise<string> {
    return this.wcEval<string>('location.href')
  }

  exists(selector: string): Promise<boolean> {
    return this.wcEval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)
  }

  count(selector: string): Promise<number> {
    return this.wcEval<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  }

  textOf(selector: string): Promise<string | null> {
    return this.wcEval<string | null>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || '').trim() : null })()`
    )
  }

  allText(selector: string): Promise<string[]> {
    return this.wcEval<string[]>(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(el => (el.textContent || '').trim())`
    )
  }

  isVisible(selector: string): Promise<boolean> {
    return this.wcEval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })()`)
  }

  private async sendClick(elementExpression: string): Promise<'clicked' | 'missing' | 'blocked'> {
    const id = await findWebContentsId(this.app, this.marker)
    if (id === null) throw new Error(`webContents not found (marker=${this.marker})`)
    return this.app.evaluate(
      async ({ BrowserWindow, WebContentsView, webContents }, payload) => {
        const wc = webContents.fromId(payload.id)
        if (!wc || wc.isDestroyed()) throw new Error('webContents destroyed')
        const win = BrowserWindow.getAllWindows().find(
          (candidate) =>
            candidate.webContents === wc ||
            candidate.contentView.children.some(
              (child) => child instanceof WebContentsView && child.webContents === wc
            )
        )
        win?.focus()
        wc.focus()
        const point = (await wc.executeJavaScript(`(async () => {
        const deadline = performance.now() + 5000
        for (;;) {
          const el = ${payload.elementExpression}
          if (!el) return 'missing'
          el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
          const rect = el.getBoundingClientRect()
          const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
          const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
          const x = Math.floor((left + right) / 2), y = Math.floor((top + bottom) / 2)
          const hit = document.elementFromPoint(x, y)
          if (right > left && bottom > top && hit && el.contains(hit)) {
            window.__e2eInputHandled = new Promise(resolve => {
              window.addEventListener('mouseup', () => setTimeout(resolve), { capture: true, once: true })
            })
            return { x, y }
          }
          if (performance.now() >= deadline) return 'blocked'
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      })()`)) as { x: number; y: number } | 'missing' | 'blocked'
        if (typeof point === 'string') return point
        wc.sendInputEvent({ type: 'mouseMove', ...point })
        wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
        await Promise.race([
          wc.executeJavaScript('window.__e2eInputHandled').catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
        return 'clicked'
      },
      { id, elementExpression }
    )
  }

  private async clickElement(elementExpression: string): Promise<boolean> {
    const outcome = await this.sendClick(elementExpression)
    if (outcome === 'blocked') {
      throw new Error(
        `click: element is covered or has no interactive area (${elementExpression}, marker=${this.marker})`
      )
    }
    return outcome === 'clicked'
  }

  click(selector: string): Promise<boolean> {
    return this.clickElement(`document.querySelector(${JSON.stringify(selector)})`)
  }

  clickNth(selector: string, index: number): Promise<boolean> {
    return this.clickElement(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]`)
  }

  async fill(selector: string, text: string): Promise<void> {
    await evalWithRetry(async () => {
      const focused = await this.wcEval<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.focus()
        if (typeof el.select === 'function') el.select()
        return document.activeElement === el
      })()`)
      if (!focused)
        throw new Error(`fill: element not focusable (selector=${selector}, marker=${this.marker})`)
      const id = await findWebContentsId(this.app, this.marker)
      if (id === null) throw new Error(`webContents not found (marker=${this.marker})`)
      await this.app.evaluate(
        async ({ webContents }, payload) => {
          const wc = webContents.fromId(payload.id)
          if (!wc || wc.isDestroyed()) throw new Error('webContents destroyed')
          await wc.insertText(payload.text)
        },
        { id, text }
      )
      const value = await this.wcEval<string | null>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        return el && 'value' in el ? el.value : null
      })()`)
      if (value !== text) {
        throw new Error(
          `fill: value mismatch after insertText (expected ${JSON.stringify(text)}, got ${JSON.stringify(value)})`
        )
      }
    })
  }

  clickByText(selector: string, textSubstring: string): Promise<boolean> {
    return this.clickElement(`(() => {
      const needle = ${JSON.stringify(textSubstring.toLowerCase())}
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      return els.find(el => (el.textContent || '').toLowerCase().includes(needle))
    })()`)
  }

  async pressKey(key: string): Promise<void> {
    const id = await findWebContentsId(this.app, this.marker)
    if (id === null) throw new Error(`webContents not found (marker=${this.marker})`)
    const aliases: Record<string, string> = {
      ArrowDown: 'Down',
      ArrowUp: 'Up',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ' ': 'Space'
    }
    const keyCode = aliases[key] ?? key
    await this.app.evaluate(
      async ({ webContents }, payload) => {
        const wc = webContents.fromId(payload.id)
        if (!wc || wc.isDestroyed()) throw new Error('webContents destroyed')
        wc.focus()
        await wc.executeJavaScript(`void (window.__e2eInputHandled = new Promise(resolve => {
        window.addEventListener('keydown', () => setTimeout(resolve), { capture: true, once: true })
      }))`)
        wc.sendInputEvent({ type: 'keyDown', keyCode: payload.keyCode })
        wc.sendInputEvent({ type: 'keyUp', keyCode: payload.keyCode })
        await Promise.race([
          wc.executeJavaScript('window.__e2eInputHandled').catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
      },
      { id, keyCode }
    )
  }

  async waitFor(
    pred: () => Promise<boolean> | boolean,
    opts: { timeout?: number; message?: string } = {}
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          try {
            return await pred()
          } catch (err) {
            if (isPageGone(err)) return false
            throw err
          }
        },
        {
          timeout: opts.timeout ?? 15_000,
          intervals: [200, 400, 800],
          message: opts.message
        }
      )
      .toBe(true)
  }

  waitForSelector(selector: string, opts: { timeout?: number } = {}): Promise<void> {
    return this.waitFor(() => this.exists(selector), {
      timeout: opts.timeout,
      message: `selector ${selector} did not appear`
    })
  }

  waitForVisible(selector: string, opts: { timeout?: number } = {}): Promise<void> {
    return this.waitFor(() => this.isVisible(selector), {
      timeout: opts.timeout,
      message: `selector ${selector} did not become visible`
    })
  }

  async clickUntilVisible(
    trigger: string,
    result: string,
    opts: { timeout?: number } = {}
  ): Promise<void> {
    const deadline = Date.now() + (opts.timeout ?? 30_000)
    for (;;) {
      const state = await this.wcEval<'missing' | 'open' | 'closed'>(`(() => {
        const t = document.querySelector(${JSON.stringify(trigger)})
        if (!t) return 'missing'
        const expanded = t.getAttribute('aria-expanded')
        if (expanded !== null) return expanded === 'true' ? 'open' : 'closed'
        return document.querySelector(${JSON.stringify(result)}) ? 'open' : 'closed'
      })()`)
      if (state === 'missing') {
        throw new Error(`clickUntilVisible: trigger ${trigger} not found`)
      }
      if (state === 'closed')
        await this.sendClick(`document.querySelector(${JSON.stringify(trigger)})`)
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `clickUntilVisible: ${result} did not become visible after clicking ${trigger}`
        )
      }
      try {
        await this.waitForVisible(result, { timeout: Math.min(2_000, remaining) })
        return
      } catch {}
    }
  }

  async selectOption(
    trigger: string,
    optionLabel: string,
    opts: { timeout?: number } = {}
  ): Promise<void> {
    const deadline = Date.now() + (opts.timeout ?? 15_000)
    for (;;) {
      if ((await this.textOf(trigger))?.trim() === optionLabel) return
      const state = await this.wcEval<'missing' | 'open' | 'closed'>(`(() => {
        const t = document.querySelector(${JSON.stringify(trigger)})
        if (!t) return 'missing'
        return t.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed'
      })()`)
      if (state === 'missing') {
        throw new Error(`selectOption: trigger ${trigger} not found`)
      }
      if (state === 'closed') {
        await this.sendClick(`document.querySelector(${JSON.stringify(trigger)})`)
      } else {
        await this.sendClick(`(() => {
          const trigger = document.querySelector(${JSON.stringify(trigger)})
          const listbox = document.getElementById(trigger?.getAttribute('aria-controls') || '')
          return Array.from(listbox?.querySelectorAll('[role="option"]') || []).find(option =>
            option.querySelector('.ui-select-option-label')?.textContent.trim() === ${JSON.stringify(optionLabel)})
        })()`)
      }
      if (Date.now() > deadline) {
        throw new Error(`selectOption: "${optionLabel}" did not land on ${trigger}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
}

export function panelPage(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'panel.html')
}

export function titleBarPage(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleBar.html')
}

export function titlePopupPage(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitlePopup.html')
}

export function systemModalPage(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfySystemModal.html')
}

export function isPopupVisible(app: ElectronApplication, marker: string): Promise<boolean> {
  return evalWithRetry(() =>
    app.evaluate(({ BrowserWindow, WebContentsView }, m) => {
      for (const win of BrowserWindow.getAllWindows()) {
        for (const child of win.contentView.children) {
          if (!(child instanceof WebContentsView)) continue
          if (!child.webContents.getURL().includes(m)) continue
          if (!child.getVisible()) return false
          const b = child.getBounds()
          return b.width > 0 && b.height > 0
        }
      }
      return false
    }, marker)
  ).catch(() => false)
}

export async function closeTitlePopupIfOpen(app: ElectronApplication): Promise<void> {
  const id = await findWebContentsId(app, 'comfyTitlePopup.html')
  if (id === null) return
  if (!(await isPopupVisible(app, 'comfyTitlePopup.html'))) return
  await evalWithRetry(() =>
    app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitlePopup.html'))
      if (!wc) return
      return wc.executeJavaScript(`(window).__comfyTitlePopup.close()`)
    })
  ).catch(() => {})
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 3_000,
      intervals: [100, 200]
    })
    .toBe(false)
}

export const TITLE_REOPEN_SUPPRESSION_MS = 300
