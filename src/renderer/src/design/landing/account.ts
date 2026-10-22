import { computed, shallowRef, watch } from 'vue'
import type { Workspace } from './mock'
import { proto, toast, workspace } from './useProto'
import { USER } from './mock'
import type { useAuthStore } from '../../stores/authStore'

/**
 * The real Comfy account, when the prototype runs inside the app with
 * "Data: Mine": sign-in state, the active workspace and the workspaces to
 * switch between, from the app's own auth store (Cloud OAuth, tokens stay
 * in main). In the browser preview, or on "Data: Mock", the mock account is
 * used instead.
 *
 * LandingPrototypes calls `connectAccount()` once inside the app (the store
 * needs the panel's Pinia and window.api).
 */
type AuthStore = ReturnType<typeof useAuthStore>
const store = shallowRef<AuthStore | null>(null)

export function connectAccount(auth: AuthStore): void {
  store.value = auth
  void auth.whenReady().then(() => {
    if (auth.status.signedIn) void auth.fetchWorkspaces()
  })
}

/** Using the real account (in-app, "Data: Mine"). */
export const realAccount = computed(() => !!store.value && proto.live)

const status = computed(() => store.value?.status ?? { signedIn: false })

/** The real account mirrors into the prototype's sign-in state. */
watch(
  () => [realAccount.value, status.value.signedIn] as const,
  ([real, signedIn]) => {
    if (real) proto.signedIn = signedIn
  },
  { immediate: true }
)
watch(
  () => status.value.signedIn,
  (signedIn) => {
    if (signedIn && store.value) void store.value.fetchWorkspaces()
  }
)

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** A real workspace in the prototype's shape (avatar, plan line, role). */
function toWorkspace(w: {
  id: string
  name: string
  type?: string
  role?: string
  subscriptionTier?: string
}): Workspace {
  const plan = w.subscriptionTier
    ? `${titleCase(w.subscriptionTier.toLowerCase())} plan`
    : w.type === 'personal'
      ? 'Personal'
      : 'Team'
  return {
    id: w.id as Workspace['id'],
    name: w.name || 'Personal',
    plan,
    role: (w.role ?? '').toUpperCase(),
    initial: (w.name || 'P').charAt(0).toUpperCase(),
    color: '#3a3a3d'
  }
}

/** The active real workspace, or null before it's known. */
export const realWorkspace = computed<Workspace | null>(() => {
  const s = status.value
  if (!s.signedIn || !s.workspaceId) return null
  const listed = store.value?.workspaces.find((w) => w.id === s.workspaceId)
  return toWorkspace(
    listed ?? {
      id: s.workspaceId,
      name: s.workspaceName ?? '',
      type: s.workspaceType,
      role: s.role
    }
  )
})

export const realWorkspaces = computed<Workspace[]>(() =>
  (store.value?.workspaces ?? []).map(toWorkspace)
)

export const realEmail = computed(() => status.value.email ?? '')

/** First name-ish for the greeting: the email's local part. */
export const realName = computed(() => {
  const local = realEmail.value.split('@')[0] ?? ''
  const first = local.split(/[._-]/)[0] ?? ''
  return first ? titleCase(first) : ''
})

/** What the UI shows: the real account when connected, else the mock. */
export const shownWorkspace = computed<Workspace>(() =>
  realAccount.value ? (realWorkspace.value ?? workspace.value) : workspace.value
)
export const shownName = computed(() => (realAccount.value ? realName.value : USER.name))
export const shownEmail = computed(() => (realAccount.value ? realEmail.value : USER.email))
/** Credits aren't available to the app yet: null hides them. */
export const shownCredits = computed(() => (realAccount.value ? null : USER.credits))

export async function realSignIn(): Promise<void> {
  try {
    await store.value?.signIn()
    proto.loginPrompt = null
  } catch {
    toast("Couldn't log in")
  }
}

export async function realSignOut(): Promise<void> {
  await store.value?.signOut()
  toast('Logged out')
}

export async function realSwitchWorkspace(id: string): Promise<void> {
  try {
    await store.value?.switchWorkspace(id)
  } catch {
    toast("Couldn't switch workspace")
  }
}
