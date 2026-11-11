import { nextTick, watch } from 'vue'
import { appsProto, openAppUrl } from '../appFlow'
import { look } from '../look'
import { MILESTONES, can } from '../milestones'
import { go, hostActions, instanceById, instances, proto, type Page } from '../useProto'
import { graphOpen } from './graph/graphOpen'
import { TWEAKS, type TweakId } from './tunerContext'
import { tuning, KNOBS } from './uiTuner'
import { SURFACES, surface } from './shell/surface'
import { homeBackground } from './shell/marShell'
import { BRAND_MOTIFS, brandMotif } from './brand/brandMotif'
import { APPS_STAGES, appsStage } from './apps/appsStage'
import { APP_EXAMPLES_AT, APP_PAGE_LOOKS, appExamplesAt, appPage } from './apps/appPage'
import { FIRST_RUNS, firstRun } from './firstRun'
import { EXAMPLE_LOOKS, exampleLook } from './userStates/exampleLook'
import { EDITOR_ENTRIES, editorEntry } from './userStates/editorEntry'
import { TEMPLATE_STYLES, templateStyle } from './brand/templateStyle'
import { COVERS, cover } from './cover'
import { BUILD_CARDS, buildCard } from './pages/buildCard'
import { BUILD_PAGES, buildPage } from './build/buildPage'
import { syncPrevious } from './build/syncPrevious'
import { assetsEverywhere } from './assets/assetsEverywhere'
import { assetLink, holdAssetLink } from './assets/assetLink'
import { FOLDER_DEPTHS, folderDepth } from './assets/folderDepth'
import { FULL_ASSETS, fullAssets } from './graph/fullAssets'
import { PAGE_STATES, pageState } from './pages/pageState'
import { CREDITS_STATES, creditsState } from './credits'
import { COMFY_LOOKS, comfyLook } from './graph/comfyLook'
import { LOOKS, marLook } from './looks/looks'
import { DISPLAYS, SCREENS, ZOOMS, screen } from './screen'
import { PORTS, ports } from './navOptions'
import { MAR_LOCALS, MAR_USERS, marUser, setUser } from './userStates/userState'
import {
  LOCAL_SETUPS,
  MACHINES,
  AFTER_INSTALLS,
  ONBOARDINGS,
  CARD_ATS,
  NODES_AT,
  SETUP_GPUS,
  SETUP_OSES,
  SETUP_SCOPES,
  SETUP_SCREENS,
  flow,
  localSetup,
  setupOn,
  showScreen,
  type Screen
} from './setup/setupFlow'

/**
 * Share link (UI Playground › Copy link): one URL that opens the prototype
 * the way you see it, to send a variant to someone.
 *
 * It carries the milestone, the screen (a page, an app in front, or a
 * step of the onboarding), the theme and every tweak that isn't on its
 * default. Opening it puts every tweak back on its default first, then
 * applies the link's, so it shows exactly that variant whatever the
 * person had picked. The parameters are then dropped from the address,
 * so a reload keeps what they change afterwards.
 *
 *   ?proposal=mariana&share&m=6&view=explore&appPage=themed
 *   ?proposal=mariana&share&m=4&user=first&local=none&step=installing&setup.os=windows
 *
 * The screen is a view code (viewCode below), which the address bar also
 * shows as you move, so the address alone opens the same screen without
 * touching the tweaks.
 *
 * A new tweak shares itself once it is listed in PARTS below.
 */

/** One value a link carries: its parameter, how to read and write it, the
 *  default it is left out on, and the values it accepts. */
interface Part {
  key: string
  get: () => string
  set: (v: string) => void
  def: string | (() => string)
  ok: readonly string[]
}

const isDefault = (p: Part): boolean => p.get() === (typeof p.def === 'function' ? p.def() : p.def)

const values = (list: readonly ({ value: string } | { id: string })[]): string[] =>
  list.map((o) => ('value' in o ? o.value : o.id))

/** A one-value store (`{ id }`), like most of the Playground's tweaks. */
const one = (
  key: string,
  s: { id: string },
  def: Part['def'],
  list: readonly ({ value: string } | { id: string })[]
): Part => ({ key, get: () => s.id, set: (v) => (s.id = v), def, ok: values(list) })

/** A field of a store with several. */
const field = <T extends object>(
  key: string,
  s: T,
  k: keyof T & string,
  def: string,
  list: readonly ({ value: string } | { id: string })[]
): Part => ({
  key,
  get: () => String(s[k]),
  set: (v) => ((s as Record<string, unknown>)[k] = v),
  def,
  ok: values(list)
})

const OFF_ON = [{ value: 'off' }, { value: 'on' }]
const BACKGROUNDS = ['spotlight', 'bloom', 'output', 'canvas', 'wires', 'grade'].map((value) => ({
  value
}))

