/**
 * Cinematic Studio's direction, as on the hub (comfy.org/hub/apps/
 * cinematic-studio, ComfyUI_frontend `lib/workshop/cinematic-studio/
 * catalog.ts`): the camera, then the shot, light, film, look and grade,
 * each a picture or a palette you pick from. Same options, same defaults.
 */
import type { DirectionPart } from './cameraIcons'

const files = import.meta.glob<string>('./cinematic/*.webp', { eager: true, import: 'default' })
const frame = (name: string): string => files[`./cinematic/${name}.webp`] ?? ''

export interface CineOption {
  label: string
  preview?: string
  palette?: string[]
  /** The hub's camera icon for it. */
  icon?: string
}
export interface CineGroup {
  id: string
  label: string
  /** Which hub camera icons it draws. */
  part?: DirectionPart
  options: CineOption[]
}

const AUTO: CineOption = { label: 'Auto', icon: 'auto' }

/** The camera: four lists you pick one from each. */
export const CAMERA: CineGroup[] = [
  {
    id: 'camera',
    label: 'Body',
    part: 'body',
    options: [
      AUTO,
      ...(
        [
          ['Digital cinema', 'digital'],
          ['Large format', 'large'],
          ['Super 35', 'super35'],
          ['35mm film', 'film35'],
          ['16mm film', 'film16'],
          ['Handheld', 'handheld']
        ] as const
      ).map(([label, icon]) => ({ label, icon }))
    ]
  },
  {
    id: 'lens',
    label: 'Lens',
    part: 'lens',
    options: [
      AUTO,
      ...(
        [
          ['Spherical', 'prime'],
          ['Anamorphic', 'anamorphic'],
          ['Vintage', 'vintage'],
          ['Macro', 'macro'],
          ['Tilt-shift', 'tilt']
        ] as const
      ).map(([label, icon]) => ({ label, icon }))
    ]
  },
  {
    id: 'focal',
    label: 'Focal length',
    part: 'focal',
    options: [
      AUTO,
      ...['14', '24', '35', '50', '85', '135'].map((mm) => ({ label: `${mm}mm`, icon: mm }))
    ]
  },
  {
    id: 'aperture',
    label: 'Aperture',
    part: 'aperture',
    options: [AUTO, ...['1.4', '2', '2.8', '4', '8'].map((f) => ({ label: `f/${f}`, icon: f }))]
  }
]

const pics = (prefix: string, list: [string, string][]): CineOption[] => [
  AUTO,
  ...list.map(([label, name]) => ({ label, preview: frame(`${prefix}-${name}`) }))
]

/** The look: one picture each. */
export const LOOK: CineGroup[] = [
  {
    id: 'framing',
    label: 'Framing',
    options: pics('shot', [
      ['Extreme wide', 'xwide'],
      ['Wide', 'wide'],
      ['Medium', 'medium'],
      ['Close-up', 'close'],
      ['Extreme close-up', 'xclose'],
      ['Over the shoulder', 'ots'],
      ['Low angle', 'low']
    ])
  },
  {
    id: 'light',
    label: 'Light',
    options: pics('light', [
      ['Golden hour', 'golden'],
      ['Overcast', 'overcast'],
      ['Blue hour', 'blue'],
      ['Practical night', 'night'],
      ['Neon', 'neon'],
      ['Low key', 'lowkey'],
      ['Silhouette', 'silhouette']
    ])
  },
  {
    id: 'film',
    label: 'Film',
    options: pics('film', [
      ['Digital clean', 'clean'],
      ['Tungsten 500T', 't500'],
      ['Daylight 250D', 'd250'],
      ['Black & white 400', 'bw400'],
      ['Reversal slide', 'slide'],
      ['Expired film', 'expired'],
      ['Bleach bypass', 'bleach']
    ])
  },
  {
    id: 'look',
    label: 'Look',
    options: pics('look', [
      ['Neo-noir', 'neonoir'],
      ['Western', 'western'],
      ['Science fiction', 'scifi'],
      ['Period drama', 'drama'],
      ['Thriller', 'thriller'],
      ['Documentary', 'doc'],
      ['Road movie', 'road']
    ])
  },
  {
    id: 'grade',
    label: 'Grade',
    options: [
      { label: 'Auto', palette: ['#2a2330', '#3a3240', '#6e6875', '#8a8490', '#c2bfb9'] },
      {
        label: 'Teal and orange',
        palette: ['#0f2a36', '#1f5f6a', '#6f9aa0', '#e0a15e', '#f2c28b']
      },
      { label: 'Noir', palette: ['#0b0b0c', '#2b2b2e', '#6e6e73', '#bdbdc2', '#f0efed'] },
      { label: 'Kodachrome', palette: ['#1f3a5f', '#3d6b4f', '#c7462e', '#e8c35a', '#efe2c4'] },
      { label: 'Neon night', palette: ['#0d0a26', '#3b1b6e', '#ff3d8b', '#27d3f2', '#e6d8ff'] },
      { label: 'Desert dust', palette: ['#3a2414', '#8a5a34', '#c99a6a', '#e2b98a', '#f6e2bd'] },
      { label: 'Nordic cold', palette: ['#0d1318', '#1c2630', '#3f5566', '#8aa3b3', '#e6eef2'] }
    ]
  }
]

/** Where each starts, as on the hub. */
export const CINE_DEFAULTS: Record<string, string> = {
  mode: 'Image',
  model: 'Seedream 5.0 Pro',
  enhance: 'On',
  camera: 'Large format',
  lens: 'Anamorphic',
  focal: '50mm',
  aperture: 'f/2.8',
  framing: 'Medium',
  light: 'Practical night',
  film: 'Tungsten 500T',
  look: 'Neo-noir',
  grade: 'Teal and orange',
  aspect: '16:9',
  size: '2K',
  count: '1'
}

export const CINE_MODELS = ['Seedream 5.0 Pro', 'Nano Banana Pro', 'GPT Image 2', 'FLUX 2 Pro']
/** Who makes each model, for its mark. */
export const CINE_MODEL_AUTHOR: Record<string, string> = {
  'Seedream 5.0 Pro': 'ByteDance Seed',
  'Nano Banana Pro': 'Google',
  'GPT Image 2': 'OpenAI',
  'FLUX 2 Pro': 'Black Forest Labs'
}
export const CINE_ASPECTS: { value: string; label: string; hint: string }[] = [
  ['21:9', 'Scope'],
  ['16:9', 'Widescreen'],
  ['4:3', 'Academy'],
  ['3:2', 'Landscape photo'],
  ['2:3', 'Portrait photo'],
  ['1:1', 'Square'],
  ['9:16', 'Vertical']
].map(([value, hint]) => ({ value: value!, label: value!, hint: hint! }))
