import { computed, reactive, watch } from 'vue'
import { INSTANCES, WORKSPACES, type LocalFolder, type ProtoInstance } from './mock'

/**
 * Shared prototype state. Module-level so every variant reads and writes the
 * same session (sign-in, workspace, page) and the switcher can flip variants
 * without losing context.
 */

export type Page =
  | 'overview'
  | 'explore'
  | 'assets'
  | 'instances'
  | 'workflows'
  | 'apps'
  | 'agent'
  | 'spaces'
  | 'projects'
  | `space:${string}`
  | 'tutorials'
  // Create / Build IA
  | 'environments'
  | `environment:${string}`
  | 'build-overview'
  | 'deployments'
  | `deployment:${string}`
  | 'router'
  | 'logs'
  | 'keys'
  // Workspace menu (admin, same in both modes)
  | 'usage'
  | 'billing'
  | 'limits'
  | 'people'
  | 'provider-keys'
  | `project:${string}`
  // Apps (Milestone 10): one app's page
  | `app:${string}`

/** Create: make things. Build: ship them as an API. Two lenses on the
 *  same workspace; admin lives in the workspace menu, outside both. */
export type Mode = 'create' | 'build' | 'agent'

const STORAGE_KEY = 'comfy.design.landing'

export interface Detail {
  kind: 'template' | 'workflow'
  /** Template id or workflow name. */
  id: string
}

export interface Launching {
  instanceId: string
  /** What opens once ComfyUI is up, e.g. a workflow or template name. */
  what?: string
}

interface Saved {
  signedIn: boolean
  viewAs: 'studio' | 'client'
  spaceId: string
  fresh: boolean
  live: boolean
}

function load(): Saved {
  const fallback: Saved = {
    signedIn: true,
    viewAs: 'studio',
    spaceId: 'northwind',
    fresh: false,
    live: false
  }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return fallback
  }
}

const saved = load()
const urlSignedOut = new URLSearchParams(location.search).get('signedOut') === '1'

export const proto = reactive({
  signedIn: urlSignedOut ? false : saved.signedIn,
  /** "Fresh install" scenario - no local instances yet. */
  fresh: saved.fresh,
  /** Projects (Milestone 8, set from milestones.ts). */
  projects: false,
  live: saved.live,
  /** Which milestone of the roadmap the prototype shows (set from
   *  milestones.ts). */
  milestone: 0,
  /** The build you were last in: where ⌘⇧H goes back to. */
  lastTab: '' as string,
  page: 'overview' as Page,
  workspaceId: 'personal' as 'personal' | 'design-team',
  activeInstanceId: 'local-1',
  /** Create / Build IA: which lens the nav shows. */
  mode: 'create' as Mode,
  /** Spaces (Milestone 9): the studio serves isolated, branded client
   *  spaces. Set from milestones.ts. */
  spaces: false,
  /** Spaces: who's looking - the studio, or a client inside one space. */
  viewAs: saved.viewAs,
  /** Client portal: which space, which page. */
  spaceId: saved.spaceId,
  portalPage: 'home' as string,
  /** The studio opened the portal with "Preview as client". */
  previewing: false,
  /** Prompt box draft, filled by starter cards. */
  draft: null as null | { text: string; intent: 'output' | 'workflow'; thumbId?: string },
  /** New space flow open. */
  creatingSpace: false,
  /** Member journey: invite email -> sign in -> in the space. */
  memberStage: 'space' as 'email' | 'signin' | 'space',
  /** App or workflow being deployed (Deploy dialog). */
  deployingTool: null as null | { kind: 'app' | 'workflow'; name: string; thumbId: string },
  /** Environment id being deployed (Deploy as API dialog). */
  deploying: null as string | null,
  /** Live mode instances, injected by LandingPrototypes. */
  liveInstances: [] as ProtoInstance[],
  toast: '' as string,
  /** Folders the user added on the Local tabs (Assets / Workflows). */
  extraAssetFolders: [] as LocalFolder[],
  extraWorkflowFolders: [] as LocalFolder[],
  /** Summary sheet for a template or workflow (shown before launching). */
  detail: null as Detail | null,
  /** Launch sequence in progress (mock) - teaches that ComfyUI opens from an
   *  instance into its own window. */
  launching: null as Launching | null,
  /** Open environments, one tab each (title bar), and which one is in front
   *  ('home' = launcher). `workflow` is what ComfyUI opened in it - ComfyUI
   *  keeps its own workflow tabs inside. */
  tabs: [] as { id: string; title: string; instanceId: string; workflow: string }[],
  activeTab: 'home' as string,
  /** Login gate - set whenever a logged-out user reaches for Comfy Cloud. */
  loginPrompt: null as { title: string; body: string } | null
})

watch(
  () => ({
    signedIn: proto.signedIn,
    fresh: proto.fresh,
    viewAs: proto.viewAs,
    spaceId: proto.spaceId,
    live: proto.live
  }),
  (s) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
)

