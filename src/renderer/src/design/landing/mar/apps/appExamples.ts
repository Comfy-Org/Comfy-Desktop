import { reactive } from 'vue'
import { EXAMPLES } from '../userStates/examples'
import { mock } from '../assets/mock'
import reshootClip from '../assets/examples/reshoot-a-video.mp4'
import jutsuClip from '../assets/examples/openjutsu.mp4'

/**
 * Every example of every app, from Milestone 2: what went in, what came out
 * and the words it ran with. Apps › Examples lists them all, whatever app
 * made them; an app's page lists its own, to start from one like a
 * template. Home's examples come first, each as its app's lead example,
 * with the same picture.
 */
export interface AppExample {
  id: string
  app: string
  title: string
  kind: 'Image' | 'Video'
  src: string
  after: string
  /** The words it ran with, filled into the app's text input. */
  prompt?: string
  /** The picture's shape, so the Gallery's masonry keeps it whole. */
  ratio?: string
  /** A video's clip, played on hover, and its length. */
  video?: string
  duration?: string
}

// The video examples' clips (what Re-shoot a video and Openjutsu made).
const CLIPS: Record<string, { video: string; duration: string }> = {
  's-reshoot': { video: reshootClip, duration: '0:06' },
  's-jutsu': { video: jutsuClip, duration: '0:06' }
}

const own = (id: string, app: string, title: string, prompt: string): AppExample => ({
  id,
  app,
  title,
  kind: 'Image',
  src: mock(id),
  after: mock(`${id}-after`),
  prompt
})

