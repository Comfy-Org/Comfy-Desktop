import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { EXPLORE, PROD_LIB_APPS, STARTER_APPS, type LibApp } from '../../appFlow'
import { allWorkflows, type ProjectWorkflow } from '../../gallery'
import { can } from '../../milestones'
import { thumb } from '../../mock'
import { activeInstance, proto } from '../../useProto'
import { MOCK } from '../assets/mock'
import { HUB_WORKFLOWS, hubById, type HubWorkflow } from '../explore/hubWorkflows'
import { match } from '../search/match'
import { firstResultFor, fmtDuration } from '../templateModal/firstResult'
import { fmtGb, targetFor, totalGb } from '../templateModal/templateData'
import { readiness, starterOf, type Starter } from './createStarters'
import { buildOf } from './looks/lookKitB'
import { answer } from './looks/v07Agent'

export type Tone = 'ready' | 'fetch' | 'off'
export type Takes = 'image' | 'video' | 'text'
export type InputKind = 'image' | 'video' | 'audio'
export type CardKind = 'run' | 'download' | 'more' | 'also'
export type MatchLevel = 'strong' | 'good' | 'weak'
export type ChipTone = 'partner' | 'best' | 'download' | 'size' | 'input' | MatchLevel

export interface Found {
  id: string
  kind: 'workflow' | 'app'
  name: string
  meta: string
  image?: string
  score: number
  workflow?: ProjectWorkflow
  app?: LibApp
}

export interface TemplateCard {
  key: string
  kind: CardKind
  starter: Starter
  title: string
  family: string
  tone: Tone
  score: number
  calibrated: number | null
  weak: boolean
  best: boolean
  familyPick: boolean
  partner: boolean
  downloadGb: number
  needs: InputKind[]
}

export interface Chip {
  tone: ChipTone
  label: string
}

export interface SmartAnswer {
  query: string
  matched: string[] | null
  cards: TemplateCard[]
  alsoTry: TemplateCard[]
  workflows: Found[]
  apps: Found[]
  intent: 'open' | 'ask'
}

export type SmartOption =
  | { id: string; kind: 'found'; found: Found }
  | { id: string; kind: 'template'; card: TemplateCard }
  | { id: string; kind: 'agent' }

export const SEARCH_DELAY_MS = 300
export const STRONG_MATCH = 0.85
const BELOW_THRESHOLD = 0.5
const WEAK_MATCH_FLOOR = 0.05
const ALSO_FLOOR_SHORT = 0.42
const ALSO_FLOOR_LONG = 0.2
const AGENT_PICK_FIT = 0.45
const QUICK_CAP = 3
const CARD_CAP = 7
const MATCHED_CAP = 7
const ALSO_CAP = 4
const LONG = 5
const STRONG = 200

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

function needsOf(w: HubWorkflow): InputKind[] {
  const text = `${w.title} ${w.description}`.toLowerCase()
  const takes = takesOf(w)
  const needs: InputKind[] = []
  if (takes === 'image') {
    const two =
      /\b(two|2) (reference |input |source )?(images|pictures|photos)\b|two image inputs|multi ?views?|flf2v|first and last frame/.test(
        text
      )
    needs.push('image', ...(two ? (['image'] as const) : []))
  }
  if (takes === 'video') needs.push('video')
  if (/audio to video|lip ?sync|audio-driven|voice clone/.test(text)) needs.push('audio')
  return needs
}

const roughly = (secs: number): string =>
  secs < 60 ? fmtDuration(secs) : `${Math.round(secs / 60)} min`

export function templateMeta(s: Starter, lead = 'first result '): { meta: string; tone: Tone } {
  const r = readiness(s.template)
  if (r.tone === 'ready') {
    const first = firstResultFor(
      s.template,
      targetFor(s.template, activeInstance.value, proto.signedIn)
    )
    return {
      meta: first ? `Ready · ${lead}~${roughly(first.secs)}` : 'Ready to run',
      tone: 'ready'
    }
  }
  if (r.tone === 'fetch') return { meta: `Needs ${fmtGb(totalGb(s.template))}`, tone: 'fetch' }
  return { meta: r.label, tone: 'off' }
}

