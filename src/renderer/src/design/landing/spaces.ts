import { computed, reactive } from 'vue'
import { proto, toast } from './useProto'

/**
 * Spaces: a studio (the enterprise) serves its own clients. A few studio
 * people build workflows in their environments; each client gets an
 * isolated, branded Space where those workflows show up as Apps or
 * Simplified workflows. Two kinds of people:
 *   Studio  - builds, publishes into spaces, runs them (admin).
 *   Client  - lives inside one space only and runs what was published.
 */

/** App: a form (inputs + Generate). Simplified workflow: the graph,
 *  locked, with only some inputs exposed. */
export type Flavor = 'app' | 'workflow'

export interface CatalogItem {
  id: string
  name: string
  blurb: string
  thumbId: string
  flavor: Flavor
  /** Where it comes from in the studio. */
  source: string
  /** Pinned studio version, or follows the latest. */
  version: string | null
  presets: string[]
  /** Credits per run. */
  cost: number
  runs: number
  visible: boolean
  isNew?: boolean
  /** Each tool runs on its own endpoint - spaces aren't one deployment. */
  endpoint?: Endpoint
}

export interface Endpoint {
  name: string
  gpu: string
  region: string
  /** Scale to zero when idle, or keep warm. */
  warm: boolean
}

export type SpaceRole = 'admin' | 'member' | 'viewer'
export interface SpaceMember {
  name: string
  email: string
  role: SpaceRole
  lastActive: string
  runs: number
}

export type SpaceBuiltin =
  | 'announcement'
  | 'tools'
  | 'recent'
  | 'library'
  | 'guides'
  | 'request'
  | 'usage'
export interface SpaceSection {
  id: string
  title: string
  visible: boolean
  builtin?: SpaceBuiltin
  /** Hand-picked catalog items. */
  pin?: string[]
}

export interface SpaceBrand {
  color: string
  logo: {
    name: string
    mark: string
    /** Brand icon (assets/brands/<icon>.svg); falls back to the letter. */
    icon?: string
    /** Logo tile colours; default: brand colour with white. */
    bg?: string
    fg?: string
  }
  headline: string
  announcement: string
  /** How far the member view takes on the brand's style. */
  theme?: BrandTheme
}

export interface BrandTheme {
  /** Type voice for headings. */
  font: 'sans' | 'condensed' | 'wide' | 'rounded'
  /** Button and card shape. */
  shape: 'sharp' | 'soft' | 'pill'
  uppercase?: boolean
  /** Page background: the brand's own dark, plus a glow tint. */
  surface: string
  /** Text on the brand colour (buttons). */
  onBrand?: string
}

export interface SpaceOutput {
  id: string
  thumbId: string
  tool: string
  by: string
  when: string
  status: 'approved' | 'review' | 'changes'
  fav?: boolean
}

export interface SpaceRequest {
  id: string
  title: string
  by: string
  when: string
  status: 'new' | 'building' | 'shipped'
  note?: string
}

export interface SpaceActivity {
  who: string
  what: string
  when: string
  studio?: boolean
}

export type Access = 'invite' | 'link' | 'public'
export type Payer = 'owner' | 'members' | 'split'

export interface Space {
  id: string
  name: string
  status: 'live' | 'draft' | 'paused'
  domain: string
  region: string
  gpu: 'shared' | 'dedicated'
  brand: SpaceBrand
  sections: SpaceSection[]
  catalog: CatalogItem[]
  members: SpaceMember[]
  /** Monthly credit budget and what's used so far. */
  budget: number
  used: number
  trend: number[]
  billing: { markup: number; alertAt: string; hardStop: boolean; invoice: boolean }
  /** Who can get in: invited people, anyone with the link, or listed publicly. */
  access: Access
  /** Who pays for runs: the owner's budget, each member's own Comfy
   *  credits, or the owner up to an allowance and then the member. */
  payer: Payer
  /** Split: credits per member per month the owner covers. */
  allowance: number
  policies: {
    moderation: 'strict' | 'standard'
    blocklist: string
    approval: boolean
    watermark: boolean
    downloads: boolean
    uploads: boolean
    retention: string
    memberInvites: boolean
    sso: boolean
    domains: string
  }
  library: SpaceOutput[]
  requests: SpaceRequest[]
  activity: SpaceActivity[]
}

/** The studio itself (the enterprise using Comfy). */
export const STUDIO = { name: 'Silverside', mark: 'S' }

