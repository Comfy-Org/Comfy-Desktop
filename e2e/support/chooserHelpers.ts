import { expect, type ElectronApplication } from '@playwright/test'
import {
  isPopupVisible,
  titlePopupPage,
  waitForWebContents,
  type WebContentsPage
} from './cdpPages'
import { byTestId, TID } from './testIds'

const HOME_VIEW = '[data-testid="home-view"]'
const SIDEBAR_BUILDS = '[data-testid="app-sidebar-chooser"]'

export async function showBuildsPage(panel: WebContentsPage): Promise<void> {
  expect(await panel.click(SIDEBAR_BUILDS), 'Builds picked in the sidebar').toBe(true)
  await panel.waitForVisible('.chooser-view')
}

export async function expectChooserVisible(panel: WebContentsPage): Promise<void> {
  await panel.waitFor(
    async () => (await panel.isVisible('.chooser-view')) || (await panel.isVisible(HOME_VIEW))
  )
  if (await panel.isVisible(HOME_VIEW)) await showBuildsPage(panel)
  await panel.waitForVisible('.chooser-view')
}

export async function clickNewInstallTile(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('.chooser-tile-new')
  const ok = await panel.click('.chooser-tile-new')
  expect(ok, 'New install tile click dispatched').toBe(true)
}

export async function clickInstallTile(
  panel: WebContentsPage,
  nameSubstring: string
): Promise<void> {
  const selector =
    '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name'
  const needle = nameSubstring.toLowerCase()
  await panel.waitFor(
    async () => {
      const texts = await panel.allText(selector)
      return texts.some((t) => t.toLowerCase().includes(needle))
    },
    {
      timeout: 15_000,
      message: `Install tile matching "${nameSubstring}" never appeared in chooser`
    }
  )
  const launched = await panel.evaluate<boolean>(`(() => {
    const needle = ${JSON.stringify(needle)}
    const tile = [...document.querySelectorAll('.chooser-tile')].find((candidate) =>
      candidate.querySelector('.chooser-tile-name')?.textContent?.toLowerCase().includes(needle),
    )
    const launch = tile?.querySelector('.chooser-tile-launch')
    if (!launch) return false
    launch.click()
    return true
  })()`)
  expect(launched, `Install tile matching "${nameSubstring}" launched`).toBe(true)
}

export async function openTitleMenu(titleBar: WebContentsPage): Promise<void> {
  await titleBar.waitForVisible('.title-menu-button--icon[aria-haspopup="menu"]')
  const ok = await titleBar.click('.title-menu-button--icon[aria-haspopup="menu"]')
  expect(ok, 'Title menu button click dispatched').toBe(true)
}

export async function openDesktopSettings(
  app: ElectronApplication,
  panel: WebContentsPage
): Promise<WebContentsPage> {
  const selector = '[data-testid="app-sidebar-settings"]'
  await panel.waitForVisible(selector)
  expect(await panel.click(selector), 'Desktop Settings clicked in the sidebar').toBe(true)
  const popup = titlePopupPage(app)
  await popup.waitForVisible('.global-settings', { timeout: 10_000 })
  return popup
}

export async function pickFromTitleMenu(
  app: ElectronApplication,
  titleBar: WebContentsPage,
  label: string
): Promise<void> {
  await waitForWebContents(app, 'comfyTitlePopup.html', 10_000)
  await openTitleMenu(titleBar)
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
  const picked = await titlePopupPage(app).clickByText('li.item', label)
  expect(picked, `${label} picked from the title menu`).toBe(true)
}

export async function openDownloadsTray(titleBar: WebContentsPage): Promise<void> {
  await titleBar.waitForVisible('.title-downloads-tray')
  const ok = await titleBar.click('.title-downloads-tray')
  expect(ok, 'Downloads tray button click dispatched').toBe(true)
}

