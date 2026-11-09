import { watch } from 'vue'
import { allAssets } from '../../gallery'
import { collection } from './collection'
import type { ItemStatus } from './MarStatus.vue'

/** Assets in Mar's proposal: the gallery's, plus the runs still in
 *  flight. In memory, shared by Assets and each project's Assets tab. */
export interface MarAsset {
  id: string
  name: string
  type: 'image' | 'video' | '3d' | 'audio' | 'text' | 'other'
  source: 'local' | 'cloud'
  thumbId?: string
  /** A picture of its own (a file just uploaded), over the mock's. */
  src?: string
  project?: string
  size: string
  sizeMb: number
  age: number
  when: string
  fav?: boolean
  /** The build (instance id) whose catalog holds it. */
  envId?: string
  status?: ItemStatus
  statusLabel?: string
}

// Runs in flight, like the queue's results in the product: they land
// here first and become assets when they finish.
const RUNS: MarAsset[] = [
  {
    id: 'run-1',
    name: 'hero_shot_00013.png',
    type: 'image',
    source: 'local',
    thumbId: 'image_z_image_turbo',
    project: 'Hero shots',
    envId: 'local-1',
    size: '—',
    sizeMb: 0,
    age: -3,
    when: 'Now',
    status: 'running',
    statusLabel: 'Generating · 62%'
  },
  {
    id: 'run-2',
    name: 'terraces_i2v_00004.mp4',
    type: 'video',
    source: 'cloud',
    thumbId: 'video_wan2_2_14B_i2v',
    project: 'My first project',
    envId: 'cloud',
    size: '—',
    sizeMb: 0,
    age: -2,
    when: 'Now',
    status: 'queued',
    statusLabel: 'Queued · 2nd'
  },
  {
    id: 'run-3',
    name: 'flux_portrait_00031.png',
    type: 'image',
    source: 'local',
    thumbId: 'image_flux2',
    project: 'Flux tests',
    envId: 'local-flux',
    size: '—',
    sizeMb: 0,
    age: -1,
    when: '4 min ago',
    status: 'failed',
    statusLabel: 'Failed · out of memory'
  }
]

const whenOf = (age: number): string =>
  age < 1440
    ? 'Today'
    : age < 2880
      ? 'Yesterday'
      : age < 7200
        ? `${Math.round(age / 1440)} days ago`
        : 'Last week'

// Files people brought in that aren't media: inputs a build keeps too.
const FILES: MarAsset[] = (
  [
    ['notes.md', 'text', '16 B', 1, 4300],
    ['settings.json', 'text', '13 B', 1, 4320],
    ['palette.csv', 'text', '12 B', 1, 9000],
    ['blob.bin', 'other', '512 B', 1, 4330],
    ['narration_intro.wav', 'audio', '5.1 MB', 5100, 180],
    ['ambience_rain_loop.mp3', 'audio', '2.4 MB', 2400, 1500],
    ['pyramid_prop.glb', '3d', '7.9 MB', 7900, 2600]
  ] as const
).flatMap(([name, type, size, sizeMb, age], i) =>
  ['local-1', 'local-video'].map((envId, j) => ({
    id: `file-${i}-${j}-in-${i}`,
    name,
    type,
    source: 'local' as const,
    envId,
    size,
    sizeMb: sizeMb / 1000,
    age,
    when: whenOf(age)
  }))
)

