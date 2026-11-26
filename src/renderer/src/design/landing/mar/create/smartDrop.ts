import { computed, reactive, ref, watch, type Ref } from 'vue'
import { EXPLORE, PROD_LIB_APPS, STARTER_APPS, type LibApp } from '../../appFlow'
import { allWorkflows, type ProjectWorkflow } from '../../gallery'
import { can } from '../../milestones'
import { thumb } from '../../mock'
import { HUB_WORKFLOWS, type HubWorkflow } from '../explore/hubWorkflows'
import { match } from '../search/match'
import { totalGb } from '../templateModal/templateData'
import { starterOf, type Starter } from './createStarters'
import { buildOf } from './looks/lookKitB'
import { edited, lastOutput, templateMeta, type Tone } from './smartSearch'

export { lastOutput }
export type Takes = 'image' | 'video' | 'text'

export type Row =
  | { id: string; kind: 'agent'; index: number }
  | { id: string; kind: 'suggest'; text: string; recent: boolean; index: number }
  | (Found & { index: number })

type Found = {
  id: string
  name: string
  at: number[]
  sub: string
  meta: string
  tone: Tone
  image?: string
  score: number
} & (
  | { kind: 'workflow'; workflow: ProjectWorkflow }
  | { kind: 'template'; starter: Starter }
  | { kind: 'app'; app: LibApp }
)

export interface Group {
  name: string
  rows: Row[]
}

export interface Results {
  groups: Group[]
  rows: Row[]
  intent: 'open' | 'ask'
  found: number
}

const CAP = 3
const LONG = 5
const STRONG = 200
const RELEVANT = 0.4

const ALIASES: [RegExp, string][] = [
  [/\b(bg|backdrop)\b/g, 'background'],
  [/\b(cut ?out|isolate|transparent)\b/g, 'remove background'],
  [/\b(i2v|img2vid|animate|animated|bring (it )?to life)\b/g, 'image to video'],
  [/\b(t2i|txt2img|text2img)\b/g, 'text to image'],
  [/\b(t2v|txt2vid|text2video)\b/g, 'text to video'],
  [/\b(4k|8k|enhance|sharpen|sharper|hi-?res|enlarge|bigger|upscaler|upres)\b/g, 'upscale'],
  [/\b(tts|narrate|narration|voice ?over)\b/g, 'text to speech'],
  [/\b(song|soundtrack|beat|jingle)\b/g, 'music'],
  [/\b(sfx|foley)\b/g, 'sound effects'],
  [/\b(mesh|sculpt|3d model)\b/g, '3d model'],
  [/\b(nb|nanobanana)\b/g, 'nano banana'],
  [/\b(turnaround|angles)\b/g, 'multiple angles'],
  [/\b(lipsync)\b/g, 'lip sync'],
  [/\b(retouch|inpaint)\b/g, 'edit']
]

const FILE_INTENTS: [RegExp, Takes][] = [
  [
    /\b(my|this|your|our|from an?|of an?) (photo|image|picture|pic|selfie|portrait|drawing|sketch)s?\b/,
    'image'
  ],
  [/\b(my|this|your|our|from an?) (video|clip|footage|recording)s?\b/, 'video']
]

const STOP = new Set(
  'a an the my me i to of on in at for with and or from this that your our it into make want please some can you'.split(
    ' '
  )
)

const TAKES_LABEL: Record<Takes, string> = {
  image: 'Takes an image',
  video: 'Takes a video',
  text: 'From a prompt'
}

function takesOf(w: HubWorkflow): Takes {
  const t = w.title.toLowerCase()
  if (
    /video (upscale|enhance|inpainting|to)|depth map|cast swap|from video|motion transfer|replacement/.test(
      t
    )
  )
    return 'video'
  if (/text to|text prompt/.test(t)) return 'text'
  if (w.useCase === 'Image generation' || w.useCase === 'Audio') return 'text'
  return 'image'
}

interface Query {
  raw: string
  phrase: string
  tokens: string[]
  takes?: Takes
  words: number
}

