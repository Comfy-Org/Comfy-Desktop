import type { Template } from '../../mock'
import { mock } from '../assets/mock'
import { inputsFor, type InputKind } from './tplInputs'

export type FeedSort = 'recent' | 'popular'

export const FEED_SORTS: { value: FeedSort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' }
]

export interface FeedCreator {
  name: string
  handle: string
}

export interface FeedInput {
  kind: InputKind
  label: string
  pic?: string
}

export interface FeedItem {
  id: string
  pic: string
  clip?: string
  prompt: string
  creator: FeedCreator
  minutesAgo: number
  reused: number
  inputs: FeedInput[]
}

const CREATORS: FeedCreator[] = [
  { name: 'Lina Ortega', handle: 'linaortega' },
  { name: 'Kenji Watanabe', handle: 'kenji.w' },
  { name: 'Amara Okafor', handle: 'amaraframes' },
  { name: 'Theo Lindqvist', handle: 'theo_l' },
  { name: 'Priya Nair', handle: 'priyamakes' },
  { name: 'Mateo Rossi', handle: 'mateorossi' },
  { name: 'Sofia Brandt', handle: 'sofiab' },
  { name: 'Jonah Reyes', handle: 'jonahdraws' },
  { name: 'Mei Chen', handle: 'meichen.studio' },
  { name: 'Oskar Novak', handle: 'oskarnovak' },
  { name: 'Leila Haddad', handle: 'leilahaddad' },
  { name: 'Ravi Desai', handle: 'ravid' },
  { name: 'Nora Feld', handle: 'norafeld' },
  { name: 'Diego Alves', handle: 'diegoalves' }
]

const CLIP_FILES = import.meta.glob<string>('../assets/examples/gv-*.mp4', {
  eager: true,
  import: 'default'
})
const clipOf = (slot: string): string | undefined => CLIP_FILES[`../assets/examples/${slot}.mp4`]

type Entry = [slot: string, prompt: string]

const VIDEO: Entry[] = [
  ['gv-waves', 'Waves at golden hour, soft rack focus'],
  ['gv-horse', 'A horse tail swaying, hazy teal backdrop'],
  ['gv-stone', 'Fog rolling past a lone stone, slow push in'],
  ['gv-barrel', 'Green wave curling, sun through the mist'],
  ['gv-reeds', 'Tall grass swaying in warm backlight'],
  ['gv-boxing', 'Close on fists and eyes, moody gym light'],
  ['gv-smoke', 'Smoke rolling slowly over a dark stage'],
  ['gv-dove', 'A dove crossing the frame, clouds behind'],
  ['gv-lake', 'Soft clouds reflected on rippling water'],
  ['gv-dunes', 'Aerial over sand ridges, long shadows'],
  ['gx-cine-01', 'Rain-slick alley, neon signs, slow dolly'],
  ['gx-cine-05', 'Night harbor, light reflections, slow drift'],
  ['gx-cine-08', 'Face lit by a film projector, dust in the beam'],
  ['gx-cine-10', 'Man in a coat, city at night, wide shot']
]

const ANGLES: Entry[] = [
  ['gx-angles-01', 'Front view, studio, soft key'],
  ['gx-angles-02', 'Full body, monochrome, studio'],
  ['gx-angles-03', 'Three-quarter view, long hair'],
  ['gx-angles-04', 'Profile, white shirt, beauty light'],
  ['gx-angles-05', 'Full shot, glasses, black and white'],
  ['gx-angles-06', 'Standing pose, street outfit'],
  ['gx-angles-07', 'Medium shot, editorial makeup'],
  ['gx-angles-08', 'Medium shot, attitude, studio'],
  ['gx-angles-09', 'Side view, blue light, blonde'],
  ['gx-angles-10', 'Standing against a purple wall'],
  ['character-sheet', 'Character sheet, four angles, neutral grey'],
  ['angles-sheet', 'Turnaround, front, side and back']
]

const UPSCALE: Entry[] = [
  ['gx-upscale-01', 'Leaf texture, fine detail'],
  ['gx-upscale-02', 'Petals, sharp detail'],
  ['gx-upscale-03', 'Macro lily leaves, crisp edges'],
  ['gx-upscale-04', 'Leaf pattern, high detail'],
  ['gx-upscale-05', 'Feather barbs, sharp focus'],
  ['gx-upscale-06', 'Water drops on a feather, 4K'],
  ['gx-upscale-07', 'Macro fruit texture, 4K'],
  ['gx-upscale-08', 'Leaf veins, clean upscale'],
  ['asset-fisherman-portrait', 'Old portrait, restore skin and net detail'],
  ['asset-dancer-smoke', 'Dancer in smoke, keep the grain'],
  ['asset-alpine-lake', 'Alpine lake, 4x, no oversharpening'],
  ['asset-umbrella-crossing', 'Street photo, recover faces in the crowd']
]