// In the order they are applied: who and what's installed before the
// pages that read them.
const PARTS: Part[] = [
  {
    key: 'user',
    get: () => marUser.user,
    set: (v) => setUser(v as (typeof marUser)['user']),
    def: 'returning',
    ok: values(MAR_USERS)
  },
  field('local', marUser, 'local', 'several', MAR_LOCALS),
  {
    key: 'account',
    get: () => (proto.signedIn ? 'in' : 'out'),
    set: (v) => (proto.signedIn = v === 'in'),
    def: 'in',
    ok: ['in', 'out']
  },
  one('surface', surface, 'desktop', SURFACES),
  one('brandMotif', brandMotif, 'off', BRAND_MOTIFS),
  one('homeBackground', homeBackground, 'spotlight', BACKGROUNDS),
  one('appsStage', appsStage, 'm1', APPS_STAGES),
  one('appPage', appPage, 'hub', APP_PAGE_LOOKS),
  one('appExamplesAt', appExamplesAt, 'tabs', APP_EXAMPLES_AT),
  one('firstRun', firstRun, 'original', FIRST_RUNS),
  one('examples', exampleLook, 'arc', EXAMPLE_LOOKS),
  one('editorEntry', editorEntry, 'rows', EDITOR_ENTRIES),
  one('templates', templateStyle, 'photo', TEMPLATE_STYLES),
  // The cover's default follows the milestone (cover.ts).
  one('cover', cover, () => (can.value.projects ? 'output' : 'canvas'), COVERS),
  one('buildCard', buildCard, 'rows', BUILD_CARDS),
  one('buildPage', buildPage, 'production', BUILD_PAGES),
  one('syncPrevious', syncPrevious, 'off', OFF_ON),
  one('assetsEverywhere', assetsEverywhere, 'off', OFF_ON),
  one('folders', folderDepth, 'few', FOLDER_DEPTHS),
  one('fullAssets', fullAssets, 'home', FULL_ASSETS),
  one('pageState', pageState, 'live', PAGE_STATES),
  one('credits', creditsState, 'active', CREDITS_STATES),
  // After Graph look: Production sets it to Current.
  one('comfyui', comfyLook, 'proposal', COMFY_LOOKS),
  one('look', marLook, 'current', LOOKS),
  {
    key: 'ports',
    get: () =>
      PORTS.filter((p) => ports[p.key])
        .map((p) => p.key)
        .join(','),
    set: (v) => PORTS.forEach((p) => (ports[p.key] = v.split(',').includes(p.key))),
    def: '',
    ok: []
  },
  // Onboarding: the proposed local setup and the computer it runs on.
  field('setup', localSetup, 'mode', 'off', LOCAL_SETUPS),
  field('setup.scope', localSetup, 'scope', 'next', SETUP_SCOPES),
  field('setup.onboarding', localSetup, 'onboarding', 'oneclick', ONBOARDINGS),
  field('setup.after', localSetup, 'after', 'ready', AFTER_INSTALLS),
  field('setup.card', localSetup, 'card', 'top', CARD_ATS),
  field('setup.os', localSetup, 'os', 'mac', SETUP_OSES),
  field('setup.gpu', localSetup, 'gpu', 'nvidia', SETUP_GPUS),
  field('setup.machine', localSetup, 'machine', 'ready', MACHINES),
  field('setup.nodes', localSetup, 'nodes', 'off', NODES_AT),
  // More: the screen simulator and the token knobs.
  field('screen', screen, 'id', 'fit', SCREENS),
  {
    key: 'zoom',
    get: () => String(screen.zoom),
    set: (v) => (screen.zoom = Number(v)),
    def: '1',
    ok: ZOOMS.map(String)
  },
  field('colour', screen, 'display', 'true', DISPLAYS),
  // Both knobs default to 'default'.
  ...KNOBS.map((k) => field(`ui.${k.key}`, tuning, k.key, 'default', k.options))
]

/** The onboarding step on screen, as UI Playground › Jump to names it. */
function onboardingStep(): Screen | '' {
  if (!flow.open || !setupOn.value) return ''
  if (flow.confirmCancel) return 'cancel'
  if (flow.confirmLowDisk) return 'lowdisk'
  if (flow.step === 'setup' && !flow.takeover) return 'builds'
  if (flow.step === 'setup' && localSetup.machine === 'intel') return 'intel'
  return flow.step
}

// Parameters that aren't the link's own: kept as they are.
const SCREEN_KEYS = ['share', 'm', 'view', 'page', 'app', 'step', 'theme', 'comfy']
const OWN = new Set([...SCREEN_KEYS, ...PARTS.map((p) => p.key)])

/**
 * The screen, as a code of its own:
 *   overview · explore · assets · apps · …      a page
 *   assets.cloud · assets.cloud.c11              Assets on a build, an asset open
 *   app.<id>                                     an app in front
 *   comfy.<build>                                ComfyUI on a build
 *   comfy.<build>.assets[.<asset>]               its Media Assets panel
 *   comfy.<build>.assets-tab[.<asset>]           Assets expanded to a tab
 */
export function viewCode(): string {
  const tab = proto.tabs.find((t) => t.id === proto.activeTab)
  if (tab) {
    const at = assetLink.at === 'panel' ? 'assets' : assetLink.at === 'tab' ? 'assets-tab' : ''
    return ['comfy', tab.instanceId, at, at && assetLink.id].filter(Boolean).join('.')
  }
  if (appsProto.front) return `app.${appsProto.front}`
  if (proto.page === 'assets' && assetLink.at === 'desktop')
    return ['assets', assetLink.build, assetLink.id].filter(Boolean).join('.')
  return proto.page
}

