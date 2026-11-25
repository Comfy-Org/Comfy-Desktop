import { HUB_WORKFLOWS, type HubWorkflow } from '../../explore/hubWorkflows'
import { starterOf, type Starter } from '../createStarters'

interface Intent {
  words: RegExp
  match: (w: HubWorkflow) => boolean
  understood: string
}

const has = (w: HubWorkflow, ...bits: string[]): boolean =>
  bits.some((b) => `${w.title} ${w.useCase} ${w.description}`.toLowerCase().includes(b))

const INTENTS: Intent[] = [
  {
    words: /\b(animate|video|clip|move|moving|motion|film|footage)\b/,
    match: (w) => w.media === 'video' && w.useCase === 'Video generation',
    understood: 'A short video from a photo, gentle camera move'
  },
  {
    words: /\b(product|ad|ads|packaging|shop|ecommerce|commerce)\b/,
    match: (w) => w.useCase === 'Product & ads' || has(w, 'background', 'material'),
    understood: 'A product shot on a clean background'
  },
  {
    words: /\b(background|cut ?out|isolate|transparent|remove|white)\b/,
    match: (w) => has(w, 'background'),
    understood: 'Your subject cut out, background removed'
  },
  {
    words: /\b(upscale|sharpen|sharper|enhance|4k|hd|resolution|bigger|print)\b/,
    match: (w) => w.useCase === 'Upscale',
    understood: 'A larger, sharper image with real detail, ready for print'
  },
  {
    words: /\b(3d|mesh|model|sculpt|splat|game asset)\b/,
    match: (w) => w.useCase === '3D',
    understood: 'A 3D model from a single picture'
  },
  {
    words: /\b(music|song|track|beat|soundtrack)\b/,
    match: (w) => has(w, 'music'),
    understood: 'Music from a short description'
  },
  {
    words: /\b(voice|speech|narrat\w*|talk|say|podcast|sfx|sound)\b/,
    match: (w) => w.media === 'audio' || has(w, 'lip sync'),
    understood: 'A voice or sound for your clip'
  },
  {
    words: /\b(character|angles?|turnaround|pose|face|portrait|person)\b/,
    match: (w) => w.useCase === 'Characters & fashion' || has(w, 'angle'),
    understood: 'The same character, from several angles'
  },
  {
    words: /\b(edit|change|fix|replace|swap|retouch|relight)\b/,
    match: (w) => w.useCase === 'Image editing',
    understood: 'An edit to a photo you already have'
  },
  {
    words: /\b(logo|brand|icon|poster|mockup|design)\b/,
    match: (w) => w.useCase === 'Brand & design',
    understood: 'A brand or design asset'
  },
  {
    words: /\b(image|picture|photo|art|illustration|draw|paint|wallpaper)\b/,
    match: (w) => w.useCase === 'Image generation',
    understood: 'A picture made from your words'
  }
]

export interface AgentAnswer {
  prompt: string
  understood: string
  picks: Starter[]
}

export const AGENT_CHIPS = [
  'Animate a photo',
  'Remove a background',
  'Upscale for print',
  'Product shot on white'
]

const VIDEO_SLOTS = ['dove', 'waves', 'reeds']
const TITLE_BONUS = 20

export function answer(prompt: string, max = 3): AgentAnswer {
  const text = prompt.toLowerCase()
  const hits = INTENTS.filter((i) => i.words.test(text))
  const scored = new Map<string, { w: HubWorkflow; score: number }>()
  hits.forEach((intent, rank) => {
    for (const w of HUB_WORKFLOWS) {
      if (!intent.match(w)) continue
      const named = intent.words.test(w.title.toLowerCase()) ? TITLE_BONUS : 0
      const score = (scored.get(w.id)?.score ?? 0) + 10 - rank + named + Math.log10(w.usage + 1)
      scored.set(w.id, { w, score })
    }
  })
  if (!scored.size) {
    const words = text.split(/\W+/).filter((t) => t.length > 2)
    for (const w of HUB_WORKFLOWS) {
      const hay = `${w.title} ${w.useCase} ${w.family} ${w.description}`.toLowerCase()
      const n = words.filter((t) => hay.includes(t)).length
      if (n) scored.set(w.id, { w, score: n * 10 + Math.log10(w.usage + 1) })
    }
  }
  let v = 0
  const picks = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ w }) => starterOf(w, undefined, w.media === 'video' ? VIDEO_SLOTS[v++] : undefined))
  const understood =
    hits[0]?.understood ?? (picks.length ? `Something like “${prompt.trim()}”` : '')
  return { prompt: prompt.trim(), understood, picks }
}

export function quickPicks(prompt: string, max: number): Starter[] {
  return answer(prompt, max).picks
}
