import { expect, test } from '@playwright/test'
import { launchApp } from './launchApp'
import { openDesktopSettings } from './support/chooserHelpers'
import { isPopupVisible } from './support/cdpPages'

test('the WebContents facade drives shared selects and tabs with native input @windows @macos @linux', async () => {
  const ctx = await launchApp({
    settings: { firstUseCompleted: true, language: 'en' }
  })
  try {
    const popup = await openDesktopSettings(ctx.app, ctx.panel)

    const trigger = '[data-field-id="language"] [role="combobox"]'
    await popup.waitForVisible(trigger)
    await popup.evaluate(`(() => {
      window.__inputEvents = []
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        document.addEventListener(type, event => {
          window.__inputEvents.push({ type: event.type, trusted: event.isTrusted })
        }, { capture: true })
      }
    })()`)
    expect(await popup.click(trigger)).toBe(true)
    await popup.waitForVisible('[role="listbox"]')
    await expect
      .poll(() => popup.evaluate('window.__inputEvents'))
      .toEqual([
        { type: 'pointerdown', trusted: true },
        { type: 'mousedown', trusted: true },
        { type: 'pointerup', trusted: true },
        { type: 'mouseup', trusted: true },
        { type: 'click', trusted: true }
      ])
    expect(await popup.clickByText('[role="listbox"] [role="option"]', '简体中文')).toBe(true)
    await expect.poll(() => ctx.panel.evaluate("window.api.getSetting('language')")).toBe('zh')

    await expect
      .poll(() =>
        popup.evaluate(
          `document.activeElement === document.querySelector(${JSON.stringify(trigger)})`
        )
      )
      .toBe(true)
    await popup.pressKey('Enter')
    await popup.waitForVisible('[role="listbox"]')
    await popup.pressKey('Escape')
    await expect.poll(() => popup.exists('[role="listbox"]')).toBe(false)
    expect(await isPopupVisible(ctx.app, 'comfyTitlePopup.html')).toBe(true)
    await popup.selectOption(trigger, 'English')
    await expect.poll(() => ctx.panel.evaluate("window.api.getSetting('language')")).toBe('en')

    expect(await popup.clickNth('[role="tab"]', 2)).toBe(true)
    await expect.poll(() => popup.textOf('[role="tab"][aria-selected="true"]')).toBe('Folders')
    await popup.pressKey('Home')
    await expect
      .poll(() =>
        popup.evaluate('document.querySelector(\'[role="tab"]\').getAttribute("aria-selected")')
      )
      .toBe('true')
    await popup.pressKey('ArrowDown')
    await expect.poll(() => popup.textOf('[role="tab"][aria-selected="true"]')).toBe('Updates')
  } finally {
    await ctx.cleanup()
  }
})