const expand = (text: string): string =>
  ALIASES.reduce((s, [re, to]) => s.replace(re, to), text)
    .replace(/[^a-z0-9.+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function parse(raw: string): Query {
  const lower = raw
    .toLowerCase()
    .replace(/[‘’“”"]/g, '')
    .trim()
  const file = FILE_INTENTS.find(([re]) => re.test(lower))
  const rest = file ? lower.replace(file[0], ' ') : lower
  const phrase = expand(rest)
  const tokens = [
    ...new Set(
      phrase
        .split(/[\s-]+/)
        .map((t) => t.replace(/^\.+|\.+$/g, ''))
        .filter((t) => t.length > 1 && !STOP.has(t))
    )
  ]
  return {
    raw: raw.trim(),
    phrase,
    tokens,
    takes: file?.[1],
    words: lower.split(/\s+/).filter(Boolean).length
  }
}

interface Scored {
  score: number
  at: number[]
  named: boolean
}

const startsWord = (text: string, t: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${t.replace(/[.+]/g, '\\$&')}`).test(text)

function score(q: Query, name: string, hay: string, takes?: Takes): Scored | null {
  const lname = `${name.toLowerCase()} ${expand(name.toLowerCase())}`
  const direct = match(name, q.raw)
  const aliased = q.phrase && q.phrase !== q.raw.toLowerCase() ? match(name, q.phrase) : null
  const best = [direct, aliased].reduce<ReturnType<typeof match>>(
    (a, b) => (b && (!a || b.score > a.score) ? b : a),
    null
  )
  let s = best && q.words < LONG ? best.score : 0
  let covered = 0
  for (const t of q.tokens) {
    if (startsWord(lname, t)) {
      s += 40
      covered++
    } else if (startsWord(hay, t)) {
      s += 15
      covered++
    }
  }
  const fits = q.takes && takes === q.takes
  if (q.takes && !fits && takes) s -= 60
  if (fits) s += 30
  const enough = q.tokens.length ? covered / q.tokens.length >= (q.words < LONG ? 0.5 : 0.2) : fits
  if (!(best && q.words < LONG) && !enough) return null
  if (s <= 0) return null
  const named =
    q.words < LONG &&
    (!!(best && best.score >= STRONG) ||
      (q.tokens.length > 0 && q.tokens.every((t) => startsWord(lname, t))))
  return { score: s, at: best?.at ?? [], named }
}

const TONE_BONUS: Record<Tone, number> = { ready: 30, fetch: 0, off: -30 }

const apps = computed<{ app: LibApp; use: string }[]>(() =>
  can.value.onboarding
    ? PROD_LIB_APPS.map((app) => ({ app, use: '' }))
    : [
        ...STARTER_APPS.map((app) => ({ app, use: '' })),
        ...EXPLORE.flatMap((s) => s.apps.map((app) => ({ app, use: s.title })))
      ]
)

interface Hit {
  row: Found
  named: boolean
}

function workflowHits(q: Query): Hit[] {
  return [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .flatMap((workflow): Hit[] => {
      const build = buildOf(workflow)?.name ?? ''
      const m = score(q, workflow.name, `${workflow.name} ${build} ${workflow.category}`)
      if (!m) return []
      return [
        {
          named: m.named,
          row: {
            id: `w:${workflow.id}`,
            kind: 'workflow',
            workflow,
            name: workflow.name,
            at: m.at,
            sub: build,
            meta: edited(workflow.modified),
            tone: 'ready',
            image: lastOutput(workflow),
            score: m.score + 20 - Math.min(20, workflow.age / 600)
          }
        }
      ]
    })
}

function templateHits(q: Query): Hit[] {
  return HUB_WORKFLOWS.flatMap((w): Hit[] => {
    const takes = takesOf(w)
    const hay = `${w.title} ${w.useCase} ${w.family} ${w.media} ${w.description}`.toLowerCase()
    const m = score(q, w.title, hay, takes)
    if (!m) return []
    const starter = starterOf(w)
    const { meta, tone } = templateMeta(starter, '')
    return [
      {
        named: m.named,
        row: {
          id: `t:${w.id}`,
          kind: 'template',
          starter,
          name: w.title,
          at: m.at,
          sub: `${w.family} · ${TAKES_LABEL[takes]}`,
          meta,
          tone,
          image: starter.poster,
          score:
            m.score +
            TONE_BONUS[tone] -
            (tone === 'fetch' ? Math.min(30, totalGb(starter.template)) : 0) +
            Math.log10(w.usage + 1) * 3
        }
      }
    ]
  })
}

function appHits(q: Query): Hit[] {
  return apps.value.flatMap(({ app, use }): Hit[] => {
    const m = score(q, app.name, `${app.name} ${app.blurb} ${use}`.toLowerCase())
    if (!m) return []
    return [
      {
        named: m.named,
        row: {
          id: `a:${app.id}`,
          kind: 'app',
          app,
          name: app.name,
          at: m.at,
          sub: app.blurb,
          meta: 'Ready · runs on Cloud',
          tone: 'ready',
          image: thumb(app.thumbId),
          score: m.score + TONE_BONUS.ready + Math.log10(app.runs + 1) * 3
        }
      }
    ]
  })
}

const top = (hits: Hit[]): Hit[] => hits.sort((a, b) => b.row.score - a.row.score).slice(0, CAP)

export function search(raw: string): Results {
  const q = parse(raw)
  const all = [
    { name: 'Your workflows', hits: workflowHits(q) },
    { name: 'Templates', hits: templateHits(q) },
    { name: 'Apps', hits: appHits(q) }
  ]
  const best = Math.max(0, ...all.flatMap((g) => g.hits.map((h) => h.row.score)))
  const found = all
    .map((g) => ({
      name: g.name,
      hits: top(g.hits.filter((h) => h.named || h.row.score >= best * RELEVANT))
    }))
    .filter((g) => g.hits.length)
    .sort((a, b) => b.hits[0]!.row.score - a.hits[0]!.row.score)
  let index = 0
  const agent: Row = { id: 'agent', kind: 'agent', index: index++ }
  const groups: Group[] = [
    { name: '', rows: [agent] },
    ...found.map((g) => ({
      name: g.name,
      rows: g.hits.map((hit): Row => ({ ...hit.row, index: index++ }))
    }))
  ]
  const lead = found[0]?.hits[0]
  return {
    groups,
    rows: groups.flatMap((g) => g.rows),
    intent: lead?.named ? 'open' : 'ask',
    found: index - 1
  }
}

export const EXAMPLES = [
  'Animate my photo',
  'Remove bg',
  'Upscale to 4K',
  'A cozy cabin in the snow at dusk, shot on film'
]

const RECENT_KEY = 'comfy.design.mar.composerSearch.recent'
const SEEDED = ['wan 2.2', 'product shot on white']
const RECENT_MAX = 3

export const recentSearches = reactive<{ list: string[] }>({
  list: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')
      return Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : SEEDED
    } catch {
      return SEEDED
    }
  })()
})

export function remember(text: string): void {
  const t = text.trim()
  if (!t) return
  recentSearches.list = [
    t,
    ...recentSearches.list.filter((s) => s.toLowerCase() !== t.toLowerCase())
  ].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.list))
  } catch {
    return
  }
}

function suggestions(): Results {
  let index = 0
  const groups: Group[] = [
    {
      name: 'Recent searches',
      rows: recentSearches.list.map(
        (text): Row => ({ id: `r:${text}`, kind: 'suggest', text, recent: true, index: index++ })
      )
    },
    {
      name: 'Try',
      rows: EXAMPLES.map(
        (text): Row => ({ id: `x:${text}`, kind: 'suggest', text, recent: false, index: index++ })
      )
    }
  ].filter((g) => g.rows.length)
  return { groups, rows: groups.flatMap((g) => g.rows), intent: 'ask', found: 0 }
}

export function useSmartSearch(query: Ref<string>) {
  const q = computed(() => query.value.trim())
  const results = computed(() => (q.value ? search(q.value) : suggestions()))
  const active = ref(-1)
  watch(results, (r) => (active.value = !q.value ? -1 : r.intent === 'open' ? 1 : 0), {
    immediate: true
  })
  const current = computed(() => results.value.rows[active.value])
  const enterLabel = computed(() => {
    const row = current.value
    if (!q.value && !row) return ''
    if (!row || row.kind === 'agent') return 'Ask agent'
    return row.kind === 'suggest' ? 'Search' : 'Open'
  })
  function move(by: number): void {
    const n = results.value.rows.length
    if (!n) return
    active.value = active.value < 0 ? (by > 0 ? 0 : n - 1) : (active.value + by + n) % n
  }
  return { q, results, active, current, enterLabel, move }
}
