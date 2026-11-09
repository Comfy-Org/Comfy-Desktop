import { watch } from 'vue'
import { allAssets } from '../../gallery'
import { collection } from './collection'
import type { ItemStatus } from './MarStatus.vue'

/** Assets in Mar's proposal: the gallery's, plus the runs still in
 *  flight. In memory, shared by Assets and each project's Assets tab. */
export interface MarAsset {
  id: string
  name: string
  type: 'image' | 'video' | '3d' | 'audio'
  source: 'local' | 'cloud'
  thumbId?: string
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

const seed = (): MarAsset[] => [...RUNS, ...allAssets.value.map((a) => ({ ...a }))]
export const assets = collection<MarAsset>(seed(), 'asset')

// Follows the simulated user, like workflowsStore.ts.
watch(
  () => allAssets.value.map((a) => a.id).join(),
  () => assets.items.splice(0, assets.items.length, ...seed())
)