export async function openManageViaDashboard(
  app: ElectronApplication,
  panel: WebContentsPage,
  installationId: string,
  tabKey?: string
): Promise<WebContentsPage> {
  await expectChooserVisible(panel)
  await panel.waitForVisible(byTestId(TID.dashboardTile(installationId)), { timeout: 15_000 })
  await panel.evaluate<void>(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(installationId)} })`
  )
  await waitForWebContents(app, 'comfyTitlePopup.html')
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 15_000,
      intervals: [100, 250]
    })
    .toBe(true)
  const popup = titlePopupPage(app)
  if (tabKey) {
    await popup.waitForVisible(byTestId(TID.settingsTab(tabKey)), { timeout: 15_000 })
    expect(
      await popup.click(byTestId(TID.settingsTab(tabKey))),
      `picker ${tabKey} tab clicked`
    ).toBe(true)
  }
  return popup
}

export async function openPickerViaTitlePill(
  app: ElectronApplication,
  titleBar: WebContentsPage,
  tabKey?: string
): Promise<WebContentsPage> {
  if (await isPopupVisible(app, 'comfyTitlePopup.html')) {
    throw new Error(
      'openPickerViaTitlePill: picker popup is already open - close it before re-entering via the pill'
    )
  }
  await titleBar.waitForVisible('.title-install-pill.is-interactive', { timeout: 15_000 })
  expect(
    await titleBar.click('.title-install-pill.is-interactive'),
    'title-bar install pill clicked'
  ).toBe(true)
  await waitForWebContents(app, 'comfyTitlePopup.html')
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 15_000,
      intervals: [100, 250]
    })
    .toBe(true)
  const popup = titlePopupPage(app)
  if (tabKey) {
    await popup.waitForVisible(byTestId(TID.settingsTab(tabKey)), { timeout: 15_000 })
    expect(
      await popup.click(byTestId(TID.settingsTab(tabKey))),
      `picker ${tabKey} tab clicked`
    ).toBe(true)
  }
  return popup
}

export async function expectTakeoverOpen(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('.brand-takeover-root', { timeout: 10_000 })
}

export async function expectNewBuildModalOpen(panel: WebContentsPage): Promise<void> {
  await panel.waitForVisible('[data-testid="new-build-modal"]', { timeout: 10_000 })
}

export async function openNewBuildChangeSetup(panel: WebContentsPage): Promise<void> {
  await panel.waitForSelector('[data-testid="config-change-setup"]:not([disabled])', {
    timeout: 15_000
  })
  expect(await panel.click('[data-testid="config-change-setup"]'), 'Change setup clicked').toBe(
    true
  )
  await panel.waitForVisible('[data-testid="config-change-form"]', { timeout: 5_000 })
}

export async function dismissOverlay(panel: WebContentsPage): Promise<void> {
  await panel.pressKey('Escape')
}

export const SOURCE_DROPDOWN = '[data-testid="install-source-tabs"]'
export const HARDWARE_DROPDOWN = '[data-testid="config-select-variant"]'
export const WHERE_IT_IS_DROPDOWN = '[data-testid="existing-comfy-tabs"]'

export async function openSetupDropdown(panel: WebContentsPage, trigger: string): Promise<void> {
  await panel.waitForVisible(`${trigger}:not([disabled])`, { timeout: 15_000 })
  expect(await panel.click(trigger), `${trigger} opened`).toBe(true)
  await panel.waitForVisible('[role="listbox"] [role="option"]', { timeout: 5_000 })
}

export async function closeSetupDropdown(panel: WebContentsPage): Promise<void> {
  await panel.pressKey('Escape')
  await panel.waitFor(async () => !(await panel.isVisible('[role="listbox"]')), {
    timeout: 5_000,
    message: 'the dropdown did not close'
  })
}

export async function setupDropdownOffers(
  panel: WebContentsPage,
  trigger: string,
  option: string
): Promise<boolean> {
  await openSetupDropdown(panel, trigger)
  const offered = await panel.exists(`[role="listbox"] ${option}`)
  await closeSetupDropdown(panel)
  return offered
}

export async function pickFromSetupDropdown(
  panel: WebContentsPage,
  trigger: string,
  option: string
): Promise<boolean> {
  await openSetupDropdown(panel, trigger)
  const picked = await panel.click(`[role="listbox"] ${option}`)
  await panel.waitFor(async () => !(await panel.isVisible('[role="listbox"]')), {
    timeout: 5_000,
    message: 'the dropdown did not close after a pick'
  })
  return picked
}

export async function pickFromSetupDropdownByText(
  panel: WebContentsPage,
  trigger: string,
  text: string
): Promise<boolean> {
  await openSetupDropdown(panel, trigger)
  const picked = await panel.clickByText('[role="listbox"] [role="option"]', text)
  await panel.waitFor(async () => !(await panel.isVisible('[role="listbox"]')), {
    timeout: 5_000,
    message: 'the dropdown did not close after a pick'
  })
  return picked
}

export function setupDropdownValue(panel: WebContentsPage, trigger: string): Promise<string> {
  return panel.evaluate<string>(
    `document.querySelector(${JSON.stringify(`${trigger} .ui-select-label`)})?.textContent?.trim() ?? ''`
  )
}
