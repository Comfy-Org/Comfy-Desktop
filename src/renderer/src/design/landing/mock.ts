import { reactive } from 'vue'

/**
 * Mock data for the landing-page design prototypes. Not wired to any real
 * source — the prototypes read from here unless "Live instances" is on.
 */

const TPL = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates'
/** Mock slots are `templateId~slot`: the template's thumbnail, unless a
 *  proposal gives that slot its own picture (Mar's: mar/assets/mock). */
export const thumbSource: { pick?: (id: string) => string | undefined } = {}
export const thumb = (id: string): string =>
  thumbSource.pick?.(id) ?? `${TPL}/${id.split('~')[0]}-1.webp`

export type InstanceKind = 'local' | 'cloud'
export type InstanceState = 'running' | 'stopped' | 'launching' | 'update' | 'error'

export interface ProtoInstance {
  id: string
  name: string
  kind: InstanceKind
  /** Release channel / origin label shown under the name. */
  channel: string
  version?: string
  state: InstanceState
  lastUsed: string
  lastUsedRank: number
  gpu?: string
  diskSize?: string
  models?: number
  nodes?: number
  workspace: 'personal' | 'design-team'
  /** Accent used for the instance's monogram tile. */
  hue: number
  /** Live mode: the real Installation backing this row. */
  source?: unknown
  /** Comfy Cloud custom deployment: a pinned ComfyUI + node set on
   *  dedicated cloud GPUs, owned by a workspace. */
  deployment?: boolean
}

export const INSTANCES: ProtoInstance[] = [
  {
    id: 'cloud',
    name: 'Comfy Cloud',
    kind: 'cloud',
    channel: 'cloud.comfy.org',
    state: 'stopped',
    lastUsed: '2 days ago',
    lastUsedRank: 2,
    gpu: 'RTX 6000 Pro · 96 GB',
    workspace: 'personal',
    hue: 210
  },
  {
    id: 'local-1',
    name: 'My Local 1',
    kind: 'local',
    channel: 'Stable',
    version: 'v0.37.4',
    state: 'update',
    lastUsed: '12 min ago',
    lastUsedRank: 0,
    gpu: 'Apple M3 Max',
    diskSize: '38.2 GB',
    models: 14,
    nodes: 9,
    workspace: 'personal',
    hue: 48
  },
  {
    id: 'local-video',
    name: 'Video Lab',
    kind: 'local',
    channel: 'Nightly',
    version: 'v0.38.0-dev',
    state: 'running',
    lastUsed: 'Running now',
    lastUsedRank: 1,
    gpu: 'Apple M3 Max',
    diskSize: '112 GB',
    models: 31,
    nodes: 22,
    workspace: 'personal',
    hue: 280
  },
  {
    id: 'local-flux',
    name: 'Flux Sandbox',
    kind: 'local',
    channel: 'Stable',
    version: 'v0.37.4',
    state: 'stopped',
    lastUsed: 'Last week',
    lastUsedRank: 3,
    gpu: 'Apple M3 Max',
    diskSize: '54.7 GB',
    models: 8,
    nodes: 4,
    workspace: 'personal',
    hue: 150
  },
  {
    id: 'team-build',
    name: 'Brand Pipeline',
    kind: 'local',
    channel: 'Design Team build',
    version: 'v0.37.2',
    state: 'stopped',
    lastUsed: '3 days ago',
    lastUsedRank: 4,
    gpu: 'Apple M3 Max',
    diskSize: '61.0 GB',
    models: 19,
    nodes: 12,
    workspace: 'design-team',
    hue: 330
  }
]

INSTANCES.push(
  {
    id: 'dep-product',
    name: 'Product Shots',
    kind: 'cloud',
    deployment: true,
    channel: 'Cloud build',
    version: 'v0.37.4',
    state: 'running',
    lastUsed: 'Yesterday',
    lastUsedRank: 6,
    gpu: 'H100 · 80 GB',
    models: 22,
    nodes: 14,
    workspace: 'personal',
    hue: 0
  },
  {
    id: 'dep-brand',
    name: 'Brand Pipeline',
    kind: 'cloud',
    deployment: true,
    channel: 'Cloud build',
    version: 'v0.37.2',
    state: 'stopped',
    lastUsed: '3 days ago',
    lastUsedRank: 7,
    gpu: 'L40S · 48 GB',
    models: 19,
    nodes: 12,
    workspace: 'design-team',
    hue: 0
  },
  {
    id: 'dep-upscale',
    name: 'Upscaler API',
    kind: 'cloud',
    deployment: true,
    channel: 'Cloud build',
    version: 'v0.36.9',
    state: 'stopped',
    lastUsed: 'Last week',
    lastUsedRank: 8,
    gpu: 'A100 · 80 GB',
    models: 4,
    nodes: 3,
    workspace: 'design-team',
    hue: 0
  }
)