/** Go to the screen a view code names. */
function openView(code: string): void {
  const [head = '', a = '', b = '', c = ''] = code.split('.')
  if (head === 'app' && a) {
    appsProto.tabs = []
    openAppUrl(a)
  } else if (head === 'assets') {
    if (a) holdAssetLink('desktop', b, a)
    go('assets')
  } else if (head === 'comfy') {
    const inst =
      instanceById(a) ?? instances.value.find((i) => i.kind === 'local') ?? instances.value[0]
    if (!inst) return
    if (b === 'assets' || b === 'assets-tab') {
      holdAssetLink(b === 'assets' ? 'panel' : 'tab', c)
      graphOpen.assets = true
      graphOpen.tab = b === 'assets-tab'
    }
    hostActions.launch(inst, 'hero-shot-v4')
  } else if (head) go(code as Page)
}

/** The link to what's on screen now. */
export function shareUrl(): string {
  const q = new URLSearchParams()
  const here = new URLSearchParams(location.search)
  here.forEach((v, k) => !OWN.has(k) && q.set(k, v))
  q.set('share', '')
  q.set('m', String(proto.milestone))
  q.set('theme', look.theme)
  q.set('view', viewCode())
  const step = onboardingStep()
  if (step) q.set('step', step)
  for (const p of PARTS) if (!isDefault(p)) q.set(p.key, p.get())
  // `share=` reads better bare.
  return `${location.origin}${location.pathname}?${q.toString().replace('share=&', 'share&')}`
}

/** What a link changes, in words, for the Playground to show under Copy. */
export function shareSummary(): string[] {
  const out: string[] = []
  const m = MILESTONES.find((x) => Number(x.value) === proto.milestone)
  if (m) out.push(m.label)
  const step = onboardingStep()
  if (step) out.push(`Onboarding · ${SETUP_SCREENS.find((s) => s.value === step)?.label}`)
  out.push(...PARTS.filter((p) => !isDefault(p)).map((p) => `${p.key} = ${p.get() || '–'}`))
  return out
}

/** Open a shared link: every tweak to its default, then the link's. */
async function openShared(): Promise<void> {
  const q = new URLSearchParams(location.search)
  const view = q.get('view')
  if (!q.has('share')) {
    // The address alone: just the screen, the tweaks stay as they are.
    if (view) {
      await nextTick()
      openView(view)
    }
    return
  }
  for (const id of Object.keys(TWEAKS) as TweakId[]) if (id !== 'deployState') TWEAKS[id].reset()
  const m = Number(q.get('m'))
  if (MILESTONES.some((x) => Number(x.value) === m)) proto.milestone = m
  // A milestone sets some defaults and the page of its own; the link's
  // values go on after, then its screen (the account can move the page).
  await nextTick()
  for (const p of PARTS) {
    const v = q.get(p.key)
    if (v !== null && (p.ok.length === 0 || p.ok.includes(v))) p.set(v)
  }
  await nextTick()
  const app = q.get('app')
  const page = q.get('page')
  // An app opens on its own, as the person who sent it saw it.
  if (view) openView(view)
  else if (app) {
    appsProto.tabs = []
    openAppUrl(app)
  } else if (page) go(page as typeof proto.page)
  // ComfyUI on a workflow, on its Media Assets panel (and the first asset
  // in Inspect asset): ?comfy=assets | inspect. Needs a milestone that
  // opens builds in this window.
  const comfy = q.get('comfy')
  if (comfy === 'assets' || comfy === 'inspect') {
    const inst = instances.value.find((i) => i.kind === 'local') ?? instances.value[0]
    if (inst) {
      graphOpen.assets = true
      graphOpen.inspect = comfy === 'inspect'
      hostActions.launch(inst, 'hero-shot-v4')
    }
  }
  const step = q.get('step')
  if (step && SETUP_SCREENS.some((s) => s.value === step)) showScreen(step as Screen)
  // Off the address, so a reload keeps what's changed after.
  const keep = new URLSearchParams()
  q.forEach((v, k) => (!OWN.has(k) || k === 'theme') && keep.set(k, v))
  history.replaceState(null, '', `${location.pathname}?${keep}`)
}

/** The address bar follows the screen: ?view=<code>, the rest kept. */
function showView(code: string): void {
  const q = new URLSearchParams(location.search)
  if (q.has('share')) return
  q.set('view', code)
  history.replaceState(history.state, '', `${location.pathname}?${q}`)
}

void openShared().then(() => watch(viewCode, showView, { immediate: true }))

/** Copy the link, and say so. The Clipboard API refuses an unfocused
 *  page (a click from DevTools or another window), so the old copy
 *  command stands in. */
export async function copyShareUrl(): Promise<boolean> {
  const url = shareUrl()
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    const t = document.createElement('textarea')
    t.value = url
    t.style.cssText = 'position:fixed;opacity:0'
    document.body.append(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  }
}