export const SPACE_BUILTINS: { key: SpaceBuiltin; title: string; hint: string }[] = [
  { key: 'announcement', title: 'Announcement', hint: 'A note from your studio' },
  { key: 'tools', title: 'Your tools', hint: 'Every app and workflow in the space' },
  { key: 'recent', title: 'Pick up where you left off', hint: "Each person's latest runs" },
  { key: 'library', title: 'Latest outputs', hint: 'Recent results from the team' },
  { key: 'guides', title: 'Guides', hint: 'How to get great results' },
  { key: 'request', title: 'Request a tool', hint: 'Ask the studio for something new' },
  { key: 'usage', title: 'Credits', hint: "What's left this month" }
]

function sections(on: SpaceBuiltin[], pins: SpaceSection[] = []): SpaceSection[] {
  return [
    ...pins,
    ...SPACE_BUILTINS.map((b) => ({
      id: b.key,
      title: b.title,
      builtin: b.key,
      visible: on.includes(b.key)
    }))
  ].sort((a, b) => order(a) - order(b))
}
// Announcement first, then pinned picks, then the rest.
const order = (s: SpaceSection): number =>
  s.builtin === 'announcement'
    ? 0
    : s.pin
      ? 1
      : 2 + SPACE_BUILTINS.findIndex((b) => b.key === s.builtin)

const policies = (p: Partial<Space['policies']> = {}): Space['policies'] => ({
  moderation: 'standard',
  blocklist: '',
  approval: false,
  watermark: false,
  downloads: true,
  uploads: true,
  retention: '90',
  memberInvites: true,
  sso: false,
  domains: '',
  ...p
})

const trend = (seed: number): number[] =>
  Array.from({ length: 14 }, (_, i) => Math.round(40 + 30 * Math.sin(i / 2 + seed) + i * seed * 2))

