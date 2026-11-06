/**
 * What the rail's panels list, in the mock. Names and groupings follow
 * ComfyUI's own panels (Comfy-Org/ComfyUI_frontend, sidebar tabs): model
 * folders as on disk, workflows as saved files, its default shortcuts.
 */

const files = import.meta.glob('../../assets/*.jpg', { eager: true, import: 'default' })
export const PICTURES = Object.entries(files).map(([path, src]) => ({
  name: path.split('/').pop()!.replace('.jpg', ''),
  src: src as string
}))
const pic = (i: number): string => PICTURES[i % PICTURES.length]?.src ?? ''

// ── Job History: earlier runs, newest first. ──
export interface PastJob {
  id: string
  file: string
  src: string
  seconds: number
  outputs: number
  day: 'Today' | 'Yesterday'
  failed?: string
}
export const PAST_JOBS: PastJob[] = [
  {
    id: 'a81f2c9e',
    file: 'ComfyUI_00042_.png',
    src: pic(3),
    seconds: 14.62,
    outputs: 1,
    day: 'Today'
  },
  {
    id: '5c0d77b1',
    file: 'ComfyUI_00041_.png',
    src: pic(5),
    seconds: 12.08,
    outputs: 4,
    day: 'Today'
  },
  {
    id: '9e3a1f40',
    file: '',
    src: '',
    seconds: 2.4,
    outputs: 0,
    day: 'Today',
    failed: 'CheckpointLoaderSimple: Value not in list'
  },
  {
    id: '27bb90de',
    file: 'ComfyUI_00040_.png',
    src: pic(7),
    seconds: 31.5,
    outputs: 1,
    day: 'Yesterday'
  },
  {
    id: 'c4e81a03',
    file: 'ComfyUI_00039_.png',
    src: pic(9),
    seconds: 9.91,
    outputs: 2,
    day: 'Yesterday'
  }
]

// ── Model Library (Desktop): the models folder, by kind. ──
export interface ModelFolder {
  name: string
  models: string[]
}
export const MODEL_FOLDERS: ModelFolder[] = [
  {
    name: 'checkpoints',
    models: [
      'flux1-dev-fp8.safetensors',
      'sd_xl_base_1.0.safetensors',
      'juggernautXL_v9.safetensors'
    ]
  },
  {
    name: 'diffusion_models',
    models: ['qwen_image_edit_2511_fp8.safetensors', 'wan2.2_t2v_14B_fp8.safetensors']
  },
  {
    name: 'loras',
    models: ['film-grain-xl.safetensors', 'Qwen-Image-Lightning-4steps.safetensors']
  },
  {
    name: 'text_encoders',
    models: ['qwen_2.5_vl_7b_fp8.safetensors', 't5xxl_fp8_e4m3fn.safetensors']
  },
  { name: 'vae', models: ['qwen_image_vae.safetensors', 'ae.safetensors'] },
  { name: 'upscale_models', models: ['4x-UltraSharp.pth'] },
  { name: 'controlnet', models: [] },
  { name: 'clip_vision', models: [] }
]
/** Desktop: a download in progress, above the tree. */
export const DOWNLOAD = { file: 'wan2.2_i2v_14B_fp8.safetensors', progress: 0.62 }

