import type { AppExample } from './appExamples'

const MEDIA = import.meta.glob<string>('../assets/apps-prod/*.{webp,mp4}', {
  eager: true,
  import: 'default'
})
const media = (file: string): string => MEDIA[`../assets/apps-prod/${file}`] ?? ''

export interface ProdExample {
  title: string
  kind: 'Image' | 'Video'
  ratio: string
}

export interface ProdApp {
  slug: string
  title: string
  blurb: string
  hook: string
  kind: 'Image' | 'Video'
  like: string
  examples: ProdExample[]
  workflow?: 'private'
}

export const PROD_APPS: ProdApp[] = [
  {
    slug: 'remove-background',
    title: 'Remove Background',
    blurb:
      'Drop in a picture or a short video and get the subject cut out, with a see-through background or a solid color.',
    hook: 'Just the subject, nothing else.',
    kind: 'Image',
    like: 'e-background',
    examples: [
      { title: 'A samurai at sunset, cut out', kind: 'Video', ratio: '960 / 960' },
      { title: 'A white tiger carrying a sword', kind: 'Image', ratio: '960 / 543' },
      { title: 'A gold fish brooch held up', kind: 'Image', ratio: '960 / 543' },
      { title: 'A glass piano and its player', kind: 'Image', ratio: '960 / 543' },
      { title: 'White flowers in green flame', kind: 'Image', ratio: '960 / 543' },
      { title: 'A bronze bust on a pedestal', kind: 'Image', ratio: '542 / 960' }
    ]
  },
  {
    slug: 'sdr-to-hdr',
    title: 'SDR to HDR',
    blurb: 'Turn a normal picture or video into HDR, with brighter lights and highlights.',
    hook: 'Brighter lights, deeper highlights.',
    kind: 'Video',
    like: 'e-relight',
    examples: [
      { title: 'Car on fire in the desert', kind: 'Video', ratio: '960 / 540' },
      { title: 'Portrait through glass', kind: 'Video', ratio: '960 / 540' },
      { title: 'Cherry blossom in the sun', kind: 'Video', ratio: '960 / 540' },
      { title: 'Chair in the grass at golden hour', kind: 'Video', ratio: '960 / 540' },
      { title: 'Motorbike through a neon city', kind: 'Video', ratio: '960 / 540' },
      { title: 'Wizard and dragon by firelight', kind: 'Video', ratio: '960 / 540' }
    ]
  },
  {
    slug: 'product-ads',
    title: 'Product Ads',
    blurb:
      'A short vertical video ad from one to three photos of a product: a script, shots with your product in them, a voice, joined into one video.',
    hook: 'A few photos in, a video ad out.',
    kind: 'Video',
    like: 'e-video',
    examples: [
      { title: 'SONUS speaker: stone and shadow', kind: 'Video', ratio: '540 / 960' },
      { title: 'Lillee perfume among lily petals', kind: 'Video', ratio: '960 / 960' },
      { title: 'Peach Konjac Jelly with floating fruit', kind: 'Video', ratio: '960 / 540' },
      { title: 'drank can: orange in suspension', kind: 'Video', ratio: '540 / 960' },
      { title: 'Clear earbuds in their case', kind: 'Video', ratio: '960 / 960' },
      { title: "O'Wior serum in a ribbon of gold", kind: 'Video', ratio: '960 / 540' }
    ]
  },
  {
    slug: 'extend-picture',
    title: 'Extend Picture',
    blurb:
      'Give a picture a new shape, like wide, tall or square, and the rest gets filled in around it.',
    hook: 'Any shape, filled in around it.',
    kind: 'Image',
    like: 'x-poster',
    examples: [
      { title: 'A wide cowboy close-up made tall at 4:5', kind: 'Image', ratio: '768 / 960' },
      { title: 'A wide neon street made square', kind: 'Image', ratio: '960 / 960' },
      { title: 'A tall portrait on scaffolding widened to 4:3', kind: 'Image', ratio: '960 / 720' },
      { title: 'A cowboy cat DJ, zoomed out at 1.25x', kind: 'Image', ratio: '565 / 960' },
      {
        title: 'A square street-style shot made tall for a phone',
        kind: 'Image',
        ratio: '540 / 960'
      },
      { title: 'A wide wireframe cathedral made 4:3', kind: 'Image', ratio: '960 / 720' }
    ]
  },
  {
    slug: 'character-swap',
    title: 'Character Swap',
    blurb:
      'Take a short clip and put someone else in it doing the same moves, from up to three pictures. The result plays next to your clip.',
    hook: 'Someone new, the same moves.',
    kind: 'Video',
    like: 's-jutsu',
    examples: [
      {
        title: 'Skating a coastal road, now in an orange windbreaker',
        kind: 'Video',
        ratio: '960 / 534'
      },
      { title: 'Shoveling snow, now in a patterned blouse', kind: 'Video', ratio: '960 / 534' },
      {
        title: 'Watering the garden, now in a lavender cardigan',
        kind: 'Video',
        ratio: '960 / 534'
      },
      { title: 'Folding laundry, now in a white linen shirt', kind: 'Video', ratio: '960 / 534' },
      {
        title: 'A phone call on a crosswalk, now in a sage hijab',
        kind: 'Video',
        ratio: '960 / 534'
      },
      { title: 'Chopping peppers, now in a navy sweater', kind: 'Video', ratio: '960 / 534' }
    ]
  },
  {
    slug: 'product-swap',
    title: 'Product Swap',
    blurb:
      'Add a short clip and a picture of your product. You get the clip back with your product in place of the thing in it.',
    hook: 'Your product, in the shot.',
    kind: 'Video',
    like: 'e-reshoot',
    workflow: 'private',
    examples: [
      { title: 'Swap the suitcase', kind: 'Video', ratio: '640 / 960' },
      { title: 'Swap the cowboy boot', kind: 'Video', ratio: '768 / 768' },
      { title: 'Swap the sunglasses', kind: 'Video', ratio: '640 / 960' },
      { title: 'Swap the giant shoe', kind: 'Video', ratio: '768 / 768' },
      { title: 'Swap the guitar', kind: 'Video', ratio: '540 / 960' },
      { title: 'Swap the couch', kind: 'Video', ratio: '960 / 540' }
    ]
  }
]

export const prodId = (slug: string): string => `p-${slug}`
export const workflowIsPublic = (id: string): boolean => prodApp(id)?.workflow !== 'private'
export const prodThumbId = (slug: string): string => `prod~${slug}`
export const prodApp = (id: string): ProdApp | undefined =>
  PROD_APPS.find((p) => prodId(p.slug) === id)

export const PROD_STILLS: Record<string, string> = Object.fromEntries(
  PROD_APPS.map((p) => [p.slug, media(`${p.slug}.webp`)])
)
export const prodStill = (slug: string): string => PROD_STILLS[slug] ?? ''
export const prodClip = (slug: string): string => media(`${slug}.mp4`)

export const PROD_EXAMPLES: AppExample[] = PROD_APPS.flatMap((p) =>
  p.examples.map((x, i) => ({
    id: `prod-${p.slug}-${i}`,
    app: prodId(p.slug),
    title: x.title,
    kind: x.kind,
    src: media(`${p.slug}-ex${i}-before.webp`),
    after: media(`${p.slug}-ex${i}-after.webp`),
    ratio: x.ratio
  }))
)

export const PROD_HOOKS: Record<string, string> = Object.fromEntries(
  PROD_APPS.map((p) => [prodId(p.slug), p.hook])
)