// More renders and imports, each with its own picture
// (mar/assets/mock/asset-<slot>.webp), so a build reads as a media library.
const PICTURES: MarAsset[] = (
  [
    ['neon_alley_dolly_00007.mp4', 'video', '31.4 MB', 31400, 25, 'local-video', 'neon-alley'],
    ['desert_drone_00002.mp4', 'video', '44.8 MB', 44800, 70, 'local-video', 'desert-drone'],
    ['surfer_slowmo_00014.mp4', 'video', '22.1 MB', 22100, 140, 'local-video', 'surfer-slowmo'],
    ['wok_fire_00003.mp4', 'video', '16.7 MB', 16700, 260, 'local-video', 'wok-fire'],
    [
      'lighthouse_storm_00005.mp4',
      'video',
      '38.2 MB',
      38200,
      900,
      'local-video',
      'lighthouse-storm'
    ],
    ['train_window_00009.mp4', 'video', '12.9 MB', 12900, 1600, 'local-video', 'train-window'],
    ['dancer_smoke_00021.mp4', 'video', '19.5 MB', 19500, 2100, 'local-video', 'dancer-smoke'],
    ['night_market_00001.mp4', 'video', '27.3 MB', 27300, 4400, 'local-video', 'night-market'],
    ['keyframe_forest_00012.png', 'image', '3.1 MB', 3100, 45, 'local-video', 'forest-deer'],
    [
      'keyframe_astronaut_00004.png',
      'image',
      '2.8 MB',
      2800,
      400,
      'local-video',
      'astronaut-sunflowers'
    ],
    ['styleframe_noir_00006.png', 'image', '2.2 MB', 2200, 1200, 'local-video', 'noir-detective'],
    [
      'styleframe_crossing_00010.png',
      'image',
      '3.6 MB',
      3600,
      3000,
      'local-video',
      'umbrella-crossing'
    ],
    ['storyboard_fjord_00002.png', 'image', '2.9 MB', 2900, 5800, 'local-video', 'fjord-hiker'],
    [
      'upscaled_fisherman_00008.png',
      'image',
      '8.7 MB',
      8700,
      7600,
      'local-video',
      'fisherman-portrait'
    ],
    ['moodboard_desert_motel.jpg', 'image', '1.4 MB', 1400, 2700, 'local-video', 'desert-motel'],
    ['actor_ref_front.png', 'image', '1.9 MB', 1900, 3500, 'local-video', 'actor-ref'],
    ['location_harbor_dawn.jpg', 'image', '2.6 MB', 2600, 6200, 'local-video', 'harbor-dawn'],
    ['plate_rooftop_dusk.png', 'image', '4.1 MB', 4100, 8900, 'local-video', 'rooftop-plate'],
    ['hero_shot_00010.png', 'image', '2.5 MB', 2500, 30, 'local-1', 'perfume-stone'],
    ['hero_shot_00009.png', 'image', '2.4 MB', 2400, 50, 'local-1', 'sneaker-dust'],
    ['relight_mug_00003.png', 'image', '2.1 MB', 2100, 1700, 'local-1', 'mug-morning'],
    ['headphones_ref.jpg', 'image', '1.1 MB', 1100, 2950, 'local-1', 'headphones-ref'],
    ['alpine_lake_00002.png', 'image', '3.4 MB', 3400, 4700, 'local-1', 'alpine-lake'],
    ['moodboard_citrus.png', 'image', '1.8 MB', 1800, 8200, 'local-1', 'citrus-flatlay']
  ] as const
).map(([name, type, size, sizeMb, age, envId, slot], i) => ({
  id: `pic-${i}`,
  name,
  type,
  source: 'local' as const,
  thumbId: `${type === 'video' ? 'video_wan2_2_14B_i2v' : 'image_flux2'}~asset-${slot}`,
  envId,
  size,
  sizeMb: sizeMb / 1000,
  age,
  when: whenOf(age)
}))

const seed = (): MarAsset[] => [
  ...RUNS,
  ...allAssets.value.map((a) => ({ ...a })),
  ...(allAssets.value.length ? [...PICTURES, ...FILES].map((a) => ({ ...a })) : [])
]
export const assets = collection<MarAsset>(seed(), 'asset')

// Follows the simulated user, like workflowsStore.ts.
watch(
  () => allAssets.value.map((a) => a.id).join(),
  () => assets.items.splice(0, assets.items.length, ...seed())
)