// The Gallery's stock pictures, one per example, spread across the
// Catalog's image apps: slot (gx-*), app, title, prompt, shape.
const GALLERY: [string, string, string, string, string][] = [
  [
    'cine-01',
    's-cine',
    'Neon alley after midnight',
    'Rain-slick alley, neon signs, anamorphic flare',
    '960 / 1444'
  ],
  ['image-01', 's-image', 'Dreamy coast', 'Pastel coastline at dawn, dreamy haze', '960 / 539'],
  ['angles-01', 'x-angles', 'Blue jacket, front', 'Front view, studio, soft key', '960 / 1440'],
  ['relight-01', 'x-relight', 'Podium in smoke', 'Dark podium, smoke, top light', '960 / 539'],
  ['reshoot-01', 'x-reshoot', 'Gold on silk', 'Silk fabric, warm light, dark set', '960 / 539'],
  ['poster-01', 'x-poster', 'Terrazzo frame', 'Terrazzo frame, centered title', '960 / 1680'],
  ['3d-01', 'x-3d', 'Blooming flowers', '3D flowers, soft studio', '960 / 960'],
  ['upscale-01', 'x-upscale', 'Leaf veins in 4K', 'Leaf texture, fine detail', '960 / 679'],
  [
    'cine-02',
    's-cine',
    'City lights in fog',
    'Foggy skyline at night, long lens, haze',
    '960 / 640'
  ],
  ['image-02', 's-image', 'Soft hills', 'Rolling hills, soft pink sky, calm', '960 / 960'],
  [
    'angles-02',
    'x-angles',
    'Suit in black and white',
    'Full body, monochrome, studio',
    '960 / 541'
  ],
  [
    'relight-02',
    'x-relight',
    'Iced coffee, rim light',
    'Rim light, condensation, dark set',
    '960 / 539'
  ],
  ['reshoot-02', 'x-reshoot', 'Pink backdrop', 'Pastel pink sweep, soft shadow', '960 / 640'],
  ['poster-02', 'x-poster', 'Minimal print', 'Minimal art print, wide banner', '960 / 480'],
  ['3d-02', 'x-3d', 'Single bloom', '3D flower, side view', '960 / 640'],
  ['upscale-02', 'x-upscale', 'Macro flower', 'Petals, sharp detail', '960 / 640'],
  [
    'cine-03',
    's-cine',
    'Blue light portrait',
    'Close portrait, blue practicals, shallow focus',
    '960 / 640'
  ],
  ['image-03', 's-image', 'Circle of life', 'Surreal landscape, giant ring, desert', '960 / 1280'],
  [
    'angles-03',
    'x-angles',
    'Red jacket, three quarter',
    'Three-quarter view, long hair',
    '960 / 1440'
  ],
  ['relight-03', 'x-relight', 'Desk lamp glow', 'Warm lamp, single source, dark room', '960 / 960'],
  ['reshoot-03', 'x-reshoot', 'Minimal glass', 'Clean glass bottle, neutral studio', '960 / 1440'],
  ['poster-03', 'x-poster', 'Surreal minimal', 'Minimal surreal shapes, poster', '960 / 1404'],
  ['3d-03', 'x-3d', 'Isometric donut', 'Isometric donut, blue backdrop', '960 / 1440'],
  ['upscale-03', 'x-upscale', 'Lily leaves', 'Macro lily leaves, crisp edges', '960 / 640'],
  [
    'cine-04',
    's-cine',
    'Ticket booth glow',
    'Neon ticket booth, magenta and teal, 35 mm',
    '960 / 640'
  ],
  ['image-04', 's-image', 'Pastel valley', 'Valley in pastel tones, morning mist', '960 / 640'],
  [
    'angles-04',
    'x-angles',
    'White shirt, profile',
    'Profile, white shirt, beauty light',
    '960 / 1440'
  ],
  ['relight-04', 'x-relight', 'Prism light', 'Prism, rainbow refraction, black set', '960 / 1440'],
  ['reshoot-04', 'x-reshoot', 'Floating on water', 'Perfume on still water, ripples', '960 / 1439'],
  ['poster-04', 'x-poster', 'Grainy gradient', 'Grainy gradient, bold color', '960 / 1440'],
  ['3d-04', 'x-3d', 'Sphere chair', 'Pink sphere chair, product turn', '960 / 1372'],
  ['upscale-04', 'x-upscale', 'Leaf line art', 'Leaf pattern, high detail', '960 / 640'],
  [
    'cine-05',
    's-cine',
    'Red and blue on water',
    'Night harbor, light reflections, slow drift',
    '960 / 642'
  ],
  [
    'image-05',
    's-image',
    'Lavender archway',
    'Lavender archway, soft light, dreamlike',
    '960 / 1404'
  ],
  [
    'angles-05',
    'x-angles',
    'Glasses, full shot',
    'Full shot, glasses, black and white',
    '960 / 1440'
  ],
  ['relight-05', 'x-relight', 'Spectrum', 'Light through glass, spectrum on wall', '960 / 640'],
  ['reshoot-05', 'x-reshoot', 'Bottles at home', 'Home decor shelf, morning light', '960 / 641'],
  ['poster-05', 'x-poster', 'Memphis', 'Memphis pattern, playful shapes', '960 / 1441'],
  ['3d-05', 'x-3d', 'Avant-garde chair', 'Sculptural chair, gallery light', '960 / 1403'],
  ['upscale-05', 'x-upscale', 'Peacock feather', 'Feather barbs, sharp focus', '960 / 641'],
  ['cine-06', 's-cine', 'Last bus home', 'Lone figure at a bus stop, sodium light', '960 / 1440'],
  ['image-06', 's-image', 'Stone arch', 'Abstract archway, stone and sky', '960 / 539'],
  ['angles-06', 'x-angles', 'Street style', 'Standing pose, fashionable outfit', '960 / 1440'],
  ['relight-06', 'x-relight', 'Glowing jar', 'Blue glow, reflective black surface', '960 / 539'],
  ['reshoot-06', 'x-reshoot', 'From above', 'Top-down, bottles, soft shadows', '960 / 1439'],
  ['poster-06', 'x-poster', 'Geometric stack', '3D geometric shapes, poster', '960 / 1200'],
  ['3d-06', 'x-3d', 'Inflatable flower', 'Inflatable pastel flower', '960 / 1405'],
  ['upscale-06', 'x-upscale', 'Feather with drops', 'Water drops on feather, 4K', '960 / 960'],
  [
    'cine-07',
    's-cine',
    'Street lights in grain',
    'Film grain, blurred street lights, handheld',
    '960 / 1443'
  ],
  ['image-07', 's-image', 'Moonrise', 'Huge moon over an abstract landscape', '960 / 1440'],
  ['angles-07', 'x-angles', 'Makeup, medium shot', 'Medium shot, editorial makeup', '960 / 1440'],
  ['relight-07', 'x-relight', 'Gold rim podium', 'Dark blue podium, gold rim, spot', '960 / 538'],
  ['reshoot-07', 'x-reshoot', 'Still life with water', 'Glass, water, natural light', '960 / 1440'],
  ['poster-07', 'x-poster', 'Color blocks', 'Colorful geometric wallpaper', '960 / 1680'],
  ['upscale-07', 'x-upscale', 'Pineapple skin', 'Macro fruit texture, 4K', '960 / 641'],
  [
    'cine-08',
    's-cine',
    'Projector light',
    'Face lit by a film projector, dust in the beam',
    '960 / 540'
  ],
  ['image-08', 's-image', 'Floating slab', 'Rectangle floating above still water', '960 / 640'],
  ['angles-08', 'x-angles', 'Cool pose', 'Medium shot, attitude, studio', '960 / 1440'],
  ['relight-08', 'x-relight', 'Backlit bottle', 'Backlight, mist, rocky surface', '960 / 539'],
  ['reshoot-08', 'x-reshoot', 'On the beach', 'Sand, sun, summer skincare', '960 / 1440'],
  ['poster-08', 'x-poster', 'Abstract elements', 'Abstract 3D elements, story size', '960 / 1440'],
  ['upscale-08', 'x-upscale', 'Green veins', 'Leaf veins, clean upscale', '960 / 539'],
  ['cine-09', 's-cine', 'Pink key light', 'Portrait, pink key light, dark set', '960 / 960'],
  ['image-09', 's-image', 'Dreamland', 'Surreal dreamscape, soft clouds', '960 / 540'],
  ['angles-09', 'x-angles', 'Blue light, side', 'Side view, blue light, blonde', '960 / 640'],
  ['relight-09', 'x-relight', 'Faded bloom', 'Window light, faded flower, vase', '960 / 1440'],
  ['reshoot-09', 'x-reshoot', 'Fresh and dreamy', 'Soft greens, dewy, airy', '960 / 1365'],
  ['cine-10', 's-cine', 'Night walk', 'Man in a coat, city at night, wide shot', '960 / 640'],
  ['image-10', 's-image', 'Purple dunes', 'Dunes in purple tones, surreal', '960 / 960'],
  ['angles-10', 'x-angles', 'Purple wall', 'Standing against a purple wall', '960 / 1440'],
  ['relight-10', 'x-relight', 'Crystal balls', 'Crystal spheres, purple gel light', '960 / 1440'],
  ['reshoot-10', 'x-reshoot', 'Natural set', 'Stone, leaves, natural products', '960 / 1440'],
  ['cine-11', 's-cine', 'Holding the neon', 'Short hair, neon tube in hand, low key', '960 / 1440'],
  ['image-11', 's-image', 'Balloon over dreams', 'Hot air balloon over a dreamscape', '960 / 1613'],
  ['cine-12', 's-cine', 'Colors on the back', 'Back view, colored light wash, studio', '960 / 640'],
  ['image-12', 's-image', 'Pastel fantasy', 'Pastel fantasy world, soft shapes', '960 / 1404'],
  ['cine-13', 's-cine', 'Dramatic close-up', 'Hard light, deep shadows, 85 mm', '960 / 1440'],
  ['image-13', 's-image', 'Vaporwave sunset', 'Retro vaporwave landscape, grid, sun', '960 / 640'],
  ['cine-14', 's-cine', 'Lights in motion', 'Bokeh, city at night, long exposure', '960 / 639'],
  ['image-14', 's-image', 'Glass house', 'Glass house in the desert, golden hour', '960 / 549'],
  ['image-15', 's-image', 'Ethereal cloth', 'Floating cloth in an ethereal room', '960 / 640'],
  ['image-16', 's-image', 'Mountain lake', 'Purple mountain lake, mirror water', '960 / 1404']
]