const RELIGHT: Entry[] = [
  ['gx-relight-01', 'Dark podium, smoke, top light'],
  ['gx-relight-02', 'Rim light, condensation, dark set'],
  ['gx-relight-03', 'Warm lamp, single source, dark room'],
  ['gx-relight-04', 'Prism, rainbow refraction, black set'],
  ['gx-relight-05', 'Light through glass, spectrum on the wall'],
  ['gx-relight-06', 'Blue glow, reflective black surface'],
  ['gx-relight-07', 'Dark blue podium, gold rim, spot'],
  ['gx-relight-08', 'Backlight, mist, rocky surface'],
  ['gx-relight-09', 'Window light, faded flower, vase'],
  ['gx-relight-10', 'Crystal spheres, purple gel light'],
  ['product-relight', 'Bottle on stone, late sun from the left'],
  ['ex-relight-cafe-after', 'Night after rain, neon reflections']
]

const PRODUCT: Entry[] = [
  ['gx-reshoot-01', 'Silk fabric, warm light, dark set'],
  ['gx-reshoot-02', 'Pastel pink sweep, soft shadow'],
  ['gx-reshoot-03', 'Clean glass bottle, neutral studio'],
  ['gx-reshoot-04', 'Perfume on still water, ripples'],
  ['gx-reshoot-05', 'Home decor shelf, morning light'],
  ['gx-reshoot-06', 'Top-down, bottles, soft shadows'],
  ['gx-reshoot-07', 'Glass, water, natural light'],
  ['gx-reshoot-08', 'Sand, sun, summer skincare'],
  ['gx-reshoot-09', 'Soft greens, dewy, airy'],
  ['gx-reshoot-10', 'Stone, leaves, natural products'],
  ['asset-perfume-stone', 'Cut out the bottle, keep the shadow'],
  ['asset-sneaker-dust', 'Sneaker in a dust cloud, dark backdrop'],
  ['asset-citrus-flatlay', 'Citrus flat lay, swap the cloth for linen'],
  ['asset-mug-morning', 'Mug on a sill, morning steam']
]

const POSTER: Entry[] = [
  ['gx-poster-01', 'Terrazzo frame, centered title'],
  ['gx-poster-02', 'Minimal art print, wide banner'],
  ['gx-poster-03', 'Minimal surreal shapes, poster'],
  ['gx-poster-04', 'Grainy gradient, bold color'],
  ['gx-poster-05', 'Memphis pattern, playful shapes'],
  ['gx-poster-06', '3D geometric shapes, poster'],
  ['gx-poster-07', 'Colorful geometric wallpaper'],
  ['gx-poster-08', 'Abstract 3D elements, story size'],
  ['poster-recompose', 'Recompose for a square post, keep the type'],
  ['logo-texture', 'Logo in brushed chrome, soft studio'],
  ['gx-image-13', 'Retro vaporwave landscape, grid, sun'],
  ['gx-image-06', 'Abstract archway, stone and sky']
]

const THREE_D: Entry[] = [
  ['gx-3d-01', '3D flowers, soft studio'],
  ['gx-3d-02', '3D flower, side view'],
  ['gx-3d-03', 'Isometric donut, blue backdrop'],
  ['gx-3d-04', 'Pink sphere chair, product turn'],
  ['gx-3d-05', 'Sculptural chair, gallery light'],
  ['gx-3d-06', 'Inflatable pastel flower'],
  ['axe-model-00001', 'Low-poly axe, worn wood handle'],
  ['trellis-props', 'Props set, game-ready, clean topology'],
  ['gx-poster-06', 'Stacked shapes, matte clay'],
  ['gx-image-03', 'Giant ring sculpture in the desert'],
  ['gx-image-08', 'Floating slab above still water'],
  ['gx-image-12', 'Pastel fantasy world, soft shapes']
]

