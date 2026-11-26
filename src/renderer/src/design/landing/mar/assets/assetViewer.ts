import { reactive } from 'vue'
import type { MarAsset } from '../pages/assetsStore'

export type ViewerKind = 'exr' | '3d'
export type DetailTab = 'details' | 'viewer'

export const viewerKind = (a: Pick<MarAsset, 'name' | 'type'>): ViewerKind | undefined =>
  a.type === '3d' ? '3d' : /\.exr$/i.test(a.name) ? 'exr' : undefined

export type ExrChannel = 'rgb' | 'r' | 'g' | 'b' | 'a'
export const EXR_CHANNELS: { value: ExrChannel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'R' },
  { value: 'g', label: 'G' },
  { value: 'b', label: 'B' },
  { value: 'a', label: 'A' }
]
export const EXR_GAMUTS = ['sRGB', 'Display P3', 'Rec. 2020', 'ACEScg', 'Linear sRGB'] as const

export const exrView = reactive({
  exposure: 0,
  channel: 'rgb' as ExrChannel,
  gamut: 'sRGB' as (typeof EXR_GAMUTS)[number],
  dither: true,
  clip: false,
  alpha: false
})

export const AUTO_EXPOSURE = 0.8

export type Material = 'original' | 'normal' | 'wireframe'
export type Camera = 'perspective' | 'orthographic'
export type ExportFormat = 'glb' | 'obj' | 'stl'
export const MODEL_BACKGROUNDS = ['#1c1c1f', '#3a3a40', '#8a8f98', '#e8e6e1', '#22303a'] as const

export const modelView = reactive({
  background: MODEL_BACKGROUNDS[0] as string,
  material: 'original' as Material,
  camera: 'perspective' as Camera,
  fov: 50,
  light: 1,
  format: 'glb' as ExportFormat
})
