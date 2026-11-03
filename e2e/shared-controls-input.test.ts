import { expect, test } from '@playwright/test'
import { launchApp } from './launchApp'
import { openTitleMenu } from './support/chooserHelpers'
import { isPopupVisible, titlePopupPage } from './support/cdpPages'

test('the WebContents facade drives shared selects and tabs with native input @windows @macos @linux', async () => {
  const ctx = await launchApp({
    settings: { firstUseCompleted: true, language: 'en', autoLaunchOnStartup: 'none' }
  })
  try {
    const popup = titlePopupPage(ctx.app)
    await openTitleMenu(ctx.titleBar)
    await popup.waitForVisible('[role="menuitem"]')
    expect(await popup.clickByText('[role="menuitem"]', 'Desktop Settings')).toBe(true)

    const trigger = '[data-field-id="autoLaunchOnStartup"] [role="combobox"]'
    await popup.waitForVisible(trigger)
    // Observe the browser's events without driving component state from the test.
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
    await expect.poll(() => popup.evaluate('window.__inputEvents')).toEqual([
      { type: 'pointerdown', trusted: true },
      { type: 'mousedown', trusted: true },
      { type: 'pointerup', trusted: true },
      { type: 'mouseup', trusted: true },
      { type: 'click', trusted: true }
    ])
    expect(await popup.clickByText('[role="listbox"] [role="option"]', 'Last used instance')).toBe(true)
    await expect.poll(() => ctx.panel.evaluate("window.api.getSetting('autoLaunchOnStartup')")).toBe('last')

    // Select dismissal must return focus, allowing a real key to reopen it.
    await expect.poll(() => popup.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(trigger)})`)).toBe(true)
    await popup.pressKey('Enter')
    await popup.waitForVisible('[role="listbox"]')
    await popup.pressKey('Escape')
    await expect.poll(() => popup.exists('[role="listbox"]')).toBe(false)
    expect(await isPopupVisible(ctx.app, 'comfyTitlePopup.html')).toBe(true)
    await popup.selectOption(trigger, 'None (show dashboard)')
    await expect.poll(() => ctx.panel.evaluate("window.api.getSetting('autoLaunchOnStartup')")).toBe('none')

    // Shared tabs respond to pointer-down and focused keyboard navigation.
    expect(await popup.clickNth('[role="tab"]', 2)).toBe(true)
    await expect.poll(() => popup.textOf('[role="tab"][aria-selected="true"]')).toBe('Storage')
    await popup.pressKey('Home')
    await expect.poll(() => popup.evaluate('document.querySelector(\'[role="tab"]\').getAttribute("aria-selected")')).toBe('true')
    await popup.pressKey('ArrowDown')
    await expect.poll(() => popup.textOf('[role="tab"][aria-selected="true"]')).toBe('Updates')
  } finally {
    await ctx.cleanup()
  }
})