const IMAGE: Entry[] = [
  ['gx-image-01', 'Pastel coastline at dawn, dreamy haze'],
  ['gx-cine-02', 'Foggy skyline at night, long lens, haze'],
  ['gx-image-02', 'Rolling hills, soft pink sky, calm'],
  ['gx-cine-03', 'Close portrait, blue practicals, shallow focus'],
  ['gx-image-05', 'Lavender archway, soft light, dreamlike'],
  ['gx-cine-04', 'Neon ticket booth, magenta and teal, 35 mm'],
  ['gx-image-07', 'Huge moon over an abstract landscape'],
  ['gx-cine-06', 'Lone figure at a bus stop, sodium light'],
  ['gx-image-09', 'Surreal dreamscape, soft clouds'],
  ['gx-cine-09', 'Portrait, pink key light, dark set'],
  ['gx-image-10', 'Dunes in purple tones, surreal'],
  ['gx-cine-11', 'Short hair, neon tube in hand, low key'],
  ['gx-image-11', 'Hot air balloon over a dreamscape'],
  ['gx-cine-13', 'Hard light, deep shadows, 85 mm'],
  ['gx-image-14', 'Glass house in the desert, golden hour'],
  ['asset-neon-alley', 'Neon alley after midnight, wet asphalt'],
  ['gx-image-15', 'Floating cloth in an ethereal room'],
  ['asset-forest-deer', 'Deer in a misty forest, first light'],
  ['gx-image-16', 'Purple mountain lake, mirror water'],
  ['asset-lighthouse-storm', 'Lighthouse in a storm, spray, dusk'],
  ['asset-astronaut-sunflowers', 'Astronaut in a sunflower field'],
  ['asset-night-market', 'Night market, steam and lanterns']
]

const INPUT_PICS = [
  'product-ref',
  'pose-ref',
  'asset-actor-ref',
  'asset-headphones-ref',
  'packshot-clean',
  'terraces-still',
  'moodboard-01',
  'moodboard-02'
]

const AGES = [12, 38, 95, 180, 290, 460, 700, 1100, 1500, 2300, 3100, 4400, 5800, 7600, 9900]
const MIN_ITEMS = 12
const MAX_ITEMS = 24

function poolFor(t: Template): Entry[] {
  if (t.category === 'audio') return []
  if (t.category === 'video') return VIDEO
  if (t.category === '3d') return THREE_D
  const id = t.id.toLowerCase()
  if (/angle|character/.test(id)) return ANGLES
  if (/upscale|seedvr/.test(id)) return UPSCALE
  if (/relight/.test(id)) return RELIGHT
  if (/poster|logo|dieline/.test(id)) return POSTER
  if (/background|edit|product|reshoot|swap|vton|fashion/.test(id)) return PRODUCT
  return IMAGE
}

function seedOf(s: string): number {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

function inputsOf(t: Template, n: number): FeedInput[] {
  return inputsFor(t)
    .filter((x) => x.kind !== 'text')
    .map((x, i) => ({
      kind: x.kind,
      label: x.label,
      pic:
        x.kind === 'image'
          ? mock(INPUT_PICS[(n + i) % INPUT_PICS.length]!)
          : x.kind === 'video'
            ? mock(VIDEO[(n + i) % 10]![0])
            : undefined
    }))
}

export function feedFor(t: Template): FeedItem[] {
  const seed = seedOf(t.id)
  const items = poolFor(t)
    .slice(0, MAX_ITEMS)
    .map(([slot, prompt], n): FeedItem | undefined => {
      const pic = mock(slot)
      if (!pic) return undefined
      return {
        id: slot,
        pic,
        clip: clipOf(slot),
        prompt,
        creator: CREATORS[(seed + n * 5) % CREATORS.length]!,
        minutesAgo: AGES[n % AGES.length]! + ((seed >> (n % 8)) % 40),
        reused: 20 + ((seed * (n + 3)) % 1900),
        inputs: inputsOf(t, seed + n)
      }
    })
    .filter((x): x is FeedItem => Boolean(x))
  return items.length >= MIN_ITEMS ? items : []
}

export function sortFeed(items: FeedItem[], by: FeedSort): FeedItem[] {
  return [...items].sort((a, b) =>
    by === 'recent' ? a.minutesAgo - b.minutesAgo : b.reused - a.reused
  )
}

export function fmtAgo(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`
  const h = Math.round(minutes / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'Yesterday'
  return d < 7 ? `${d} days ago` : `${Math.round(d / 7)} wk ago`
}

export const initialOf = (c: FeedCreator): string => c.name.charAt(0)