// Without projects there are no project pages to stay on.
watch(
  () => proto.projects,
  (on) => {
    if (!on && proto.page.startsWith('project:')) proto.page = 'workflows'
  }
)
watch(
  () => proto.spaces,
  (on) => {
    if (!on && (proto.page === 'spaces' || proto.page.startsWith('space:'))) proto.page = 'overview'
    if (!on) proto.viewAs = 'studio'
  }
)

// Signing out drops you back to Personal, like the real app.
watch(
  () => proto.signedIn,
  (signedIn) => {
    if (!signedIn) proto.workspaceId = 'personal'
  }
)

export const workspace = computed(
  () => WORKSPACES.find((w) => w.id === proto.workspaceId) ?? WORKSPACES[0]!
)

/** All instances visible in the current scenario + workspace, cloud first. */
export const instances = computed<ProtoInstance[]>(() => {
  const all = proto.live && proto.liveInstances.length ? proto.liveInstances : INSTANCES
  return all.filter((i) => {
    if (proto.fresh && i.kind === 'local') return false
    // Deployments live in a workspace on the server: logged in only.
    // Deployments come with the Builder (Milestone 6, milestones.ts).
    if (i.deployment)
      return proto.milestone >= 6 && proto.signedIn && i.workspace === proto.workspaceId
    if (i.kind === 'cloud') return true
    return i.workspace === proto.workspaceId
  })
})

export const recentInstances = computed(() =>
  [...instances.value].sort((a, b) => a.lastUsedRank - b.lastUsedRank)
)

/** Logged out, Comfy Cloud can't run anything. */
export const isUsable = (i: ProtoInstance): boolean => i.kind === 'local' || proto.signedIn

export const activeInstance = computed(() => {
  const picked = instances.value.find((i) => i.id === proto.activeInstanceId)
  if (picked && isUsable(picked)) return picked
  return recentInstances.value.find(isUsable) ?? picked ?? recentInstances.value[0] ?? INSTANCES[0]!
})

export function instanceById(id: string): ProtoInstance | undefined {
  return [...INSTANCES, ...proto.liveInstances].find((i) => i.id === id)
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string): void {
  proto.toast = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (proto.toast = ''), 2200)
}

/** Host hooks - LandingPrototypes swaps these for real actions in-app. */
export const hostActions = {
  launch(inst: ProtoInstance, what?: string): void {
    if (inst.kind === 'cloud' && !proto.signedIn) {
      requireLogin()
      return
    }
    proto.detail = null
    proto.activeInstanceId = inst.id
    // The environment opens in its own tab, next to Home - or comes to the
    // front if it's open, loading the workflow there.
    const existing = proto.tabs.find((t) => t.instanceId === inst.id)
    if (existing) {
      if (what) existing.workflow = what
      proto.activeTab = existing.id
      return
    }
    const id = `tab-${Date.now()}`
    proto.tabs.push({
      id,
      title: inst.name,
      instanceId: inst.id,
      workflow: what ?? 'Untitled workflow'
    })
    proto.activeTab = id
  },
  newInstance(): void {
    toast('New build flow')
  },
  signIn(): void {
    proto.signedIn = true
    proto.loginPrompt = null
    toast('Logged in')
  }
}

export function go(page: Page): void {
  proto.page = page
  // Any launcher destination is Home.
  proto.activeTab = 'home'
}

// Remember the workflow you leave, so you can go straight back to it.
watch(
  () => proto.activeTab,
  (_now, before) => {
    if (before && before !== 'home' && proto.tabs.some((t) => t.id === before))
      proto.lastTab = before
  }
)

/** The workflow "back to workflow" returns to: the last one you were in. */
export const resumeTab = computed(
  () => proto.tabs.find((t) => t.id === proto.lastTab) ?? proto.tabs.at(-1)
)

/** Close an environment tab; if it was showing, go to its neighbour or
 *  Home. */
export function closeTab(id: string): void {
  const i = proto.tabs.findIndex((x) => x.id === id)
  if (i < 0) return
  proto.tabs.splice(i, 1)
  if (proto.activeTab !== id) return
  proto.activeTab = (proto.tabs[i] ?? proto.tabs[i - 1])?.id ?? 'home'
}

/** ⌘⇧H: Home ⇄ the workflow you were in. */
export function toggleHome(): void {
  if (proto.activeTab !== 'home') proto.activeTab = 'home'
  else if (resumeTab.value) proto.activeTab = resumeTab.value.id
}

export function openDetail(kind: Detail['kind'], id: string): void {
  proto.detail = { kind, id }
}

/** Comfy Cloud needs an account: anything that would open it while logged
 *  out lands here instead. */
export function requireLogin(
  title = 'Log in to use Comfy Cloud',
  body = 'Run ComfyUI on fast cloud GPUs with every model ready. New accounts get free credits.'
): void {
  proto.detail = null
  proto.loginPrompt = { title, body }
}

/** Go to a page in a given mode (the bridges between Create and Build). */
export function goIn(mode: Mode, page: Page): void {
  proto.mode = mode
  proto.page = page
}

/** Open "Deploy as API" for an environment - the Create -> Build bridge. */
export function deployEnv(envId: string): void {
  proto.detail = null
  proto.deploying = envId
}
