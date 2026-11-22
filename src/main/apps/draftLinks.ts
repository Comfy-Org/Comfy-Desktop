import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'

import type { DraftAppPasteAnswer, DraftAppRequest } from '../../types/ipc'
import { identityOf, signInProviderOf } from '../cloud/claims'
import { getCloudSession } from '../devplatform/session'
import { sendToPanelDeferred } from '../host/panelView'
import { findEntryByHostWindow, isPanelSender, openOrFocusHomeHostWindow } from '../host/registry'
import * as mainTelemetry from '../lib/telemetry'
import { areAppsEnabled } from './appsConfig'
import {
  confirmDraft,
  draftOf,
  draftSourceOf,
  isComfyAddress,
  isStaffAccount,
  OPEN_DRAFT_CHANNEL,
  parseDraftLink,
  parsePastedDraft,
  registerDraft
} from './draftApps'
import type { DraftLink, SignedInAccount } from './draftApps'

export const DRAFT_OPENED_EVENT = 'comfy.desktop.apps.draft_opened'
export const DRAFT_REFUSED_EVENT = 'comfy.desktop.apps.draft_refused'

export type DraftRefusal = 'bad_link' | 'apps_off' | 'signed_out' | 'not_staff'

const REFUSAL_WORDS: Record<DraftRefusal, { title: string; message: string }> = {
  bad_link: {
    title: "Couldn't open this draft app",
    message: 'This link does not point to a web page.'
  },
  apps_off: {
    title: "Couldn't open this draft app",
    message: 'Apps are not turned on in this copy of Comfy Desktop.'
  },
  signed_out: {
    title: 'Sign in to open draft apps',
    message: 'Sign in to Comfy Desktop with your @comfy.org account, then open the link again.'
  },
  not_staff: {
    title: 'Draft apps are for Comfy staff',
    message:
      'Sign in to Comfy Desktop with your @comfy.org account, through Google or your company sign-in, to open draft apps.'
  }
}

const PASTE_REFUSAL_WORDS: Record<DraftRefusal, { title: string; message: string }> = {
  ...REFUSAL_WORDS,
  bad_link: {
    title: "Couldn't open this draft app",
    message: 'Paste an https:// address, or http:// for this computer or your local network.'
  },
  signed_out: {
    title: 'Sign in to open draft apps',
    message: 'Sign in to Comfy Desktop with your @comfy.org account, then try again.'
  }
}

export interface DraftLinkDeps {
  isPackaged: () => boolean
  signedInAccount: () => Promise<SignedInAccount | null>
  appsEnabled: () => Promise<boolean>
  homeWindow: () => BrowserWindow
  sendToPanel: (window: BrowserWindow, request: DraftAppRequest) => void
}

async function signedInAccount(): Promise<SignedInAccount | null> {
  const grant = await getCloudSession().getGrantAccessToken()
  if (!grant) return null
  const email = identityOf(grant)?.email
  const signInProvider = signInProviderOf(grant)
  return {
    ...(email ? { email } : {}),
    ...(signInProvider ? { signInProvider } : {})
  }
}

function sendToPanel(window: BrowserWindow, request: DraftAppRequest): void {
  const panelView = findEntryByHostWindow(window)?.panelView
  if (panelView) sendToPanelDeferred(panelView, OPEN_DRAFT_CHANNEL, request)
}

const defaultDeps: DraftLinkDeps = {
  isPackaged: () => app.isPackaged,
  signedInAccount,
  appsEnabled: areAppsEnabled,
  homeWindow: openOrFocusHomeHostWindow,
  sendToPanel
}

async function refusalFor(
  link: DraftLink | null,
  account: SignedInAccount | null,
  deps: DraftLinkDeps
): Promise<DraftRefusal | null> {
  if (!link) return 'bad_link'
  if (!(await deps.appsEnabled())) return 'apps_off'
  if (!account) return 'signed_out'
  return isStaffAccount(account) ? null : 'not_staff'
}

function isOtherPerson(account: SignedInAccount | null): boolean {
  return account !== null && !isStaffAccount(account)
}

export function draftQuestion(link: DraftLink, title: string): { title: string; message: string } {
  const about = `"${title}". It is not published, and it runs with your Comfy Cloud account.`
  return {
    title: `Open a draft app from ${draftSourceOf(link)}?`,
    message: isComfyAddress(link) ? about : `${about}\nThis is not a Comfy address.`
  }
}

async function askToOpen(
  parsed: DraftLink,
  window: BrowserWindow,
  deps: DraftLinkDeps
): Promise<void> {
  const draft = await registerDraft(parsed)
  deps.sendToPanel(window, {
    kind: 'ask',
    appId: draft.id,
    ...draftQuestion(parsed, draft.card.title)
  })
}

export async function openDraftLink(
  link: string,
  deps: DraftLinkDeps = defaultDeps
): Promise<DraftRefusal | 'asked'> {
  const account = await deps.signedInAccount()
  if (isOtherPerson(account)) {
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason: 'not_staff' })
    return 'not_staff'
  }
  const parsed = parseDraftLink(link)
  const refusal = await refusalFor(parsed, account, deps)
  const window = deps.homeWindow()
  if (refusal || !parsed) {
    const reason = refusal ?? 'bad_link'
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason })
    deps.sendToPanel(window, { kind: 'refused', ...REFUSAL_WORDS[reason] })
    return reason
  }
  await askToOpen(parsed, window, deps)
  return 'asked'
}

export async function openPastedDraft(
  address: unknown,
  deps: DraftLinkDeps = defaultDeps
): Promise<DraftAppPasteAnswer> {
  const parsed = parsePastedDraft(address)
  const refusal = await refusalFor(parsed, await deps.signedInAccount(), deps)
  if (refusal || !parsed) {
    const reason = refusal ?? 'bad_link'
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason })
    return { kind: 'refused', ...PASTE_REFUSAL_WORDS[reason] }
  }
  await askToOpen(parsed, deps.homeWindow(), deps)
  return { kind: 'asked' }
}

export async function canPasteDrafts(deps: DraftLinkDeps = defaultDeps): Promise<boolean> {
  return !deps.isPackaged() || isStaffAccount(await deps.signedInAccount())
}

export function acceptDraft(sender: WebContents, appId: unknown): DraftAppRequest | null {
  if (!isPanelSender(sender) || typeof appId !== 'string' || !draftOf(appId)) return null
  const card = confirmDraft(appId)
  if (!card) return null
  mainTelemetry.capture(DRAFT_OPENED_EVENT, { app_id: appId })
  return { kind: 'open', card }
}