export const APP_EXAMPLES: AppExample[] = [
  ...EXAMPLES.map((x) => ({
    id: `home-${x.app}`,
    app: x.app,
    title: x.does,
    kind: x.kind,
    src: x.src,
    after: x.after,
    prompt:
      x.app === 's-cine' ? 'A woman on a rooftop at night, city lights, slow push in' : undefined,
    ...CLIPS[x.app]
  })),
  own('ex-cine-diner', 's-cine', 'Night diner, neon noir', 'Neon noir, rain on the window, 35 mm'),
  own(
    'ex-cine-beach',
    's-cine',
    'Golden hour on the beach',
    'Golden hour, sun flare, warm film grain'
  ),
  own(
    'ex-relight-room',
    'e-relight',
    'Daylight room to lamplight',
    'Night, one warm lamp, blue window'
  ),
  own(
    'ex-relight-cafe',
    'e-relight',
    'A café after the rain',
    'Night after rain, neon reflections'
  ),
  own(
    'ex-reshoot-sneaker',
    'e-reshoot',
    'Sneaker on volcanic rock',
    'Wet black rock, mist, rim light'
  ),
  own(
    'ex-reshoot-perfume',
    'e-reshoot',
    'Perfume with peonies',
    'Marble pedestal, peonies, morning light'
  ),
  ...GALLERY.map(([slot, app, title, prompt, ratio]) => ({
    id: `gx-${slot}`,
    app,
    title,
    kind: 'Image' as const,
    src: mock(`gx-${slot}`),
    after: mock(`gx-${slot}`),
    prompt,
    ratio
  }))
]

export const examplesOf = (app: string): AppExample[] => APP_EXAMPLES.filter((x) => x.app === app)

/** Which example an app opens on: the one picked in Apps › Examples, else
 *  its lead one. */
export const openOn = reactive<Record<string, string>>({})
