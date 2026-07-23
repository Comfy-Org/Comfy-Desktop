/**
 * TEMPORARY fixtures for the chooser's Comfy Builder tiles.
 *
 * The builder API's pipeline list isn't exposed over IPC yet, so the store
 * serves these. Delete this file when the real endpoint lands.
 */
import type { Distribution, WorkspaceOption } from './types'

/** TEMP: workspace options for the mock switcher — the real list comes from
 *  the platform once the token re-scope endpoint exists. */
export const MOCK_WORKSPACES: WorkspaceOption[] = [
  { id: 'ws-personal', name: 'Personal', type: 'personal', role: 'owner' },
  { id: 'ws-design', name: 'Comfy Design Team', type: 'team', role: 'member' },
  { id: 'ws-frontend', name: 'Comfy Front End', type: 'team', role: 'admin' },
]

/** One fixture per tile state so the whole vocabulary is reviewable at once. */
export const MOCK_DISTRIBUTIONS: Distribution[] = [
  {
    id: 'dist-image-baseline',
    name: 'CMFY-The-Matrix',
    description: 'Core image environment: frontend, models and the approved node set.',
    version: '3',
    comfyuiVersion: '0.28.2',
    finishedAt: '2026-07-21T16:40:00Z',
    sizeBytes: 24_800_000_000,
    state: 'installable',
  },
  {
    id: 'dist-video-suite',
    name: 'CMFY-Blade-Runner',
    description: 'Video generation and upscale chain.',
    version: '13',
    comfyuiVersion: '0.28.0',
    finishedAt: '2026-07-14T11:05:00Z',
    sizeBytes: 18_300_000_000,
    state: 'update-available',
    installedVersion: '12',
  },
  {
    id: 'dist-sdxl-essentials',
    name: 'CMFY-Inception',
    description: 'Lightweight SDXL environment with ControlNet.',
    version: '4',
    comfyuiVersion: '0.27.5',
    finishedAt: '2026-07-09T08:30:00Z',
    sizeBytes: 9_450_000_000,
    state: 'installed',
    installedVersion: '4',
  },
  {
    id: 'dist-audio-lab',
    name: 'CMFY-Audio-Lab',
    description: 'Audio generation environment.',
    state: 'no-build',
    blockedReason: 'buildFailed',
  },
  {
    id: 'dist-3d-toolkit',
    name: 'CMFY-3D-Suite',
    description: '3D generation and texturing environment.',
    version: '5',
    comfyuiVersion: '0.28.1',
    finishedAt: '2026-07-18T10:00:00Z',
    sizeBytes: 15_100_000_000,
    state: 'platform-mismatch',
    blockedReason: 'noArtifactForMachine',
  },
  {
    id: 'dist-research-nightly',
    name: 'CMFY-Interstellar',
    description: 'Bleeding-edge research environment.',
    version: '1',
    comfyuiVersion: '0.29.0',
    state: 'needs-desktop-update',
    blockedReason: 'needsDesktopUpdate',
    minDesktopVersion: '99.0.0',
  },
]