export const SPACES = reactive<Space[]>([
  {
    id: 'northwind',
    name: 'Nike',
    status: 'live',
    domain: 'nike.comfy.app',
    region: 'EU · Frankfurt',
    gpu: 'dedicated',
    brand: {
      color: '#fa5400',
      logo: { name: 'Nike', mark: 'N', icon: 'nike', bg: '#f5f5f5', fg: '#111111' },
      theme: {
        font: 'condensed',
        shape: 'pill',
        uppercase: true,
        surface: '#0b0b0b',
        onBrand: '#ffffff'
      },
      headline: 'Hi {name}, what are we shooting today?',
      announcement:
        'New: Seasonal backgrounds now has a Winter preset. Packshot cleanup is 2× faster this week.'
    },
    sections: sections(
      ['announcement', 'tools', 'recent', 'request'],
      [{ id: 'pin-start', title: 'Start here', visible: true, pin: ['nw-relight', 'nw-packshot'] }]
    ),
    catalog: [
      {
        id: 'nw-relight',
        name: 'Product relight',
        blurb: 'Drop a product photo, pick a light setup.',
        thumbId: 'template_product_placement~space-nw-relight',
        flavor: 'app',
        source: 'App · Product relight',
        version: 'Product Shots v4',
        presets: ['Studio softbox', 'Golden hour', 'Hard noon'],
        cost: 8,
        runs: 1284,
        visible: true
      },
      {
        id: 'nw-packshot',
        name: 'Packshot cleanup',
        blurb: 'White background, shadows and retouch.',
        thumbId: 'api_google_nano_banana2_image_edit~space-nw-packshot',
        flavor: 'workflow',
        source: 'Workflow · banana-edit-batch.json',
        version: null,
        presets: ['Pure white', 'Soft grey'],
        cost: 5,
        runs: 940,
        visible: true
      },
      {
        id: 'nw-seasonal',
        name: 'Seasonal backgrounds',
        blurb: 'Place products in seasonal scenes.',
        thumbId: 'image_flux2~space-nw-seasonal',
        flavor: 'app',
        source: 'App · Seasonal scenes',
        version: 'Product Shots v4',
        presets: ['Winter', 'Spring', 'Black Friday'],
        cost: 10,
        runs: 512,
        visible: true,
        isNew: true
      },
      {
        id: 'nw-poster',
        name: 'Poster resizer',
        blurb: 'One key visual, every banner size.',
        thumbId: 'templates_graphic_design_recomposer~space-nw-poster',
        flavor: 'app',
        source: 'App · Poster resizer',
        version: null,
        presets: ['Web banners', 'Social', 'In-store'],
        cost: 6,
        runs: 388,
        visible: true
      },
      {
        id: 'nw-video',
        name: 'Product spin video',
        blurb: 'A 5 s turntable from one photo.',
        thumbId: 'video_ltx2_5_i2v~space-nw-video',
        flavor: 'workflow',
        source: 'Workflow · rice-terraces-i2v.json',
        version: 'Video Lab v2',
        presets: ['Turntable', 'Hero push-in'],
        cost: 30,
        runs: 64,
        visible: false
      }
    ],
    members: [
      {
        name: 'Maya Chen',
        email: 'maya@nike.com',
        role: 'admin',
        lastActive: 'Now',
        runs: 412
      },
      {
        name: 'Tom Reyes',
        email: 'tom@nike.com',
        role: 'member',
        lastActive: '2 h ago',
        runs: 288
      },
      {
        name: 'Ana Silva',
        email: 'ana@nike.com',
        role: 'member',
        lastActive: 'Yesterday',
        runs: 190
      },
      {
        name: 'Leo Park',
        email: 'leo@nike.com',
        role: 'viewer',
        lastActive: '3 days ago',
        runs: 0
      },
      {
        name: 'Ivy Brooks',
        email: 'ivy@agency-partner.com',
        role: 'member',
        lastActive: 'Last week',
        runs: 54
      }
    ],
    budget: 60000,
    used: 38420,
    trend: trend(1),
    billing: { markup: 20, alertAt: '80', hardStop: false, invoice: true },
    access: 'invite',
    payer: 'owner',
    allowance: 0,
    policies: policies({ watermark: false, sso: true, domains: 'nike.com' }),
    library: [
      {
        id: 'o1',
        thumbId: 'template_product_placement~space-o1',
        tool: 'Product relight',
        by: 'Maya Chen',
        when: '12 min ago',
        status: 'approved',
        fav: true
      },
      {
        id: 'o2',
        thumbId: 'image_flux2~space-o2',
        tool: 'Seasonal backgrounds',
        by: 'Tom Reyes',
        when: '1 h ago',
        status: 'approved'
      },
      {
        id: 'o3',
        thumbId: 'api_google_nano_banana2_image_edit~space-o3',
        tool: 'Packshot cleanup',
        by: 'Ana Silva',
        when: '2 h ago',
        status: 'approved'
      },
      {
        id: 'o4',
        thumbId: 'templates_graphic_design_recomposer~space-o4',
        tool: 'Poster resizer',
        by: 'Maya Chen',
        when: 'Yesterday',
        status: 'approved'
      },
      {
        id: 'o5',
        thumbId: 'image_krea2_turbo_t2i~space-o5',
        tool: 'Seasonal backgrounds',
        by: 'Ivy Brooks',
        when: 'Yesterday',
        status: 'approved'
      },
      {
        id: 'o6',
        thumbId: 'image_z_image_turbo~space-o6',
        tool: 'Product relight',
        by: 'Tom Reyes',
        when: '2 days ago',
        status: 'approved',
        fav: true
      }
    ],
    requests: [
      {
        id: 'r1',
        title: 'Lifestyle shots with models holding the product',
        by: 'Maya Chen',
        when: '2 days ago',
        status: 'building',
        note: 'Lumen: prototype ready Friday.'
      },
      {
        id: 'r2',
        title: 'Batch mode for Packshot cleanup (50+ images)',
        by: 'Tom Reyes',
        when: 'Last week',
        status: 'new'
      },
      {
        id: 'r3',
        title: 'Black Friday preset',
        by: 'Ana Silva',
        when: '3 weeks ago',
        status: 'shipped'
      }
    ],
    activity: [
      { who: 'Maya Chen', what: 'ran Product relight ×4', when: '12 min ago' },
      {
        who: 'Pablo',
        what: 'updated Seasonal backgrounds to Product Shots v4',
        when: '1 h ago',
        studio: true
      },
      { who: 'Tom Reyes', what: 'requested Batch mode for Packshot cleanup', when: 'Yesterday' },
      { who: 'Maya Chen', what: 'invited ivy@agency-partner.com as Member', when: '2 days ago' },
      { who: 'Pablo', what: 'hid Product spin video', when: 'Last week', studio: true }
    ]
  },
  {
    id: 'halcyon',
    name: 'Coca-Cola',
    status: 'live',
    domain: 'create.coca-cola.com',
    region: 'US · Virginia',
    gpu: 'shared',
    brand: {
      color: '#e41e2b',
      logo: { name: 'Coca-Cola', mark: 'C', icon: 'cocacola', bg: '#e41e2b', fg: '#ffffff' },
      theme: {
        font: 'rounded',
        shape: 'pill',
        surface: '#140708',
        onBrand: '#ffffff'
      },
      headline: 'Welcome back, {name}',
      announcement: 'All outputs are reviewed by the brand team before download.'
    },
    sections: sections(['announcement', 'tools', 'library', 'guides', 'usage']),
    catalog: [
      {
        id: 'hc-retouch',
        name: 'Model photo retouch',
        blurb: 'Skin, stray hairs and colour match.',
        thumbId: 'image_qwen_image_edit_2511~space-hc-retouch',
        flavor: 'workflow',
        source: 'Workflow · angles-sheet.json',
        version: 'My Local 1 v3',
        presets: ['Natural', 'Editorial'],
        cost: 6,
        runs: 702,
        visible: true
      },
      {
        id: 'hc-swatch',
        name: 'Shade swatches',
        blurb: 'Every shade from one hero shot.',
        thumbId: 'image_krea2_turbo_t2i~space-hc-swatch',
        flavor: 'app',
        source: 'App · Shade swatches',
        version: null,
        presets: ['Lipstick', 'Foundation'],
        cost: 4,
        runs: 430,
        visible: true
      },
      {
        id: 'hc-video',
        name: 'Photo to video',
        blurb: 'Subtle motion for social.',
        thumbId: 'video_wan2_2_14B_i2v~space-hc-video',
        flavor: 'app',
        source: 'App · Photo to video',
        version: null,
        presets: ['Hair flip', 'Slow push'],
        cost: 30,
        runs: 121,
        visible: true
      }
    ],
    members: [
      {
        name: 'Priya Nair',
        email: 'priya@coca-cola.com',
        role: 'admin',
        lastActive: '1 h ago',
        runs: 233
      },
      {
        name: 'Jules Martin',
        email: 'jules@coca-cola.com',
        role: 'member',
        lastActive: 'Today',
        runs: 160
      },
      {
        name: 'Brand review',
        email: 'brand@coca-cola.com',
        role: 'viewer',
        lastActive: 'Today',
        runs: 0
      }
    ],
    budget: 25000,
    used: 21900,
    trend: trend(2),
    billing: { markup: 15, alertAt: '80', hardStop: true, invoice: true },
    access: 'invite',
    payer: 'split',
    allowance: 2000,
    policies: policies({
      moderation: 'strict',
      approval: true,
      watermark: true,
      blocklist: 'competitor names, medical claims'
    }),
    library: [
      {
        id: 'h1',
        thumbId: 'image_qwen_image_edit_2511~space-h1',
        tool: 'Model photo retouch',
        by: 'Priya Nair',
        when: '1 h ago',
        status: 'review'
      },
      {
        id: 'h2',
        thumbId: 'image_krea2_turbo_t2i~space-h2',
        tool: 'Shade swatches',
        by: 'Jules Martin',
        when: '3 h ago',
        status: 'approved'
      },
      {
        id: 'h3',
        thumbId: 'video_wan2_2_14B_i2v~space-h3',
        tool: 'Photo to video',
        by: 'Jules Martin',
        when: 'Yesterday',
        status: 'changes'
      },
      {
        id: 'h4',
        thumbId: 'image_z_image_turbo~space-h4',
        tool: 'Model photo retouch',
        by: 'Priya Nair',
        when: 'Yesterday',
        status: 'approved'
      }
    ],
    requests: [
      { id: 'hr1', title: 'Hair colour try-on', by: 'Priya Nair', when: 'Yesterday', status: 'new' }
    ],
    activity: [
      {
        who: 'Brand review',
        what: 'asked for changes on a Photo to video output',
        when: 'Yesterday'
      },
      { who: 'Priya Nair', what: 'ran Model photo retouch ×12', when: '1 h ago' }
    ]
  },
  {
    id: 'atlas',
    name: 'Porsche',
    status: 'live',
    domain: 'porsche.comfy.app',
    region: 'EU · Frankfurt',
    gpu: 'dedicated',
    brand: {
      color: '#c9a45c',
      logo: { name: 'Porsche', mark: 'P', icon: 'porsche', bg: '#0e0e10', fg: '#c9a45c' },
      theme: {
        font: 'wide',
        shape: 'sharp',
        uppercase: true,
        surface: '#0a0a0b',
        onBrand: '#0e0e10'
      },
      headline: 'Porsche creative tools',
      announcement: ''
    },
    sections: sections(['tools', 'recent', 'usage']),
    catalog: [
      {
        id: 'at-config',
        name: 'Configurator renders',
        blurb: 'Any trim, any colour, any backdrop.',
        thumbId: 'image_z_image_turbo~space-at-config',
        flavor: 'app',
        source: 'App · Car configurator',
        version: 'Flux Sandbox v2',
        presets: ['Showroom', 'Coastal road', 'Night city'],
        cost: 12,
        runs: 2210,
        visible: true
      },
      {
        id: 'at-upscale',
        name: '4K upscaler',
        blurb: 'Print-ready from any render.',
        thumbId: 'utility_seedvr2_image_upscale~space-at-upscale',
        flavor: 'app',
        source: 'App · 4K upscaler',
        version: null,
        presets: ['2×', '4×'],
        cost: 3,
        runs: 1830,
        visible: true
      },
      {
        id: 'at-3d',
        name: 'Image to 3D prop',
        blurb: 'Turn a part photo into a 3D model.',
        thumbId: '3d_pixal3d_trellis2_image_to_model~space-at-3d',
        flavor: 'workflow',
        source: 'Workflow · trellis-props.json',
        version: null,
        presets: [],
        cost: 20,
        runs: 96,
        visible: true
      }
    ],
    members: [
      {
        name: 'Erik Lund',
        email: 'erik@porsche.com',
        role: 'admin',
        lastActive: 'Today',
        runs: 610
      },
      {
        name: 'Sara Kim',
        email: 'sara@porsche.com',
        role: 'member',
        lastActive: '2 days ago',
        runs: 340
      }
    ],
    budget: 80000,
    used: 30500,
    trend: trend(3),
    billing: { markup: 25, alertAt: '90', hardStop: false, invoice: true },
    access: 'link',
    payer: 'owner',
    allowance: 0,
    policies: policies({ downloads: true, watermark: true, retention: '365' }),
    library: [
      {
        id: 'a1',
        thumbId: 'image_z_image_turbo~space-a1',
        tool: 'Configurator renders',
        by: 'Erik Lund',
        when: 'Today',
        status: 'approved'
      },
      {
        id: 'a2',
        thumbId: 'utility_seedvr2_image_upscale~space-a2',
        tool: '4K upscaler',
        by: 'Sara Kim',
        when: '2 days ago',
        status: 'approved'
      }
    ],
    requests: [],
    activity: [{ who: 'Erik Lund', what: 'ran Configurator renders ×8', when: 'Today' }]
  },
  {
    id: 'kite',
    name: 'Spotify',
    status: 'draft',
    domain: 'spotify.comfy.app',
    region: 'US · Oregon',
    gpu: 'shared',
    brand: {
      color: '#1ed760',
      logo: { name: 'Spotify', mark: 'S', icon: 'spotify', bg: '#121212', fg: '#1ed760' },
      theme: {
        font: 'sans',
        shape: 'pill',
        surface: '#121212',
        onBrand: '#000000'
      },
      headline: '',
      announcement: ''
    },
    sections: sections(['tools', 'guides']),
    catalog: [
      {
        id: 'kt-char',
        name: 'Character angles',
        blurb: 'Turnarounds from one concept.',
        thumbId: 'image_qwen_image_edit_2511~space-kt-char',
        flavor: 'app',
        source: 'App · Character angles',
        version: null,
        presets: [],
        cost: 8,
        runs: 0,
        visible: true
      }
    ],
    members: [],
    budget: 20000,
    used: 0,
    trend: Array(14).fill(0),
    billing: { markup: 20, alertAt: '80', hardStop: true, invoice: false },
    access: 'public',
    payer: 'members',
    allowance: 0,
    policies: policies(),
    library: [],
    requests: [],
    activity: [{ who: 'Pablo', what: 'created the space', when: 'Today', studio: true }]
  }
])