export const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

export const edited = (modified: string): string =>
  `Edited ${modified
    .toLowerCase()
    .replace(/ min ago$/, 'm ago')
    .replace(/ hours? ago$/, 'h ago')
    .replace(/ days? ago$/, 'd ago')}`

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
  named: boolean
  fit: number
}

const wholeWord = (text: string, t: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${t.replace(/[.+]/g, '\\$&')}($|[^a-z0-9])`).test(text)

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
  let inName = 0
  let inHay = 0
  for (const t of q.tokens) {
    if (startsWord(lname, t)) {
      s += 40
      inName++
    } else if (startsWord(hay, t)) {
      s += 15
      inHay++
    }
  }
  const covered = inName + inHay
  const fits = q.takes && takes === q.takes
  const clashes = !!(q.takes && !fits && takes)
  if (clashes) s -= 60
  if (fits) s += 30
  const enough = q.tokens.length ? covered / q.tokens.length >= (q.words < LONG ? 0.5 : 0.2) : fits
  if (!(best && q.words < LONG) && !enough) return null
  if (s <= 0) return null
  const named =
    q.words < LONG &&
    (!!(best && best.score >= STRONG) ||
      (q.tokens.length > 0 && q.tokens.every((t) => startsWord(lname, t))))
  const coverage = q.tokens.length ? (inName + inHay * 0.5) / q.tokens.length : 0
  const fit = Math.max(
    0,
    Math.min(1, coverage + (fits ? 0.1 : 0) - (clashes ? 0.3 : 0) + (named ? 0.15 : 0))
  )
  return { score: s, named, fit }
}

function calibrate(m: Scored, q: Query): number {
  const base = m.named ? 0.82 + m.fit * 0.14 : 0.18 + m.fit * 0.6
  const long = q.words >= LONG ? 0.08 : 0
  return Math.max(0.06, Math.min(0.97, base - long))
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

function workflowHits(q: Query): Found[] {
  return [...allWorkflows.value]
    .sort((a, b) => a.age - b.age)
    .flatMap((workflow): Found[] => {
      const build = buildOf(workflow)?.name ?? ''
      const m = score(q, workflow.name, `${workflow.name} ${build} ${workflow.category}`)
      if (!m?.named) return []
      return [
        {
          id: `w:${workflow.id}`,
          kind: 'workflow',
          workflow,
          name: workflow.name,
          meta: edited(workflow.modified),
          image: lastOutput(workflow),
          score: m.score + 20 - Math.min(20, workflow.age / 600)
        }
      ]
    })
}

function appHits(q: Query): Found[] {
  const seen = new Set<string>()
  return apps.value.flatMap(({ app, use }): Found[] => {
    if (seen.has(app.id)) return []
    const m = score(q, app.name, `${app.name} ${app.blurb} ${use}`.toLowerCase())
    if (!m?.named) return []
    seen.add(app.id)
    return [
      {
        id: `a:${app.id}`,
        kind: 'app',
        app,
        name: app.name,
        meta: 'Runs on Cloud',
        image: thumb(app.thumbId),
        score: m.score + Math.log10(app.runs + 1) * 3
      }
    ]
  })
}

const KIND_OF: Record<Tone, CardKind> = { ready: 'run', fetch: 'download', off: 'more' }

function cardOf(w: HubWorkflow, rank: number, calibrated: number | null): TemplateCard {
  const starter = starterOf(w)
  const { tone } = templateMeta(starter, '')
  const weak = calibrated !== null && calibrated < BELOW_THRESHOLD
  return {
    key: `t:${w.id}`,
    kind: weak ? 'also' : KIND_OF[tone],
    starter,
    title: w.title,
    family: w.family,
    tone,
    score:
      rank +
      TONE_BONUS[tone] -
      (tone === 'fetch' ? Math.min(30, totalGb(starter.template)) : 0) +
      Math.log10(w.usage + 1) * 3,
    calibrated,
    weak,
    best: false,
    familyPick: true,
    partner: w.runs === 'cloud',
    downloadGb: tone === 'fetch' ? totalGb(starter.template) : 0,
    needs: needsOf(w)
  }
}

const FAMILIES = [...new Set(HUB_WORKFLOWS.map((w) => w.family))]

const partsOf = (family: string): string[] => family.toLowerCase().split(/[\s-]+/)

function modelNames(q: Query): string[] | null {
  if (!q.tokens.length || q.words >= LONG) return null
  const words = new Set(`${q.raw.toLowerCase()} ${q.phrase}`.split(/[^a-z0-9.]+/).filter(Boolean))
  const named = FAMILIES.filter((f) => {
    const parts = partsOf(f)
    return (parts[0]!.length > 2 ? parts.slice(0, 1) : parts).every((p) => words.has(p))
  })
  if (!named.length) return null
  const familyWords = new Set(named.flatMap(partsOf))
  return q.tokens.every((t) => familyWords.has(t)) ? named : null
}

function familiesTogether(cards: TemplateCard[]): TemplateCard[] {
  const pending = [...cards]
  const rows: TemplateCard[] = []
  while (pending.length > 0) {
    const pick = pending.shift()!
    rows.push(pick)
    const same = pending.filter((other) => other.family === pick.family)
    rows.push(...same.map((row) => ({ ...row, familyPick: false })))
    for (const other of same) pending.splice(pending.indexOf(other), 1)
  }
  return rows
}

const byFit = (a: TemplateCard, b: TemplateCard): number =>
  (b.calibrated ?? 0) - (a.calibrated ?? 0) || b.score - a.score

function lookup(names: string[]): Pick<SmartAnswer, 'cards' | 'alsoTry'> {
  const own = HUB_WORKFLOWS.filter((w) => names.includes(w.family))
    .map((w) => cardOf(w, 0, null))
    .sort((a, b) => b.score - a.score)
  const said = names.map((n) => n.toLowerCase())
  const also = HUB_WORKFLOWS.filter(
    (w) => !names.includes(w.family) && said.some((n) => wholeWord(w.description.toLowerCase(), n))
  )
    .map((w) => ({ ...cardOf(w, 0, null), kind: 'also' as const, weak: true }))
    .slice(0, ALSO_CAP)
  const order: CardKind[] = ['run', 'download', 'more']
  const cards = order.flatMap((k) => own.filter((c) => c.kind === k)).slice(0, MATCHED_CAP)
  return { cards: familiesTogether(cards), alsoTry: also }
}

function ranked(q: Query): Pick<SmartAnswer, 'cards' | 'alsoTry'> {
  const all = HUB_WORKFLOWS.flatMap((w): TemplateCard[] => {
    const takes = takesOf(w)
    const hay = `${w.title} ${w.useCase} ${w.family} ${w.media} ${w.description}`.toLowerCase()
    const m = score(q, w.title, hay, takes)
    return m ? [cardOf(w, m.score, calibrate(m, q))] : []
  }).filter((c) => (c.calibrated ?? 0) >= WEAK_MATCH_FLOOR)
  const run = all.filter((c) => c.kind === 'run').sort(byFit)
  const download = all.filter((c) => c.kind === 'download').sort(byFit)
  const more = all.filter((c) => c.kind === 'more').sort(byFit)
  const top = [run[0], download[0]].filter((c): c is TemplateCard => !!c).sort(byFit)[0]
  const lead =
    run[0] && top && (run[0].calibrated ?? 0) >= (top.calibrated ?? 0) - 0.08 ? run[0] : top
  const cards = [...run, ...download, ...more].slice(0, CARD_CAP)
  if (lead && !cards.includes(lead)) cards.splice(CARD_CAP - 1, 1, lead)
  const leadFirst = lead ? [{ ...lead, best: true }, ...cards.filter((c) => c !== lead)] : cards
  const floor = q.words >= LONG ? ALSO_FLOOR_LONG : ALSO_FLOOR_SHORT
  const shown = new Set(cards.map((c) => c.key))
  const agentPicks =
    q.words >= LONG
      ? answer(q.raw).picks.flatMap((s) => {
          const w = hubById(s.id)
          return w && !shown.has(`t:${w.id}`) ? [cardOf(w, 0, AGENT_PICK_FIT)] : []
        })
      : []
  const picked = new Set(agentPicks.map((c) => c.key))
  const alsoTry = [
    ...agentPicks,
    ...all.filter((c) => c.kind === 'also' && !picked.has(c.key) && (c.calibrated ?? 0) >= floor)
  ]
    .sort(byFit)
    .slice(0, ALSO_CAP)
  return { cards: familiesTogether(leadFirst), alsoTry }
}

export function search(raw: string): SmartAnswer {
  const q = parse(raw)
  const names = modelNames(q)
  const { cards, alsoTry } = names ? lookup(names) : ranked(q)
  const top = (hits: Found[]): Found[] => hits.sort((a, b) => b.score - a.score).slice(0, QUICK_CAP)
  const best = cards.find((c) => c.best)
  const confident =
    !!best && ((best.calibrated ?? 0) >= STRONG_MATCH || (q.words < LONG && !best.weak))
  return {
    query: q.raw,
    matched: names,
    cards,
    alsoTry,
    workflows: top(workflowHits(q)),
    apps: top(appHits(q)),
    intent: confident || (names && cards.length) ? 'open' : 'ask'
  }
}

export function matchLevel(card: TemplateCard): MatchLevel | null {
  if (card.calibrated === null) return null
  if (card.weak) return 'weak'
  return card.calibrated >= STRONG_MATCH ? 'strong' : 'good'
}

const INPUT_LABEL: Record<InputKind, [string, (n: number) => string]> = {
  image: ['Needs an image', (n) => `Needs ${n} images`],
  video: ['Needs a video', (n) => `Needs ${n} videos`],
  audio: ['Needs audio', (n) => `Needs ${n} audio files`]
}

const aboutSize = (gb: number): string =>
  `about ${gb < 1 ? `${Math.round(gb * 1000)} MB` : `${Math.round(gb)} GB`}`

export function chipsOf(card: TemplateCard): Chip[] {
  const list: Chip[] = []
  if (card.best) list.push({ tone: 'best', label: 'Best match' })
  const level = card.familyPick ? matchLevel(card) : null
  if (level && card.calibrated !== null)
    list.push({ tone: level, label: `${Math.round(card.calibrated * 100)}% match` })
  if (card.downloadGb > 0) {
    list.push({ tone: 'download', label: 'Needs download' })
    if (card.downloadGb >= 0.001) list.push({ tone: 'size', label: aboutSize(card.downloadGb) })
  }
  const counts = new Map<InputKind, number>()
  for (const kind of card.needs) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  for (const [kind, n] of counts) {
    const [one, many] = INPUT_LABEL[kind]
    list.push({ tone: 'input', label: n === 1 ? one : many(n) })
  }
  if (card.partner) list.push({ tone: 'partner', label: 'Partner' })
  return list
}

export const needsSignIn = (card: TemplateCard): boolean => card.partner && !proto.signedIn

export function resultsTitle(answer: SmartAnswer): string {
  return answer.matched
    ? `Templates for ${new Intl.ListFormat('en').format(answer.matched)}`
    : 'Templates'
}

export function optionsOf(answer: SmartAnswer): SmartOption[] {
  const agent: SmartOption = { id: 'agent', kind: 'agent' }
  const found = [...answer.workflows, ...answer.apps].map(
    (f): SmartOption => ({ id: f.id, kind: 'found', found: f })
  )
  const card = (c: TemplateCard): SmartOption => ({ id: c.key, kind: 'template', card: c })
  const cards = answer.cards.map(card)
  const also = answer.alsoTry.map(card)
  if (agentLeads(answer)) return [agent, ...found, ...cards, ...also]
  return [...found, ...cards, agent, ...also]
}

export const agentLeads = (answer: SmartAnswer): boolean =>
  answer.intent === 'ask' || !answer.cards.length

function defaultActive(answer: SmartAnswer, options: SmartOption[]): number {
  const id =
    answer.intent === 'ask'
      ? 'agent'
      : (answer.cards.find((c) => c.best)?.key ?? answer.cards[0]?.key ?? 'agent')
  return Math.max(
    0,
    options.findIndex((o) => o.id === id)
  )
}

export function useSmartSearch(query: Ref<string>) {
  const searched = ref('')
  const panelOpen = ref(false)
  const activeIndex = ref(0)
  const inResults = ref(false)
  let pending: ReturnType<typeof setTimeout> | undefined

  const answer = computed(() => (searched.value ? search(searched.value) : null))
  const options = computed(() => (answer.value ? optionsOf(answer.value) : []))
  const shown = computed(() => panelOpen.value && !!answer.value)
  const active = computed(() => options.value[activeIndex.value] ?? null)

  function cancel(): void {
    if (pending !== undefined) clearTimeout(pending)
    pending = undefined
  }

  function run(text: string): void {
    cancel()
    searched.value = text.trim()
    inResults.value = false
    if (answer.value) activeIndex.value = defaultActive(answer.value, options.value)
  }

  watch(query, (text) => {
    cancel()
    inResults.value = false
    if (!text.trim()) {
      searched.value = ''
      panelOpen.value = false
      return
    }
    pending = setTimeout(() => {
      panelOpen.value = true
      run(text)
    }, SEARCH_DELAY_MS)
  })

  onScopeDispose(cancel)

  const isCurrent = computed(() => !!answer.value && searched.value === query.value.trim())

  function flush(): void {
    if (!query.value.trim()) return
    panelOpen.value = true
    if (!isCurrent.value) run(query.value)
  }

  function open(): void {
    if (query.value.trim()) flush()
  }

  function close(): void {
    panelOpen.value = false
    inResults.value = false
  }

  function moveTo(index: number): void {
    panelOpen.value = true
    inResults.value = true
    activeIndex.value = index
  }

  function move(step: number): void {
    const n = options.value.length
    if (!n) return
    moveTo((activeIndex.value + step + n) % n)
  }

  const enterLabel = computed(() => {
    if (!query.value.trim()) return ''
    const option = isCurrent.value && shown.value ? active.value : null
    if (option) {
      if (option.kind === 'agent') return 'Ask agent'
      if (option.kind === 'template' && needsSignIn(option.card)) return 'Sign in to use'
      return option.kind === 'template' && option.card.best && !inResults.value
        ? 'Open best match'
        : 'Open'
    }
    const now = isCurrent.value ? answer.value : search(query.value)
    if (!now || now.intent === 'ask') return 'Ask agent'
    return now.cards.some((c) => c.best) ? 'Open best match' : 'Open'
  })

  return {
    answer,
    options,
    shown,
    active,
    activeIndex,
    inResults,
    panelOpen,
    enterLabel,
    flush,
    open,
    close,
    move,
    moveTo
  }
}

export function verticalNeighbour(
  boxes: { left: number; top: number; width: number }[],
  active: number,
  step: 1 | -1
): number | null {
  const from = boxes[active]
  if (!from) return null
  const centre = (box: { left: number; width: number }): number => box.left + box.width / 2
  const tops = [...new Set(boxes.map((box) => Math.round(box.top)))].sort((a, b) => a - b)
  const row = tops.indexOf(Math.round(from.top))
  const target = tops[(row + step + tops.length) % tops.length]
  let nearest: number | null = null
  let nearestDistance = Infinity
  for (const [index, box] of boxes.entries()) {
    const distance = Math.abs(centre(box) - centre(from))
    if (Math.round(box.top) !== target || distance >= nearestDistance) continue
    nearest = index
    nearestDistance = distance
  }
  return nearest
}