export interface Workspace {
  id: 'personal' | 'design-team'
  name: string
  plan: string
  role: string
  initial: string
  color: string
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'personal',
    name: 'Silverside',
    plan: 'Enterprise',
    role: 'OWNER',
    initial: 'S',
    color: '#3a3a3d'
  },
  {
    id: 'design-team',
    name: 'Design Team',
    plan: 'Pro plan',
    role: 'OWNER',
    initial: 'D',
    color: '#4c3a8c'
  }
]

export const USER = { name: 'Pablo', email: 'pablo@example.com', credits: '13,853' }

export interface Template {
  id: string
  title: string
  kind: 'graph' | 'app'
  category: 'image' | 'video' | '3d' | 'audio'
  /** Needs Comfy Cloud / partner API, or runs locally. */
  runs: 'local' | 'cloud' | 'both'
  vram?: string
}

export const TEMPLATES: Template[] = [
  {
    id: 'image_qwen_image_edit_2511',
    title: 'Qwen Image Edit 2511: Multiple Angles',
    kind: 'graph',
    category: 'image',
    runs: 'both',
    vram: '24 GB'
  },
  {
    id: 'image_z_image_turbo',
    title: 'Z-Image-Turbo Text to Image',
    kind: 'graph',
    category: 'image',
    runs: 'both',
    vram: '12 GB'
  },
  {
    id: 'video_ltx2_5_i2v',
    title: 'LTX 2.5: Image to Video',
    kind: 'graph',
    category: 'video',
    runs: 'both',
    vram: '32 GB'
  },
  {
    id: 'video_wan2_2_14B_i2v',
    title: 'Wan 2.2 14B Image to Video',
    kind: 'graph',
    category: 'video',
    runs: 'both',
    vram: '48 GB'
  },
  {
    id: '3d_pixal3d_trellis2_image_to_model',
    title: 'Pixal3D & TRELLIS.2: Image to Model',
    kind: 'graph',
    category: '3d',
    runs: 'both',
    vram: '24 GB'
  },
  {
    id: 'api_google_nano_banana2_image_edit',
    title: 'Nano Banana 2: Image Edit',
    kind: 'app',
    category: 'image',
    runs: 'cloud'
  },
  {
    id: 'template_product_placement',
    title: 'Product Placement',
    kind: 'app',
    category: 'image',
    runs: 'cloud'
  },
  {
    id: 'image_flux2',
    title: 'Flux.2 Dev',
    kind: 'graph',
    category: 'image',
    runs: 'local',
    vram: '24 GB'
  },
  {
    id: 'video_minimax_h3_i2v',
    title: 'MiniMax H3: Image to Video',
    kind: 'graph',
    category: 'video',
    runs: 'both'
  },
  {
    id: 'templates_graphic_design_recomposer',
    title: 'Graphic Design Recomposer',
    kind: 'app',
    category: 'image',
    runs: 'cloud'
  },
  {
    id: 'utility_seedvr2_image_upscale',
    title: 'Image Upscale: SeedVR2',
    kind: 'graph',
    category: 'image',
    runs: 'local',
    vram: '16 GB'
  },
  {
    id: 'image_krea2_turbo_t2i',
    title: 'Krea-2: Text to Image',
    kind: 'graph',
    category: 'image',
    runs: 'both',
    vram: '16 GB'
  }
]

export interface Launch {
  title: string
  kind: 'model' | 'feature'
  video?: string
  image?: string
}

const SCENE = './install-showcase-scene/Assets'
export const LAUNCHES: Launch[] = [
  { title: 'Seedance 2.5', kind: 'model', video: `${SCENE}/dusk_mountains.webm` },
  { title: 'LTX 2.5', kind: 'model', video: `${SCENE}/clouds.webm` },
  { title: 'Wan Animate 2', kind: 'model', video: `${SCENE}/swings.webm` },
  { title: 'MiniMax H3', kind: 'model', video: `${SCENE}/eye.webm` },
  { title: 'Flower Studio', kind: 'feature', video: `${SCENE}/flower.webm` }
]

export interface Workflow {
  name: string
  instanceId: string
  modified: string
  thumbId: string
  project?: string
}

export const WORKFLOWS: Workflow[] = [
  {
    name: 'hero-shot-v4.json',
    instanceId: 'local-1',
    modified: '12 min ago',
    thumbId: 'image_z_image_turbo~hero-shot-v4',
    project: 'Product campaign'
  },
  {
    name: 'rice-terraces-i2v.json',
    instanceId: 'local-video',
    modified: '1 hour ago',
    thumbId: 'video_wan2_2_14B_i2v~rice-terraces-i2v',
    project: 'My first project'
  },
  {
    name: 'product-relight.json',
    instanceId: 'cloud',
    modified: 'Yesterday',
    thumbId: 'template_product_placement~product-relight',
    project: 'Product campaign'
  },
  {
    name: 'angles-sheet.json',
    instanceId: 'local-1',
    modified: '2 days ago',
    thumbId: 'image_qwen_image_edit_2511~angles-sheet'
  },
  {
    name: 'flux-portraits.json',
    instanceId: 'local-flux',
    modified: 'Last week',
    thumbId: 'image_flux2~flux-portraits'
  },
  {
    name: 'logo-texture.json',
    instanceId: 'team-build',
    modified: 'Last week',
    thumbId: 'templates_graphic_design_recomposer~logo-texture',
    project: 'Product campaign'
  }
]

