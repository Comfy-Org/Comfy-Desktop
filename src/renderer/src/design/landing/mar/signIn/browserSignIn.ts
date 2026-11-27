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
  },
  failed: {
    cancelled: 'Login was cancelled in the browser.',
    rejected: "Login didn't go through. Comfy couldn't confirm the account.",
    retry: 'Try again',
    local: 'Continue without an account'
  }
} as const

export type SignInFailure = '' | 'cancelled' | 'rejected'

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

export const FAKE_SIGNUP_URL = 'https://cloud.comfy.org/cloud/signup?desktop_login_code=PROTO-7Q4K'
export const FAKE_BILLING_URL = 'https://cloud.comfy.org/cloud/billing/add-credits'

export const SIGN_UP_COPY = {
  title: 'Create your Comfy account',
  body: 'One account for Comfy Desktop and Comfy Cloud',
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  email: 'Continue with email',
  emailPlaceholder: 'you@example.com',
  haveAccount: 'Already have an account?',
  logIn: 'Log in'
} as const

export const TOP_UP_COPY = {
  title: 'Add credits',
  body: 'Credits pay for runs on Comfy Cloud. You pay what a run costs, no markup.',
  amountLabel: 'Amount',
  card: 'Visa ending 4242',
  pay: (usd: string) => `Pay ${usd}`,
  paidTitle: (usd: string) => `${usd} added`,
  paidBody: 'Your account is ready. Go back to Comfy Desktop to keep going.',
  back: 'Back to Comfy Desktop'
} as const

export const TOP_UP_AMOUNTS = [5, 10, 20] as const
export const DEFAULT_TOP_UP = 10

export const NEW_ACCOUNT_WORKSPACE: Workspace = {
  id: 'personal',
  name: 'Personal',
  plan: 'No plan',
  role: 'OWNER',
  initial: 'P',
  color: '#3a3a3d'
}

export type BrowserStep = 'signup' | 'consent' | 'topup' | 'paid'

export const browserSignIn = reactive({
  pending: false,
  banner: false,
  browser: false,
  step: 'consent' as BrowserStep,
  added: 0,
  failed: '' as SignInFailure
})

export const newAccount = reactive({ made: false, paid: false })

const waiting: Finish[] = []
let opening: ReturnType<typeof setTimeout> | undefined

export function fakeBrowserSignIn(finish: Finish): void {
  waiting.push(finish)
  browserSignIn.failed = ''
  if (!browserSignIn.pending) browserSignIn.added = 0
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
  failSignIn('cancelled')
}

export function failSignIn(why: Exclude<SignInFailure, ''>): void {
  clearTimeout(opening)
  browserSignIn.browser = false
  browserSignIn.pending = false
  browserSignIn.banner = true
  browserSignIn.failed = why
}

export function retrySignIn(): void {
  browserSignIn.failed = ''
  browserSignIn.pending = true
  browserSignIn.banner = true
  clearTimeout(opening)
  opening = setTimeout(openBrowserAgain, BROWSER_OPENS_AFTER_MS)
}

export function signInWithoutAccount(): void {
  clearTimeout(opening)
  waiting.splice(0)
  browserSignIn.failed = ''
  browserSignIn.pending = false
  browserSignIn.banner = false
  browserSignIn.browser = false
}

export function dismissSignInBanner(): void {
  browserSignIn.banner = false
  browserSignIn.failed = ''
}

export function startBrowserSteps(newUser: boolean): void {
  browserSignIn.step = newUser && !newAccount.made ? 'signup' : 'consent'
}

export function needsFirstCredits(newUser: boolean): boolean {
  return newUser && !newAccount.paid
}

export function createAccount(): void {
  newAccount.made = true
  browserSignIn.step = 'consent'
}

export function goToTopUp(): void {
  browserSignIn.step = 'topup'
}

export function payInBrowser(amount: number): void {
  newAccount.paid = true
  browserSignIn.added = amount
  browserSignIn.step = 'paid'
}

export function forgetNewAccount(): void {
  newAccount.made = false
  newAccount.paid = false
}
