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

/** The pill each open started from and the answers it had applied, so absence is read against a
 *  newer answer. A pill that remounted since (another install, or the picker returning from
 *  Settings) is not the noted one, and any answer it has applied is newer. */
const answersBefore = new WeakMap<WebContentsPage, { token: string; answers: number }>()
let noteSeq = 0

export function pillLabel(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`
  )
}

/** The current pill's answer count, and whether it is the pill noted under `token`. */
function pillAnswers(
  popup: WebContentsPage,
  token: string
): Promise<{ answers: number; noted: boolean }> {
  return popup.evaluate<{ answers: number; noted: boolean }>(
    `(() => {
      const slot = document.querySelector(${JSON.stringify(PILL_SLOT)})
      return {
        answers: Number(slot?.getAttribute('data-answers') ?? -1),
        noted: slot?.__e2ePillNote === ${JSON.stringify(token)}
      }
    })()`
  )
}

/** Tag the current pill, if any, and record its answer count. */
async function notePill(popup: WebContentsPage): Promise<{ token: string; answers: number }> {
  const token = `note-${++noteSeq}`
  const answers = await popup
    .evaluate<number>(
      `(() => {
        const slot = document.querySelector(${JSON.stringify(PILL_SLOT)})
        if (!slot) return -1
        slot.__e2ePillNote = ${JSON.stringify(token)}
        return Number(slot.getAttribute('data-answers'))
      })()`
    )
    .catch(() => -1)
  return { token, answers }
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
      ? { token: '', answers: -1 }
      : await notePill(titlePopupPage(app))
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
  answersBefore.set(popup, await notePill(popup))
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
  const before = answersBefore.get(popup) ?? { token: '', answers: -1 }
  await expect
    .poll(
      async () => {
        const now = await pillAnswers(popup, before.token)
        return now.answers > (now.noted ? Math.max(before.answers, 0) : 0)
      },
      {
        timeout: 20_000,
        intervals: [100, 200],
        message: `${message} (the pill never received its answer)`
      }
    )
    .toBe(true)
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