// Give every published tool its own endpoint (mock).
const GPUS = ['H100 · 80 GB', 'L40S · 48 GB', 'RTX Pro 6000 · 96 GB']
const REGIONS = ['EU · Frankfurt', 'US · Virginia', 'US · Oregon']
SPACES.forEach((sp, si) =>
  sp.catalog.forEach((c, i) => {
    c.endpoint ??= {
      name: `${sp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      gpu: GPUS[(si + i) % GPUS.length]!,
      region: REGIONS[(si + i * 2) % REGIONS.length]!,
      warm: i === 0
    }
  })
)
export const GPU_OPTIONS = GPUS.map((g) => ({ value: g, label: g }))
export const REGION_OPTIONS = REGIONS.map((r) => ({ value: r, label: r }))

export const spaceById = (id: string): Space | undefined => SPACES.find((s) => s.id === id)

/** The space the client portal shows. */
export const currentSpace = computed(() => spaceById(proto.spaceId) ?? SPACES[0]!)
/** The signed-in client (the space's first admin). */
export const clientUser = computed(
  () =>
    currentSpace.value.members.find((m) => m.role === 'admin') ?? {
      name: 'Guest',
      email: 'guest@example.com',
      role: 'member' as SpaceRole,
      lastActive: 'Now',
      runs: 0
    }
)

/** Online right now (mock: active within the last few hours). */
export const isOnline = (m: SpaceMember): boolean => /now|min|h ago/i.test(m.lastActive)

export const ROLE_LABEL: Record<SpaceRole, string> = {
  admin: 'Space admin',
  member: 'Member',
  viewer: 'Viewer'
}
export const FLAVOR_LABEL: Record<Flavor, string> = { app: 'App', workflow: 'Workflow' }

export const GUIDES = [
  {
    title: 'Getting great product shots',
    minutes: 4,
    thumbId: 'template_product_placement~space-getting-great-product-shots'
  },
  {
    title: 'Prompts that stay on brand',
    minutes: 3,
    thumbId: 'image_flux2~space-prompts-that-stay-on-brand'
  },
  {
    title: 'Exporting for web and print',
    minutes: 2,
    thumbId: 'utility_seedvr2_image_upscale~space-exporting-for-web-and-print'
  }
]

/** Open a space's portal, as its client would see it. */
export function previewSpace(id: string): void {
  proto.spaceId = id
  proto.portalPage = 'home'
  proto.viewAs = 'client'
  proto.previewing = true
}

/** Something the workspace can deploy: an app or a workflow. */
export interface Deployable {
  kind: Flavor
  name: string
  thumbId: string
}
export const sourceOf = (t: { kind: Flavor; name: string }): string =>
  `${t.kind === 'app' ? 'App' : 'Workflow'} · ${t.name.replace(/\.json$/, '')}`
const sameSource = (a: string, b: string): boolean =>
  a.replace(/\.json$/, '') === b.replace(/\.json$/, '')

/** Deployed as an endpoint only: called from code, in no space. */
export const API_ONLY = reactive(new Set<string>())

/** Where a tool is deployed: the spaces it's in, and/or API only. */
export function placementsOf(t: { kind: Flavor; name: string }): {
  spaces: Space[]
  api: boolean
} {
  const src = sourceOf(t)
  return {
    spaces: SPACES.filter((s) => s.catalog.some((c) => sameSource(c.source, src))),
    api: API_ONLY.has(src)
  }
}

export interface DeployOptions {
  flavor: Flavor
  gpu: string
  region: string
  warm: boolean
  version: string | null
}

/**
 * Deploy = give the tool an endpoint. Spaces are optional places to put
 * it; with none picked it's an API-only deployment (Build -> Deployments).
 */
export function deployTool(t: Deployable, spaceIds: string[], o: DeployOptions): void {
  const src = sourceOf(t)
  const label = t.name.replace(/\.json$/, '').replaceAll('-', ' ')
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  if (!spaceIds.length) API_ONLY.add(src)
  for (const id of spaceIds) {
    const sp = spaceById(id)
    if (!sp || sp.catalog.some((c) => sameSource(c.source, src))) continue
    sp.catalog.unshift({
      id: `${sp.id}-${slug}-${Date.now()}`,
      name: label.charAt(0).toUpperCase() + label.slice(1),
      blurb: 'New from the workspace.',
      thumbId: t.thumbId,
      flavor: o.flavor,
      source: src,
      version: o.version,
      presets: [],
      cost: 6,
      runs: 0,
      visible: true,
      isNew: true,
      endpoint: {
        name: `${sp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}`,
        gpu: o.gpu,
        region: o.region,
        warm: o.warm
      }
    })
    sp.activity.unshift({ who: 'Pablo', what: `deployed ${label}`, when: 'Just now', studio: true })
  }
  toast(
    spaceIds.length
      ? `Deployed ${label} to ${spaceIds.length} ${spaceIds.length === 1 ? 'space' : 'spaces'}`
      : `Deployed ${label} as an API endpoint`
  )
}

/** Open the Deploy dialog for an app or workflow. */
export function openDeploy(t: Deployable): void {
  proto.deployingTool = t
}

export const ACCESS_LABEL: Record<Access, string> = {
  invite: 'Invite only',
  link: 'Anyone with the link',
  public: 'Public'
}
/** Mock: the signed-in member's own Comfy credit balance. */
export const MEMBER_CREDITS = 4200
/** Credits a member is charged per run when they pay (cost + owner's markup). */
export const memberPrice = (sp: Space, cost: number): number =>
  Math.round(cost * (1 + sp.billing.markup / 100))

export interface NewSpace {
  name: string
  slug: string
  color: string
  headline: string
  access: Access
  payer: Payer
  invites: string[]
  live: boolean
}

/** New space flow: creates the space (draft or live) and returns its id. */
export function createSpace(n: NewSpace): string {
  const id = n.slug || `space-${Date.now()}`
  SPACES.push({
    id,
    name: n.name,
    status: n.live ? 'live' : 'draft',
    domain: `${id}.comfy.app`,
    region: 'EU · Frankfurt',
    gpu: 'shared',
    brand: {
      color: n.color,
      logo: { name: n.name, mark: n.name.charAt(0).toUpperCase() || 'S' },
      headline: n.headline,
      announcement: ''
    },
    sections: sections(['tools', 'recent', 'request']),
    catalog: [],
    members: n.invites.map((email) => ({
      name: email.split('@')[0]!,
      email,
      role: 'member' as SpaceRole,
      lastActive: n.live ? 'Invited' : 'Not invited yet',
      runs: 0
    })),
    budget: 20000,
    used: 0,
    trend: Array(14).fill(0),
    billing: { markup: 20, alertAt: '80', hardStop: true, invoice: false },
    access: n.access,
    payer: n.payer,
    allowance: n.payer === 'split' ? 1000 : 0,
    policies: policies(),
    library: [],
    requests: [],
    activity: [{ who: 'Pablo', what: 'created the space', when: 'Just now', studio: true }]
  })
  return id
}

/** Draft -> live: sends the invites. */
export function goLive(id: string): void {
  const sp = spaceById(id)
  if (!sp) return
  sp.status = 'live'
  sp.members.forEach((m) => {
    if (m.lastActive === 'Not invited yet') m.lastActive = 'Invited'
  })
  sp.activity.unshift({
    who: 'Pablo',
    what: 'went live and sent invites',
    when: 'Just now',
    studio: true
  })
  toast(`${sp.name} is live · ${sp.members.length} invites sent`)
}

/** Heading styles per theme font (system stacks - no font downloads). */
export const THEME_FONT: Record<BrandTheme['font'], Record<string, string>> = {
  condensed: {
    fontFamily: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    fontStretch: 'condensed',
    fontWeight: '900',
    letterSpacing: '-0.02em'
  },
  wide: {
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    fontWeight: '400',
    letterSpacing: '0.14em'
  },
  rounded: {
    fontFamily: 'ui-rounded, "SF Pro Rounded", "Nunito", sans-serif',
    fontWeight: '800',
    letterSpacing: '-0.01em'
  },
  sans: { fontFamily: 'Inter, sans-serif', fontWeight: '800', letterSpacing: '-0.03em' }
}
const RADIUS: Record<BrandTheme['shape'], string> = { sharp: '2px', soft: '10px', pill: '999px' }

/** CSS variables a member view uses to take on the brand. */
export function themeVars(b: SpaceBrand): Record<string, string> {
  const t = b.theme
  return {
    '--brand': b.color,
    '--on-brand': t?.onBrand ?? '#ffffff',
    '--brand-radius': RADIUS[t?.shape ?? 'soft'],
    '--brand-surface': t?.surface ?? '#0c0c0d'
  }
}
