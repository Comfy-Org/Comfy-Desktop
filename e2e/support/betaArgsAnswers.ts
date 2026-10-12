/**
 * Reads the beta-args pill's absence against main's answers to the open's own asks. The pill
 * shows nothing until an open's first answer arrives, so an empty field alone proves nothing.
 * In E2E, main records each `get-core-beta-args` ask and sets its answer on that record.
 */

import { expect, type ElectronApplication } from '@playwright/test'
import { titlePopupPage, type WebContentsPage } from './cdpPages'
import { getIpcInvocations, resetIpcInvocations } from './devHooks'

const ASKED = 'get-core-beta-args'
/** Not an install: what the title popup asks for to mark where an open's asks start. */
const OPEN_MARK = 'e2e-open-mark'
const PILL = '[data-field-id="launchArgs"] .beta-args button'
const LOADING = '[data-field-id="launchArgs"] .beta-args-loading'

interface BetaArgsAnswer {
  args: { arg: string }[]
}

interface Ask {
  installationId: string
  answer?: BetaArgsAnswer
}

export interface BetaArgsOpen {
  popup: WebContentsPage
  /** Whether an earlier open's picker was there to mark where this open's asks start. */
  marked: boolean
  /** Main's answer to every ask this open made. */
  answers: BetaArgsAnswer[]
}

/** Apps whose picker an earlier open showed, so a pill there can ask while the popup is hidden. */
const pickerShown = new WeakSet<ElectronApplication>()

/**
 * Has the popup ask for OPEN_MARK as the next config reaches it. This listener runs after the
 * popup's own, before Vue flushes the watchers that ask for the open, and main records one
 * renderer's asks in the order it sent them. So the asks after the mark are the open's, and none
 * a hidden picker sent before the config arrived is.
 */
async function markNextOpen(app: ElectronApplication): Promise<void> {
  await titlePopupPage(app).evaluate(`(() => {
    window.__e2eUnmarkOpen?.()
    const off = window.__comfyTitlePopup.onConfig(() => {
      off()
      void window.api.getCoreBetaArgs(${JSON.stringify(OPEN_MARK)})
    })
    window.__e2eUnmarkOpen = off
  })()`)
}

/**
 * Main's answers once the open has asked at least twice (when shown, and again once the args
 * field's schema load settles) and every ask so far is answered. Until then the pill shows
 * nothing or this open's first answer, so a missing pill proves nothing yet.
 */
async function answersOf(app: ElectronApplication, marked: boolean): Promise<BetaArgsAnswer[]> {
  let answers: BetaArgsAnswer[] = []
  await expect
    .poll(
      async () => {
        const recorded = (await getIpcInvocations(app, ASKED)) as Ask[]
        const start = marked
          ? recorded.findIndex(({ installationId }) => installationId === OPEN_MARK) + 1
          : 0
        const asks = marked && start === 0 ? [] : recorded.slice(start)
        answers = asks.flatMap(({ answer }) => (answer ? [answer] : []))
        return asks.length >= 2 && answers.length === asks.length
      },
      { timeout: 15_000, intervals: [100, 200], message: 'this open never had both asks answered' },
    )
    .toBe(true)
  return answers
}

/**
 * Runs `open` with the popup already closed, and returns once every ask that open made is
 * answered. The reset drops every earlier ask's record, so a late answer to one cannot stand in
 * for this open's.
 */
export async function openWithBetaArgsAnswers(
  app: ElectronApplication,
  open: () => Promise<WebContentsPage>,
): Promise<BetaArgsOpen> {
  await resetIpcInvocations(app, ASKED)
  const marked = pickerShown.has(app)
  if (marked) await markNextOpen(app)
  const popup = await open()
  const answers = await answersOf(app, marked)
  pickerShown.add(app)
  return { popup, marked, answers }
}

const grantedArgs = (answers: BetaArgsAnswer[]): string[] =>
  answers.flatMap(({ args }) => args.map(({ arg }) => arg))

/** No answer this open got offered a grant, the pill shows nothing once it has applied them, and
 *  no ask the open made by then offered one either. */
export async function expectNoBetaArgsPill(
  app: ElectronApplication,
  { popup, marked, answers }: BetaArgsOpen,
  message: string,
): Promise<void> {
  expect(grantedArgs(answers), message).toEqual([])
  const shown = async (): Promise<string | null> =>
    (await popup.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`,
    )) ?? ((await popup.exists(LOADING)) ? 'loading' : null)
  await expect.poll(shown, { timeout: 10_000, message }).toBeNull()
  expect(grantedArgs(await answersOf(app, marked)), message).toEqual([])
}
