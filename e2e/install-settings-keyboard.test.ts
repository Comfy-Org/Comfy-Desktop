import { test, expect } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launchApp'
import { isPopupVisible, titlePopupPage, waitForWebContents } from './support/cdpPages'

const POPUP = 'comfyTitlePopup.html'
const LIST = '.ui-select-listbox'
const TOOLTIP = '.tooltip-bubble'

test('long dropdown descriptions wrap, and Escape closes one layer at a time @windows @macos @linux', async () => {
  const installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-settings-keyboard-'))
  await mkdir(path.join(installPath, '.launcher'), { recursive: true })
  const ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false, hasSeenCentralPillHint: true },
    installations: [
      {
        id: 'inst-keyboard',
        name: 'Keyboard',
        sourceId: 'standalone',
        installPath,
        status: 'installed',
        seen: true
      }
    ]
  })
  try {
    await ctx.panel.evaluate(
      `window.api.openInstancePicker({ installationId: 'inst-keyboard', initialTab: 'config' })`
    )
    await waitForWebContents(ctx.app, POPUP)
    const popup = titlePopupPage(ctx.app)

    const trigger = 'button.ui-select-trigger[aria-label="Manager Security Level"]'
    await popup.waitForVisible(trigger, { timeout: 15_000 })
    await popup.clickUntilVisible(trigger, LIST, { timeout: 10_000 })
    const overflow = await popup.evaluate<number>(
      `document.querySelector(${JSON.stringify(LIST)}).getBoundingClientRect().right - innerWidth`
    )
    expect(overflow, 'the dropdown ran past the edge of the window').toBeLessThanOrEqual(0)

    await popup.pressKey('Escape')
    await expect.poll(() => popup.exists(LIST)).toBe(false)
    expect(await isPopupVisible(ctx.app, POPUP), 'Escape on a dropdown closed the popup').toBe(true)

    await popup.evaluate(`document.querySelector('.info-tooltip-trigger').focus()`)
    await popup.waitForVisible(TOOLTIP, { timeout: 5_000 })
    await popup.pressKey('Escape')
    await expect.poll(() => popup.exists(TOOLTIP)).toBe(false)
    expect(await isPopupVisible(ctx.app, POPUP), 'Escape on a tooltip closed the popup').toBe(true)

    await popup.pressKey('Escape')
    await expect.poll(() => isPopupVisible(ctx.app, POPUP), { timeout: 5_000 }).toBe(false)
  } finally {
    await ctx.cleanup()
    await rm(installPath, { recursive: true, force: true })
  }
})
