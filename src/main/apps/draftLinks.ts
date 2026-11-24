import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'

import type { DraftAppPasteAnswer, DraftAppRequest } from '../../types/ipc'
import { identityOf, signInProviderOf } from '../cloud/claims'
import { getCloudSession } from '../devplatform/session'
import { sendToPanelDeferred } from '../host/panelView'
import { findEntryByHostWindow, isPanelSender, openOrFocusHomeHostWindow } from '../host/registry'
import * as mainTelemetry from '../lib/telemetry'
import {
  confirmDraft,
  draftAskedWith,
  draftOf,
  draftsBelongTo,
  draftSourceOf,
  hasDrafts,
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

export type DraftRefusal = 'bad_link' | 'signed_out' | 'not_staff' | 'account_changed'

const REFUSAL_WORDS: Record<DraftRefusal, { title: string; message: string }> = {
  bad_link: {
    title: "Couldn't open this draft app",
    message: 'This link does not point to a web page.'
  },
  signed_out: {
    title: 'Sign in to open draft apps',
    message: 'Sign in to Comfy Desktop with your @comfy.org account, then open the link again.'
  },
  not_staff: {
    title: 'Draft apps are for Comfy staff',
    message:
      'Sign in to Comfy Desktop with your @comfy.org account, through Google or your company sign-in, to open draft apps.'
  },
  account_changed: {
    title: "Couldn't open this draft app",
    message: 'The Comfy Cloud account changed while the draft app was loading. Open the link again.'
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
  },
  account_changed: {
    title: "Couldn't open this draft app",
    message: 'The Comfy Cloud account changed while the draft app was loading. Try again.'
  }
}

export interface DraftLinkDeps {
  isPackaged: () => boolean
  signedInAccount: () => Promise<SignedInAccount | null>
  cloudIdentity: () => string | null
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

export function cloudIdentity(): string | null {
  const session = getCloudSession()
  const subject = session.currentSubject()
  return subject === null ? null : JSON.stringify([subject, session.currentWorkspaceId()])
}

function sendToPanel(window: BrowserWindow, request: DraftAppRequest): void {
  const panelView = findEntryByHostWindow(window)?.panelView
  if (panelView) sendToPanelDeferred(panelView, OPEN_DRAFT_CHANNEL, request)
}

const defaultDeps: DraftLinkDeps = {
  isPackaged: () => app.isPackaged,
  signedInAccount,
  cloudIdentity,
  homeWindow: openOrFocusHomeHostWindow,
  sendToPanel
}

function refusalFor(link: DraftLink | null, account: SignedInAccount | null): DraftRefusal | null {
  if (!link) return 'bad_link'
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
  owner: string | null,
  window: () => BrowserWindow,
  deps: DraftLinkDeps
): Promise<boolean> {
  const draft =
    owner === null ? null : await registerDraft(parsed, owner, () => deps.cloudIdentity() === owner)
  if (!draft) {
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason: 'account_changed' })
    return false
  }
  deps.sendToPanel(window(), {
    kind: 'ask',
    appId: draft.id,
    token: draft.token,
    ...draftQuestion(parsed, draft.card.title)
  })
  return true
}

export async function openDraftLink(
  link: string,
  deps: DraftLinkDeps = defaultDeps
): Promise<DraftRefusal | 'asked'> {
  const owner = deps.cloudIdentity()
  const account = await deps.signedInAccount()
  if (isOtherPerson(account)) {
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason: 'not_staff' })
    return 'not_staff'
  }
  const parsed = parseDraftLink(link)
  const refusal = refusalFor(parsed, account)
  const window = deps.homeWindow()
  if (refusal || !parsed) {
    const reason = refusal ?? 'bad_link'
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason })
    deps.sendToPanel(window, { kind: 'refused', ...REFUSAL_WORDS[reason] })
    return reason
  }
  return (await askToOpen(parsed, owner, () => window, deps)) ? 'asked' : 'account_changed'
}

export async function openPastedDraft(
  address: unknown,
  deps: DraftLinkDeps = defaultDeps
): Promise<DraftAppPasteAnswer> {
  const owner = deps.cloudIdentity()
  const parsed = parsePastedDraft(address)
  const refusal = refusalFor(parsed, await deps.signedInAccount())
  if (refusal || !parsed) {
    const reason = refusal ?? 'bad_link'
    mainTelemetry.capture(DRAFT_REFUSED_EVENT, { reason })
    return { kind: 'refused', ...PASTE_REFUSAL_WORDS[reason] }
  }
  if (await askToOpen(parsed, owner, deps.homeWindow, deps)) return { kind: 'asked' }
  return { kind: 'refused', ...PASTE_REFUSAL_WORDS.account_changed }
}

export async function canPasteDrafts(deps: DraftLinkDeps = defaultDeps): Promise<boolean> {
  return !deps.isPackaged() || isStaffAccount(await deps.signedInAccount())
}

export async function acceptDraft(
  sender: WebContents,
  token: unknown,
  deps: DraftLinkDeps = defaultDeps
): Promise<DraftAppRequest | null> {
  if (!isPanelSender(sender) || typeof token !== 'string') return null
  const draft = draftAskedWith(token)
  const owner = deps.cloudIdentity()
  if (!draft || owner === null || draft.owner !== owner) return null
  if (!isStaffAccount(await deps.signedInAccount())) return null
  if (deps.cloudIdentity() !== owner || draftAskedWith(token) !== draft) return null
  const card = confirmDraft(token)
  if (!card) return null
  mainTelemetry.capture(DRAFT_OPENED_EVENT, { app_id: draft.id })
  return { kind: 'open', card }
}

export async function isDraftStillAllowed(
  appId: string,
  deps: DraftLinkDeps = defaultDeps
): Promise<boolean> {
  const draft = draftOf(appId)
  const owner = deps.cloudIdentity()
  if (!draft?.accepted || owner === null || draft.owner !== owner) return false
  if (!isStaffAccount(await deps.signedInAccount())) return false
  return deps.cloudIdentity() === owner && draftOf(appId) === draft && draft.accepted
}

export async function draftsStillAllowed(deps: DraftLinkDeps = defaultDeps): Promise<boolean> {
  if (!hasDrafts()) return true
  if (!draftsBelongTo(deps.cloudIdentity())) return false
  if (!isStaffAccount(await deps.signedInAccount())) return false
  return draftsBelongTo(deps.cloudIdentity())
}
