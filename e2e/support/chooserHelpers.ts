import { expect, type ElectronApplication } from '@playwright/test'
import { isPopupVisible, titlePopupPage, waitForWebContents, type WebContentsPage } from './cdpPages'
import { byTestId, TID } from './testIds'

/** Assert that the chooser body is visible in the panel. */
export async function expectChooserVisible(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('.chooser-view')
}

/** Click the New Install tile. */
export async function clickNewInstallTile(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('.chooser-tile-new')
  const ok = await panel.click('.chooser-tile-new')
  expect(ok, 'New install tile click dispatched').toBe(true)
}

/**
 * Click an installed-card tile by display name (case-insensitive substring).
 * Excludes New Install and Cloud tiles. Polls for the tile's named presence
 * because the chooser store hydrates asynchronously after remount, so
 * `.chooser-view` is up before any tiles exist.
 */
export async function clickInstallTile(panel: WebContentsPage, nameSubstring: string): Promise<void> {
  const selector = '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name'
  const needle = nameSubstring.toLowerCase()
  await panel.waitFor(
    async () => {
      const texts = await panel.allText(selector)
      return texts.some((t) => t.toLowerCase().includes(needle))
    },
    { timeout: 15_000, message: `Install tile matching "${nameSubstring}" never appeared in chooser` },
  )
  const ok = await panel.clickByText(selector, nameSubstring)
  expect(ok, `Install tile matching "${nameSubstring}" clicked`).toBe(true)
}

/** Click the title-bar waffle/menu button that opens the file menu popup. */
export async function openTitleMenu(titleBar: WebContentsPage): Promise<void> {
  await titleBar.waitForVisible('.title-menu-button--icon')
  const ok = await titleBar.click('.title-menu-button--icon')
  expect(ok, 'Title menu button click dispatched').toBe(true)
}

/** Click the title-bar downloads tray icon that opens the downloads popup. */
export async function openDownloadsTray(titleBar: WebContentsPage): Promise<void> {
  await titleBar.waitForVisible('.title-downloads-tray')
  const ok = await titleBar.click('.title-downloads-tray')
  expect(ok, 'Downloads tray button click dispatched').toBe(true)
}

/**
 * Open the instance picker for a dashboard install through the real UI:
 * tile kebab -> context-menu "Manage" -> (optionally) a picker settings
 * tab click. Returns the popup facade once the picker is visible.
 *
 * This is the lifecycle-grade replacement for calling
 * `window.api.openInstancePicker()` directly, which bypasses the dashboard
 * entry control - a broken kebab or Manage item must fail the test.
 */
export async function openManageViaDashboard(
  app: ElectronApplication,
  panel: WebContentsPage,
  installationId: string,
  tabKey?: string,
): Promise<WebContentsPage> {
  await panel.waitForVisible(byTestId(TID.dashboardTileKebab(installationId)), { timeout: 15_000 })
  expect(await panel.click(byTestId(TID.dashboardTileKebab(installationId))), 'dashboard tile kebab clicked').toBe(true)
  await panel.waitForVisible(byTestId(TID.contextMenuItem('manage')), { timeout: 5_000 })
  expect(await panel.click(byTestId(TID.contextMenuItem('manage'))), 'Manage context-menu item clicked').toBe(true)
  await waitForWebContents(app, 'comfyTitlePopup.html')
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), { timeout: 15_000, intervals: [100, 250] })
    .toBe(true)
  const popup = titlePopupPage(app)
  if (tabKey) {
    await popup.waitForVisible(byTestId(TID.settingsTab(tabKey)), { timeout: 15_000 })
    expect(await popup.click(byTestId(TID.settingsTab(tabKey))), `picker ${tabKey} tab clicked`).toBe(true)
  }
  return popup
}

/**
 * Open the instance picker from a running install host through the real
 * UI: the interactive title-bar install pill (and optionally a picker
 * settings tab). Returns the popup facade once the picker is visible.
 */
export async function openPickerViaTitlePill(
  app: ElectronApplication,
  titleBar: WebContentsPage,
  tabKey?: string,
): Promise<WebContentsPage> {
  // A pill click on an already-open popup toggles it closed; fail fast
  // with a clear message instead of timing out on the visibility poll.
  if (await isPopupVisible(app, 'comfyTitlePopup.html')) {
    throw new Error('openPickerViaTitlePill: picker popup is already open - close it before re-entering via the pill')
  }
  await titleBar.waitForVisible('.title-install-pill.is-interactive', { timeout: 15_000 })
  expect(await titleBar.click('.title-install-pill.is-interactive'), 'title-bar install pill clicked').toBe(true)
  await waitForWebContents(app, 'comfyTitlePopup.html')
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), { timeout: 15_000, intervals: [100, 250] })
    .toBe(true)
  const popup = titlePopupPage(app)
  if (tabKey) {
    await popup.waitForVisible(byTestId(TID.settingsTab(tabKey)), { timeout: 15_000 })
    expect(await popup.click(byTestId(TID.settingsTab(tabKey))), `picker ${tabKey} tab clicked`).toBe(true)
  }
  return popup
}

/** Wait for any flow takeover to be visible inside the panel body. */
export async function expectTakeoverOpen(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('.brand-takeover-root', { timeout: 10_000 })
}

/** Dispatch Escape to dismiss the active overlay. */
export async function dismissOverlay(panel: WebContentsPage): Promise<void> {
  await panel.pressKey('Escape')
}