/** Projects (when the product has them): a shared space that always runs
 *  on one environment. Several projects can share an environment.
 *  Reactive: a first-time user (Mar's proposal) has none. */
export const PROJECTS: { id: string; name: string; envId: string }[] = reactive([
  { id: 'hero', name: 'Hero shots', envId: 'local-1' },
  { id: 'first', name: 'My first project', envId: 'local-video' },
  { id: 'flux', name: 'Flux tests', envId: 'local-flux' },
  { id: 'campaign', name: 'Product campaign', envId: 'dep-product' },
  { id: 'explore', name: 'Explorations', envId: 'cloud' }
])

// --- Assets + workflows: Local / Comfy Cloud split ----------------------

export type Modality = 'image' | 'video' | '3d' | 'audio'

export interface CloudAsset {
  id: string
  name: string
  thumbId: string
  type: Modality
  project?: string
  size: string
  sizeMb: number
  /** 0 = newest. */
  age: number
  when: string
  bucket: 'today' | 'week' | 'month'
  favorite?: boolean
}

const ca = (
  id: string,
  name: string,
  thumbId: string,
  type: Modality,
  sizeMb: number,
  age: number,
  bucket: CloudAsset['bucket'],
  when: string,
  project?: string,
  favorite?: boolean
): CloudAsset => ({
  id,
  name,
  thumbId,
  type,
  sizeMb,
  size: sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${Math.round(sizeMb * 1000)} KB`,
  age,
  bucket,
  when,
  project,
  favorite
})

export const CLOUD_ASSETS: CloudAsset[] = [
  ca(
    'c1',
    'hero_shot_00012.png',
    'image_z_image_turbo~hero-shot-00012',
    'image',
    2.4,
    0,
    'today',
    '12 min ago',
    'Product campaign',
    true
  ),
  ca(
    'c2',
    'terraces_i2v_00003.mp4',
    'video_ltx2_5_i2v~terraces-i2v-00003',
    'video',
    18.2,
    1,
    'today',
    '1 h ago',
    'My first project'
  ),
  ca(
    'c3',
    'relight_banana_00007.png',
    'api_google_nano_banana2_image_edit~relight-banana-00007',
    'image',
    3.1,
    2,
    'today',
    '3 h ago',
    'Product campaign'
  ),
  ca(
    'c4',
    'angles_sheet_00002.png',
    'image_qwen_image_edit_2511~angles-sheet-00002',
    'image',
    4.8,
    3,
    'week',
    'Yesterday'
  ),
  ca(
    'c5',
    'wan_portrait_00011.mp4',
    'video_wan2_2_14B_i2v~wan-portrait-00011',
    'video',
    26.5,
    4,
    'week',
    'Yesterday',
    'My first project',
    true
  ),
  ca(
    'c6',
    'axe_model_00001.glb',
    '3d_pixal3d_trellis2_image_to_model~axe-model-00001',
    '3d',
    41.0,
    5,
    'week',
    '2 days ago'
  ),
  ca(
    'c7',
    'flux_portrait_00004.png',
    'image_flux2~flux-portrait-00004',
    'image',
    2.2,
    6,
    'week',
    '3 days ago'
  ),
  ca(
    'c8',
    'product_place_00009.png',
    'template_product_placement~product-place-00009',
    'image',
    2.9,
    7,
    'week',
    '4 days ago',
    'Product campaign'
  ),
  ca(
    'c9',
    'voiceover_take3.mp3',
    'audio',
    'audio',
    0.9,
    8,
    'week',
    '5 days ago',
    'Product campaign'
  ),
  ca(
    'c10',
    'krea_street_00006.png',
    'image_krea2_turbo_t2i~krea-street-00006',
    'image',
    1.8,
    9,
    'month',
    '2 weeks ago'
  ),
  ca(
    'c11',
    'minimax_eye_00002.mp4',
    'video_minimax_h3_i2v~minimax-eye-00002',
    'video',
    12.7,
    10,
    'month',
    '2 weeks ago'
  ),
  ca(
    'c12',
    'poster_recompose_00001.png',
    'templates_graphic_design_recomposer~poster-recompose-00001',
    'image',
    3.6,
    11,
    'month',
    '3 weeks ago',
    'Product campaign'
  ),
  ca(
    'c13',
    'upscale_4k_00003.png',
    'utility_seedvr2_image_upscale~upscale-4k-00003',
    'image',
    9.4,
    12,
    'month',
    '3 weeks ago'
  ),
  ca('c14', 'ambient_loop_02.wav', 'audio', 'audio', 4.2, 13, 'month', '4 weeks ago')
]

export interface LocalFile {
  name: string
  size: string
  modified: string
  kind: 'image' | 'video' | 'audio' | '3d' | 'workflow' | 'folder'
  thumbId?: string
}

export interface LocalFolder {
  id: string
  /** Display name, e.g. "output". */
  name: string
  path: string
  instanceId?: string
  custom?: boolean
  files: LocalFile[]
}

const HOME = '/Users/pablo'
const installRoot = (dir: string): string => `${HOME}/ComfyUI/${dir}/ComfyUI`

export const LOCAL_ASSET_FOLDERS: LocalFolder[] = [
  {
    id: 'l1-out',
    name: 'output',
    path: `${installRoot('My Local 1')}/output`,
    instanceId: 'local-1',
    files: [
      {
        name: 'hero_shot_00012.png',
        size: '2.4 MB',
        modified: '12 min ago',
        kind: 'image',
        thumbId: 'image_z_image_turbo~hero-shot-00012'
      },
      {
        name: 'hero_shot_00011.png',
        size: '2.3 MB',
        modified: '14 min ago',
        kind: 'image',
        thumbId: 'image_krea2_turbo_t2i~hero-shot-00011'
      },
      {
        name: 'angles_sheet_00002.png',
        size: '4.8 MB',
        modified: '2 days ago',
        kind: 'image',
        thumbId: 'image_qwen_image_edit_2511~angles-sheet-00002'
      },
      { name: 'upscaled', size: '—', modified: 'Last week', kind: 'folder' }
    ]
  },
  {
    id: 'l1-in',
    name: 'input',
    path: `${installRoot('My Local 1')}/input`,
    instanceId: 'local-1',
    files: [
      {
        name: 'product_ref.jpg',
        size: '1.2 MB',
        modified: 'Yesterday',
        kind: 'image',
        thumbId: 'template_product_placement~product-ref'
      },
      {
        name: 'pose_ref.png',
        size: '860 KB',
        modified: '3 days ago',
        kind: 'image',
        thumbId: 'image_flux2~pose-ref'
      }
    ]
  },
  {
    id: 'vl-out',
    name: 'output',
    path: `${installRoot('Video Lab')}/output`,
    instanceId: 'local-video',
    files: [
      {
        name: 'terraces_i2v_00003.mp4',
        size: '18.2 MB',
        modified: '1 hour ago',
        kind: 'video',
        thumbId: 'video_ltx2_5_i2v~terraces-i2v-00003'
      },
      {
        name: 'wan_portrait_00011.mp4',
        size: '26.5 MB',
        modified: 'Yesterday',
        kind: 'video',
        thumbId: 'video_wan2_2_14B_i2v~wan-portrait-00011'
      },
      { name: 'voiceover_take3.mp3', size: '940 KB', modified: '5 days ago', kind: 'audio' }
    ]
  },
  {
    id: 'vl-in',
    name: 'input',
    path: `${installRoot('Video Lab')}/input`,
    instanceId: 'local-video',
    files: [
      {
        name: 'terraces_still.png',
        size: '3.3 MB',
        modified: '1 hour ago',
        kind: 'image',
        thumbId: 'video_minimax_h3_i2v~terraces-still'
      }
    ]
  },
  {
    id: 'fx-out',
    name: 'output',
    path: `${installRoot('Flux Sandbox')}/output`,
    instanceId: 'local-flux',
    files: [
      {
        name: 'flux_portrait_00004.png',
        size: '2.2 MB',
        modified: 'Last week',
        kind: 'image',
        thumbId: 'image_flux2~flux-portrait-00004'
      },
      {
        name: 'upscale_4k_00003.png',
        size: '9.4 MB',
        modified: 'Last week',
        kind: 'image',
        thumbId: 'utility_seedvr2_image_upscale~upscale-4k-00003'
      }
    ]
  },
  {
    id: 'fx-in',
    name: 'input',
    path: `${installRoot('Flux Sandbox')}/input`,
    instanceId: 'local-flux',
    files: []
  }
]

export const LOCAL_WORKFLOW_FOLDERS: LocalFolder[] = [
  {
    id: 'l1-wf',
    name: 'workflows',
    path: `${installRoot('My Local 1')}/user/default/workflows`,
    instanceId: 'local-1',
    files: [
      {
        name: 'hero-shot-v4.json',
        size: '48 KB',
        modified: '12 min ago',
        kind: 'workflow',
        thumbId: 'image_z_image_turbo~hero-shot-v4'
      },
      {
        name: 'angles-sheet.json',
        size: '61 KB',
        modified: '2 days ago',
        kind: 'workflow',
        thumbId: 'image_qwen_image_edit_2511~angles-sheet'
      },
      {
        name: 'krea-street.json',
        size: '22 KB',
        modified: '2 weeks ago',
        kind: 'workflow',
        thumbId: 'image_krea2_turbo_t2i~krea-street'
      }
    ]
  },
  {
    id: 'vl-wf',
    name: 'workflows',
    path: `${installRoot('Video Lab')}/user/default/workflows`,
    instanceId: 'local-video',
    files: [
      {
        name: 'rice-terraces-i2v.json',
        size: '74 KB',
        modified: '1 hour ago',
        kind: 'workflow',
        thumbId: 'video_wan2_2_14B_i2v~rice-terraces-i2v'
      },
      {
        name: 'ltx-camera-moves.json',
        size: '52 KB',
        modified: 'Last week',
        kind: 'workflow',
        thumbId: 'video_ltx2_5_i2v~ltx-camera-moves'
      }
    ]
  },
  {
    id: 'fx-wf',
    name: 'workflows',
    path: `${installRoot('Flux Sandbox')}/user/default/workflows`,
    instanceId: 'local-flux',
    files: [
      {
        name: 'flux-portraits.json',
        size: '31 KB',
        modified: 'Last week',
        kind: 'workflow',
        thumbId: 'image_flux2~flux-portraits'
      }
    ]
  }
]

export interface CloudWorkflow {
  name: string
  thumbId: string
  project?: string
  modified: string
  age: number
  shared?: boolean
}

export const CLOUD_WORKFLOWS: CloudWorkflow[] = [
  {
    name: 'product-relight.json',
    thumbId: 'template_product_placement~product-relight',
    project: 'Product campaign',
    modified: 'Yesterday',
    age: 1,
    shared: true
  },
  {
    name: 'banana-edit-batch.json',
    thumbId: 'api_google_nano_banana2_image_edit~banana-edit-batch',
    project: 'Product campaign',
    modified: '2 days ago',
    age: 2
  },
  {
    name: 'terraces-i2v-cloud.json',
    thumbId: 'video_ltx2_5_i2v~terraces-i2v-cloud',
    project: 'My first project',
    modified: '4 days ago',
    age: 3
  },
  {
    name: 'trellis-props.json',
    thumbId: '3d_pixal3d_trellis2_image_to_model~trellis-props',
    modified: 'Last week',
    age: 4
  },
  {
    name: 'poster-recompose.json',
    thumbId: 'templates_graphic_design_recomposer~poster-recompose',
    project: 'Product campaign',
    modified: '2 weeks ago',
    age: 5,
    shared: true
  },
  {
    name: 'minimax-eye.json',
    thumbId: 'video_minimax_h3_i2v~minimax-eye',
    project: 'My first project',
    modified: '3 weeks ago',
    age: 6
  }
]

export interface Tutorial {
  title: string
  blurb: string
  category: 'Basics' | 'VFX' | 'Animations' | 'Ads'
  kind: 'graph' | 'app'
  thumbId: string
  minutes: number
  /** How much you've watched, 0 to 1 (1 = watched). Basics lessons run in
   *  the order listed. */
  progress?: number
  isNew?: boolean
}

export const TUTORIALS: Tutorial[] = [
  {
    title: 'Node graph basics',
    blurb: 'Learn how nodes, links and the run queue fit together.',
    category: 'Basics',
    kind: 'graph',
    thumbId: 'image_z_image_turbo~node-graph-basics',
    minutes: 8,
    progress: 1
  },
  {
    title: 'Text to image and image to image',
    blurb: 'Build your first image workflows and learn when to use each.',
    category: 'Basics',
    kind: 'graph',
    thumbId: 'image_flux2~text-to-image-and-image-to-image',
    minutes: 12,
    progress: 1
  },
  {
    title: 'LoRAs, style transfer and ControlNets',
    blurb: 'Add style and control to an image workflow.',
    category: 'Basics',
    kind: 'graph',
    thumbId: 'image_krea2_turbo_t2i~loras-style-transfer-and-controlnets',
    minutes: 15,
    progress: 0.4
  },
  {
    title: 'Inpainting, outpainting and upscaling',
    blurb: 'Edit, extend and sharpen an image in ComfyUI.',
    category: 'Basics',
    kind: 'app',
    thumbId: 'utility_seedvr2_image_upscale~inpainting-outpainting-and-upscaling',
    minutes: 11
  },
  {
    title: 'Image to video and motion control',
    blurb: 'Turn a still image into motion and refine the result.',
    category: 'Basics',
    kind: 'graph',
    thumbId: 'video_ltx2_5_i2v~image-to-video-and-motion-control',
    minutes: 14
  },
  {
    title: 'Cleanplate walkthrough',
    blurb: 'Follow a hands-on visual effects workflow.',
    category: 'VFX',
    kind: 'graph',
    thumbId: 'video_wan2_2_14B_i2v~cleanplate-walkthrough',
    minutes: 18
  },
  {
    title: 'Deaging workflow',
    blurb: 'Explore a practical character deaging workflow.',
    category: 'VFX',
    kind: 'graph',
    thumbId: 'image_qwen_image_edit_2511~deaging-workflow',
    minutes: 16,
    isNew: true
  },
  {
    title: 'Character sheet',
    blurb: 'Create a set of consistent character views.',
    category: 'Animations',
    kind: 'graph',
    thumbId: '3d_pixal3d_trellis2_image_to_model~character-sheet',
    minutes: 10
  },
  {
    title: 'Lip sync from a single image',
    blurb: 'Animate a portrait to match a voice track.',
    category: 'Animations',
    kind: 'graph',
    thumbId: 'video_minimax_h3_i2v~lip-sync-from-a-single-image',
    minutes: 13,
    progress: 0.65
  },
  {
    title: 'Product placement in one click',
    blurb: 'Place a product into any scene with consistent light.',
    category: 'Ads',
    kind: 'app',
    thumbId: 'template_product_placement~product-placement-in-one-click',
    minutes: 7
  },
  {
    title: 'Poster recomposition',
    blurb: 'Rebuild a poster layout for every ad size.',
    category: 'Ads',
    kind: 'app',
    thumbId: 'templates_graphic_design_recomposer~poster-recomposition',
    minutes: 9
  },
  {
    title: 'Edits with Nano Banana 2',
    blurb: 'Make precise image edits with a partner model.',
    category: 'Ads',
    kind: 'graph',
    thumbId: 'api_google_nano_banana2_image_edit~edits-with-nano-banana-2',
    minutes: 6,
    isNew: true
  }
]

// --- Project collaboration -------------------------------------------------

export interface Member {
  id: string
  name: string
  email: string
  role: 'owner' | 'collaborator' | 'viewer'
  you?: boolean
  runs: number
  credits: number
  limit: number
}

export const MEMBERS: Member[] = [
  {
    id: 'm-you',
    name: 'Pablo',
    email: 'pablo@example.com',
    role: 'owner',
    you: true,
    runs: 30,
    credits: 3266,
    limit: 2000
  },
  {
    id: 'm-alex',
    name: 'Alex Carmoid',
    email: 'alex@example.com',
    role: 'collaborator',
    runs: 24,
    credits: 2613,
    limit: 1000
  },
  {
    id: 'm-jane',
    name: 'Jane Park',
    email: 'jane@example.com',
    role: 'collaborator',
    runs: 18,
    credits: 1960,
    limit: 3000
  },
  {
    id: 'm-marcus',
    name: 'Marcus Lin',
    email: 'marcus@example.com',
    role: 'viewer',
    runs: 12,
    credits: 1306,
    limit: 2000
  }
]

// --- Environment stats (environment-scoped IA) -----------------------------

export interface EnvStats {
  runs7d: number
  gpuMin7d: number
  spend7d: number
  storageGb: number
  /** Daily runs, oldest first, for the sparkline. */
  trend: number[]
  uptime?: string
  endpoint?: string
  workers?: string
  build?: string
}

export const ENV_STATS: Record<string, EnvStats> = {
  'local-1': {
    runs7d: 48,
    gpuMin7d: 212,
    spend7d: 0,
    storageGb: 38.2,
    trend: [4, 9, 6, 11, 7, 3, 8]
  },
  'local-video': {
    runs7d: 31,
    gpuMin7d: 540,
    spend7d: 0,
    storageGb: 112,
    trend: [2, 3, 8, 6, 4, 5, 3],
    uptime: '1h 12m'
  },
  'local-flux': {
    runs7d: 6,
    gpuMin7d: 41,
    spend7d: 0,
    storageGb: 54.7,
    trend: [0, 2, 1, 0, 3, 0, 0]
  },
  'team-build': {
    runs7d: 14,
    gpuMin7d: 96,
    spend7d: 0,
    storageGb: 61,
    trend: [1, 2, 3, 2, 2, 3, 1]
  },
  cloud: {
    runs7d: 120,
    gpuMin7d: 380,
    spend7d: 9800,
    storageGb: 4.1,
    trend: [12, 18, 20, 15, 22, 17, 16]
  },
  'dep-product': {
    runs7d: 412,
    gpuMin7d: 1260,
    spend7d: 24100,
    storageGb: 61,
    trend: [40, 52, 61, 58, 70, 66, 65],
    endpoint: 'https://api.comfy.org/v1/dep-de68a0f4/run',
    workers: '1–3',
    build: 'build-31gku1 · v1'
  },
  'dep-brand': {
    runs7d: 88,
    gpuMin7d: 300,
    spend7d: 6400,
    storageGb: 58,
    trend: [9, 12, 14, 13, 15, 12, 13],
    endpoint: 'https://api.comfy.org/v1/dep-7fa2c1/run',
    workers: '0–2',
    build: 'build-7i9eai · v3'
  },
  'dep-upscale': {
    runs7d: 0,
    gpuMin7d: 0,
    spend7d: 0,
    storageGb: 12,
    trend: [0, 0, 0, 0, 0, 0, 0],
    endpoint: 'https://api.comfy.org/v1/dep-1b9e44/run',
    workers: '0–1',
    build: 'build-up4k · v2'
  }
}

export interface EnvModel {
  name: string
  kind: 'checkpoint' | 'lora' | 'vae' | 'text encoder' | 'upscaler'
  size: string
}
export const ENV_MODELS: EnvModel[] = [
  { name: 'z_image_turbo_bf16.safetensors', kind: 'checkpoint', size: '12.3 GB' },
  { name: 'qwen_image_edit_2511_fp8.safetensors', kind: 'checkpoint', size: '20.4 GB' },
  { name: 'qwen_3_4b.safetensors', kind: 'text encoder', size: '8.0 GB' },
  { name: 'ae.safetensors', kind: 'vae', size: '335 MB' },
  { name: 'krea2_turbo.safetensors', kind: 'checkpoint', size: '11.9 GB' },
  { name: 'product_photo_v3.safetensors', kind: 'lora', size: '144 MB' },
  { name: '4x_NMKD-Siax_200k.pth', kind: 'upscaler', size: '67 MB' }
]
export const ENV_NODES = [
  { name: 'ComfyUI-KJNodes', version: '1.1.7', updated: true },
  { name: 'rgthree-comfy', version: '1.0.4', updated: true },
  { name: 'ComfyUI-VideoHelperSuite', version: '1.6.2', updated: false },
  { name: 'comfyui_controlnet_aux', version: '1.0.9', updated: true },
  { name: 'ComfyUI-Impact-Pack', version: '8.12', updated: true }
]

export const BUILDS = [
  {
    id: 'build-31gku1',
    from: 'My Local 1',
    release: 'Release 1',
    contents: '22 models · 14 nodes',
    deployments: 1,
    edited: 'Aug 31'
  },
  {
    id: 'build-7i9eai',
    from: 'Brand Pipeline',
    release: 'Release 3',
    contents: '19 models · 12 nodes',
    deployments: 1,
    edited: 'Sep 3'
  }
]

// --- Unified model: Environment -> Versions -> runs on (computer / Cloud / Deployments)

export interface EnvVersion {
  id: string
  label: string
  note: string
  when: string
  /** Published versions exist in the cloud and can be deployed. */
  published: boolean
}

/** Version history per environment (local versions are ComfyUI-Manager
 *  snapshots; published ones are what the platform called releases). */
export const ENV_VERSIONS: Record<string, EnvVersion[]> = {
  'local-1': [
    {
      id: 'v4',
      label: 'v4',
      note: 'Added product_photo_v3 LoRA',
      when: '12 min ago',
      published: false
    },
    {
      id: 'v3',
      label: 'v3',
      note: 'ComfyUI 0.37.4, KJNodes 1.1.7',
      when: 'Last week',
      published: true
    },
    { id: 'v2', label: 'v2', note: 'Qwen Image Edit 2511', when: '3 weeks ago', published: true },
    { id: 'v1', label: 'v1', note: 'First snapshot', when: 'Aug 2', published: false }
  ],
  'local-video': [
    { id: 'v2', label: 'v2', note: 'LTX 2.5 + Wan 2.2', when: '1 h ago', published: false },
    { id: 'v1', label: 'v1', note: 'First snapshot', when: 'Sep 12', published: false }
  ],
  'local-flux': [
    { id: 'v1', label: 'v1', note: 'First snapshot', when: 'Sep 1', published: false }
  ],
  'dep-product': [
    { id: 'v2', label: 'v2', note: 'SeedVR2 upscaler', when: 'Yesterday', published: true },
    { id: 'v1', label: 'v1', note: 'Initial release', when: 'Aug 31', published: true }
  ],
  'dep-brand': [
    { id: 'v3', label: 'v3', note: 'Brand LoRAs refresh', when: 'Sep 3', published: true }
  ],
  'dep-upscale': [
    { id: 'v2', label: 'v2', note: 'Real-ESRGAN 4x', when: 'Aug 20', published: true }
  ]
}

/** Local environments that also exist in the cloud (linked, not copied). */
export const PUBLISHED_LOCAL = new Set(['local-1'])

export interface Deployment {
  id: string
  name: string
  envId: string
  version: string
  stage: 'production' | 'staging'
  status: 'running' | 'scaled-to-zero' | 'stopped'
  gpu: string
  workers: string
  endpoint: string
  requests7d: number
  errorRate: number
  p95: string
  spend7d: number
  trend: number[]
  workspace: 'personal' | 'design-team'
  /** Deployed from a space's Published tools: which space and tool. */
  spaceId?: string
  tool?: string
}

export const DEPLOYMENTS: Deployment[] = [
  {
    id: 'd-ps-prod',
    name: 'product-shots',
    envId: 'dep-product',
    version: 'v2',
    stage: 'production',
    status: 'running',
    gpu: 'H100 · 80 GB',
    workers: '1–3',
    endpoint: 'https://api.comfy.org/v1/product-shots/run',
    requests7d: 41200,
    errorRate: 0.4,
    p95: '9.8 s',
    spend7d: 24100,
    trend: [40, 52, 61, 58, 70, 66, 65],
    workspace: 'personal'
  },
  {
    id: 'd-ps-stg',
    name: 'product-shots-staging',
    envId: 'dep-product',
    version: 'v2',
    stage: 'staging',
    status: 'scaled-to-zero',
    gpu: 'L40S · 48 GB',
    workers: '0–1',
    endpoint: 'https://api.comfy.org/v1/product-shots-staging/run',
    requests7d: 320,
    errorRate: 2.1,
    p95: '14.2 s',
    spend7d: 410,
    trend: [2, 0, 5, 3, 0, 1, 4],
    workspace: 'personal'
  },
  {
    id: 'd-hero',
    name: 'hero-shot-api',
    envId: 'local-1',
    version: 'v3',
    stage: 'production',
    status: 'scaled-to-zero',
    gpu: 'RTX Pro 6000 · 96 GB',
    workers: '0–2',
    endpoint: 'https://api.comfy.org/v1/hero-shot-api/run',
    requests7d: 1840,
    errorRate: 0.9,
    p95: '6.1 s',
    spend7d: 2300,
    trend: [3, 4, 2, 5, 6, 4, 3],
    workspace: 'personal'
  },
  {
    id: 'd-brand',
    name: 'brand-api',
    envId: 'dep-brand',
    version: 'v3',
    stage: 'production',
    status: 'running',
    gpu: 'L40S · 48 GB',
    workers: '0–2',
    endpoint: 'https://api.comfy.org/v1/brand-api/run',
    requests7d: 8800,
    errorRate: 0.2,
    p95: '7.4 s',
    spend7d: 6400,
    trend: [9, 12, 14, 13, 15, 12, 13],
    workspace: 'design-team'
  }
]

export const ROUTER_MODELS = [
  { provider: 'Google', model: 'Nano Banana 2', kind: 'Image edit', price: '4 cr / image' },
  { provider: 'ByteDance', model: 'Seedance 2.5', kind: 'Video', price: '38 cr / s' },
  { provider: 'OpenAI', model: 'GPT Image 2.5', kind: 'Image', price: '6 cr / image' },
  { provider: 'Black Forest Labs', model: 'FLUX.3', kind: 'Image', price: '5 cr / image' },
  { provider: 'MiniMax', model: 'H3', kind: 'Video', price: '30 cr / s' },
  { provider: 'ElevenLabs', model: 'Eleven v4', kind: 'Audio', price: '2 cr / 1k chars' }
]

// --- Apps (published, shareable workflow apps) ------------------------------

export interface App {
  id: string
  name: string
  thumbId: string
  owner: string
  you: boolean
  shared: 'everyone' | 'team' | 'private'
  updated: string
  runs: number
  envId: string
}

export const APPS: App[] = reactive([
  {
    id: 'a-relight',
    name: 'Product relight',
    thumbId: 'template_product_placement~app-product-relight',
    owner: 'You',
    you: true,
    shared: 'everyone',
    updated: 'Sep 30',
    runs: 1284,
    envId: 'dep-product'
  },
  {
    id: 'a-angles',
    name: 'Character angles',
    thumbId: 'image_qwen_image_edit_2511~app-character-angles',
    owner: 'You',
    you: true,
    shared: 'private',
    updated: 'Sep 4',
    runs: 96,
    envId: 'local-1'
  },
  {
    id: 'a-poster',
    name: 'Poster resizer',
    thumbId: 'templates_graphic_design_recomposer~app-poster-resizer',
    owner: 'Jane Park',
    you: false,
    shared: 'team',
    updated: 'Sep 2',
    runs: 640,
    envId: 'dep-product'
  },
  {
    id: 'a-i2v',
    name: 'Photo to video',
    thumbId: 'video_ltx2_5_i2v~app-photo-to-video',
    owner: 'Marcus Lin',
    you: false,
    shared: 'team',
    updated: 'Aug 28',
    runs: 412,
    envId: 'cloud'
  },
  {
    id: 'a-upscale',
    name: '4K upscaler',
    thumbId: 'utility_seedvr2_image_upscale~app-4k-upscaler',
    owner: 'You',
    you: true,
    shared: 'team',
    updated: 'Aug 13',
    runs: 2210,
    envId: 'local-flux'
  },
  {
    id: 'a-3d',
    name: 'Image to 3D prop',
    thumbId: '3d_pixal3d_trellis2_image_to_model~app-image-to-3d-prop',
    owner: 'Alex Carmoid',
    you: false,
    shared: 'everyone',
    updated: 'Aug 2',
    runs: 158,
    envId: 'cloud'
  }
])

/** Logo an admin can "upload" in the prototype. */
export const SAMPLE_LOGO = { name: 'Silverside', mark: 'L' }

/** Chrome-style brand swatches (no custom hues elsewhere in the app). */
export const BRAND_SWATCHES = [
  '#8b7cf6',
  '#4f8cff',
  '#2bb3a3',
  '#7cc36b',
  '#e2b93b',
  '#f08a4b',
  '#e5687a',
  '#c873d6'
]
