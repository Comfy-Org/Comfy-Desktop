/**
 * Shared pieces of the beta-args pill specs: selectors, opening an install's Startup Arguments in
 * the picker, and reading the pill's absence only once its answer has arrived.
 */

import { expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import {
  closeTitlePopupIfOpen,
  findWebContentsId,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents,
  type WebContentsPage
} from './cdpPages'
import { byTestId, TID } from './testIds'

export const ARGS_FIELD = '[data-field-id="launchArgs"]'
export const PILL = `${ARGS_FIELD} .beta-args button`
const PILL_LOADING = `${ARGS_FIELD} .beta-args-loading`
/** Always rendered, carrying the number of answers the pill has applied. */
const PILL_SLOT = `${ARGS_FIELD} .beta-args-slot`
/** Teleported to <body>, so not under the field. */
export const MENU = '.beta-args-menu'
export const MANAGE = `${MENU} .ui-menu-item:not([aria-disabled])`

/** Answers each open's pill had applied before the open, so absence is read against a newer one. */
const answersBefore = new WeakMap<WebContentsPage, number>()

export function pillLabel(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`
  )
}

function pillAnswers(popup: WebContentsPage): Promise<number> {
  return popup.evaluate<number>(
    `Number(document.querySelector(${JSON.stringify(PILL_SLOT)})?.getAttribute('data-answers') ?? -1)`
  )
}

/** Open the picker on `installationId`'s Startup Arguments and wait for its args field. */
export async function openStartupArgs(
  app: ElectronApplication,
  panel: WebContentsPage,
  installationId: string
): Promise<WebContentsPage> {
  await closeTitlePopupIfOpen(app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  // The picker stays mounted while hidden, so its pill may already hold earlier answers.
  const before =
    (await findWebContentsId(app, 'comfyTitlePopup.html')) === null
      ? -1
      : await pillAnswers(titlePopupPage(app)).catch(() => -1)
  await panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(installationId)}, initialTab: 'config' })`
  )
  await waitForWebContents(app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  answersBefore.set(popup, before)
  return popup
}

/** Count the pill's answers from now, for a pill that is about to (re)appear other than through
 *  `openStartupArgs`, such as the picker a Settings close returns to. */
export async function notePillAnswers(popup: WebContentsPage): Promise<void> {
  answersBefore.set(popup, await pillAnswers(popup).catch(() => -1))
}

/**
 * The pill renders nothing both before its answer and for an empty one, so absence means
 * something only once the pill has applied an answer newer than the open. Wait for that, however
 * long the git work behind it takes; the pill's DOM then already reflects it.
 */
export async function expectAnsweredWithNoPill(
  popup: WebContentsPage,
  message: string
): Promise<void> {
  const before = answersBefore.get(popup) ?? -1
  await expect
    .poll(() => pillAnswers(popup), {
      timeout: 20_000,
      intervals: [100, 200],
      message: `${message} (the pill never received its answer)`
    })
    .toBeGreaterThan(Math.max(before, 0))
  expect(await pillLabel(popup), message).toBeNull()
  expect(await popup.exists(PILL_LOADING), message).toBe(false)
}

/** Commit a new args value through the input's own change event, as a blur would. */
export async function commitArgs(popup: WebContentsPage, value: string): Promise<void> {
  await popup.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(`${ARGS_FIELD} input`)})
      input.value = ${JSON.stringify(value)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`
  )
}
