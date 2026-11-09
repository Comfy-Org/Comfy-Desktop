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

// Files people brought in that aren't media: inputs a build keeps too.
const FILES: MarAsset[] = (
  [
    ['notes.md', 'text', '16 B', 1, 4300],
    ['settings.json', 'text', '13 B', 1, 4320],
    ['palette.csv', 'text', '12 B', 1, 9000],
    ['blob.bin', 'other', '512 B', 1, 4330],
    ['narration_intro.wav', 'audio', '5.1 MB', 5100, 180],
    ['ambience_rain_loop.mp3', 'audio', '2.4 MB', 2400, 1500],
    ['foley_steps_take2.wav', 'audio', '1.8 MB', 1800, 5200],
    ['theme_sketch_v3.flac', 'audio', '11.6 MB', 11600, 8800],
    ['pyramid_prop.glb', '3d', '7.9 MB', 7900, 2600],
    ['lantern_lowpoly.glb', '3d', '1.2 MB', 1200, 6100],
    ['car_wreck_scan.obj', '3d', '24.3 MB', 24300, 9600],
    ['shot_list.md', 'text', '2 KB', 2, 300],
    ['storyboard_notes.txt', 'text', '4 KB', 4, 2900],
    ['color_grade.json', 'text', '1 KB', 1, 3800],
    ['render_queue.csv', 'text', '3 KB', 3, 7400],
    ['camera_path.json', 'text', '6 KB', 6, 10200],
    ['lut_teal_orange.cube', 'other', '1.1 MB', 1100, 5600],
    ['seed_grid.zip', 'other', '18.4 MB', 18400, 11800]
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
    when:
      age < 1440
        ? 'Today'
        : age < 2880
          ? 'Yesterday'
          : age < 7200
            ? `${Math.round(age / 1440)} days ago`
            : 'Last week'
  }))
)

const seed = (): MarAsset[] => [
  ...RUNS,
  ...allAssets.value.map((a) => ({ ...a })),
  ...(allAssets.value.length ? FILES.map((a) => ({ ...a })) : [])
]
export const assets = collection<MarAsset>(seed(), 'asset')

// Follows the simulated user, like workflowsStore.ts.
watch(
  () => allAssets.value.map((a) => a.id).join(),
  () => assets.items.splice(0, assets.items.length, ...seed())
)
