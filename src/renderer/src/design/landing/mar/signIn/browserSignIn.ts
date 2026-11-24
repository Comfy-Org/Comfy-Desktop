import { reactive } from 'vue'
import type { Workspace } from '../../mock'

export const BROWSER_OPENS_AFTER_MS = 700

export const SIGN_IN_COPY = {
  title: 'Log in to Comfy',
  body: 'Start on Comfy Cloud for free',
  cta: 'Log in',
  waiting: 'Continue in your browser',
  banner: {
    message: 'We opened your browser to sign in. Didn’t open?',
    copy: 'Copy link',
    copied: 'Copied',
    openAgain: 'Open again',
    dismiss: 'Dismiss'
  }
} as const

export const FAKE_LOGIN_URL = 'https://cloud.comfy.org/cloud/login?desktop_login_code=PROTO-7Q4K'
export const FAKE_CALLBACK_URL = 'http://127.0.0.1:61876/callback'

export const CONSENT_PERMISSIONS = [
  { scope: 'comfy-cloud:user:read', plain: 'See your name and email' },
  { scope: 'comfy-cloud:jobs:write', plain: 'Run workflows on Comfy Cloud' },
  { scope: 'comfy-cloud:workspace-token:mint', plain: 'Work in the workspace you pick' },
  { scope: 'comfy-cloud:billing:write', plain: 'Use that workspace’s credits' }
] as const

type WorkspaceId = Workspace['id']
type Finish = (workspaceId: WorkspaceId) => void

export const browserSignIn = reactive({ pending: false, banner: false, browser: false })

const waiting: Finish[] = []
let opening: ReturnType<typeof setTimeout> | undefined

export function fakeBrowserSignIn(finish: Finish): void {
  waiting.push(finish)
  browserSignIn.pending = true
  browserSignIn.banner = true
  clearTimeout(opening)
  opening = setTimeout(openBrowserAgain, BROWSER_OPENS_AFTER_MS)
}

export function openBrowserAgain(): void {
  clearTimeout(opening)
  if (browserSignIn.pending) browserSignIn.browser = true
}

export function continueInBrowser(workspaceId: WorkspaceId): void {
  clearTimeout(opening)
  browserSignIn.browser = false
  browserSignIn.pending = false
  browserSignIn.banner = false
  for (const finish of waiting.splice(0)) finish(workspaceId)
}

export function cancelInBrowser(): void {
  clearTimeout(opening)
  browserSignIn.browser = false
  browserSignIn.banner = true
}

export function dismissSignInBanner(): void {
  browserSignIn.banner = false
}