// ── Model Library (Cloud): the Asset Browser's cards. ──
export interface CloudModel {
  name: string
  type: string
  base: string
  format: string
  src: string
  imported?: boolean
}
export const CLOUD_MODEL_TYPES = [
  'Checkpoints',
  'Diffusion models',
  'LoRAs',
  'Text encoders',
  'VAE',
  'Upscale models',
  'ControlNet'
]
export const CLOUD_MODELS: CloudModel[] = [
  {
    name: 'FLUX.1 [dev] fp8',
    type: 'Checkpoints',
    base: 'Flux.1 D',
    format: 'safetensors',
    src: pic(1)
  },
  {
    name: 'Qwen Image Edit 2511',
    type: 'Diffusion models',
    base: 'Qwen Image',
    format: 'safetensors',
    src: pic(2)
  },
  {
    name: 'Wan 2.2 T2V 14B',
    type: 'Diffusion models',
    base: 'Wan 2.2',
    format: 'safetensors',
    src: pic(4)
  },
  {
    name: 'SDXL Base 1.0',
    type: 'Checkpoints',
    base: 'SDXL 1.0',
    format: 'safetensors',
    src: pic(6)
  },
  {
    name: 'Juggernaut XL v9',
    type: 'Checkpoints',
    base: 'SDXL 1.0',
    format: 'safetensors',
    src: pic(8)
  },
  {
    name: 'Qwen Image Lightning 4 steps',
    type: 'LoRAs',
    base: 'Qwen Image',
    format: 'safetensors',
    src: pic(10)
  },
  {
    name: 'Film Grain XL',
    type: 'LoRAs',
    base: 'SDXL 1.0',
    format: 'safetensors',
    src: pic(11),
    imported: true
  },
  { name: '4x UltraSharp', type: 'Upscale models', base: 'Other', format: 'pth', src: pic(12) }
]

// ── Workflows and Apps: saved files. ──
export interface FileNode {
  name: string
  children?: FileNode[]
}
export const WORKFLOW_TREE: FileNode[] = [
  {
    name: 'portraits',
    children: [{ name: 'portrait-sun' }, { name: 'portrait-window' }, { name: 'portrait-garden' }]
  },
  { name: 'product', children: [{ name: 'product-relight' }, { name: 'packshot-360' }] },
  { name: 'flux-txt2img' },
  { name: 'qwen-multiple-angles' },
  { name: 'wan-i2v' }
]
export const APPS: string[] = ['Product relight', 'Portrait retouch', 'Storyboard frames']

// ── Keyboard Shortcuts: ComfyUI's defaults, in its columns. ──
export interface ShortcutColumn {
  title: string
  rows: [label: string, keys: string[]][]
}
export const SHORTCUTS: Record<'Essential' | 'View Controls', ShortcutColumn[]> = {
  Essential: [
    {
      title: 'Workflow',
      rows: [
        ['New Blank Workflow', ['Alt', 'N']],
        ['Open Workflow', ['Ctrl', 'O']],
        ['Save Workflow', ['Ctrl', 'S']],
        ['Undo', ['Ctrl', 'Z']],
        ['Redo', ['Ctrl', 'Y']]
      ]
    },
    {
      title: 'Node',
      rows: [
        ['Bypass/Unbypass Selected Nodes', ['Ctrl', 'B']],
        ['Mute/Unmute Selected Nodes', ['Ctrl', 'M']],
        ['Collapse/Expand Selected Nodes', ['Alt', 'C']],
        ['Group Selected Nodes', ['Ctrl', 'G']],
        ['Pin/Unpin Selected Items', ['P']]
      ]
    },
    {
      title: 'Queue',
      rows: [
        ['Queue Prompt', ['Ctrl', '↵']],
        ['Queue Prompt (Front)', ['Ctrl', 'Shift', '↵']],
        ['Interrupt', ['Ctrl', 'Alt', '↵']]
      ]
    }
  ],
  'View Controls': [
    {
      title: 'View',
      rows: [
        ['Zoom In', ['Alt', '=']],
        ['Zoom Out', ['Alt', '-']],
        ['Fit view to selected nodes', ['.']],
        ['Toggle Focus Mode', ['F']],
        ['Toggle Minimap', ['Alt', 'M']]
      ]
    },
    {
      title: 'Panel Controls',
      rows: [
        ['Toggle Assets Sidebar', ['A']],
        ['Toggle Node Library Sidebar', ['N']],
        ['Toggle Model Library Sidebar', ['M']],
        ['Toggle Workflows Sidebar', ['W']],
        ['Toggle Bottom Panel', ['Ctrl', '`']],
        ['Show Keybindings Dialog', ['Ctrl', 'Shift', 'K']]
      ]
    }
  ]
}
