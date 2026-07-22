/**
 * TEMPORARY fixtures for the chooser's Comfy Builder tiles.
 *
 * The builder API's pipeline list isn't exposed over IPC yet, so the store
 * serves these. Delete this file when the real endpoint lands.
 */
import type { Distribution } from './types'

/** One fixture per tile state so the whole vocabulary is reviewable at once. */
export const MOCK_DISTRIBUTIONS: Distribution[] = [
  {
    id: 'dist-image-baseline',
    name: 'ComfyUI — Image Baseline',
    description: 'Core image environment: frontend, models and the approved node set.',
    version: '137',
    finishedAt: '2026-07-21T16:40:00Z',
    sizeBytes: 24_800_000_000,
    state: 'installable',
  },
  {
    id: 'dist-video-suite',
    name: 'ComfyUI — Video Suite',
    description: 'Video generation and upscale chain.',
    version: '12.0',
    finishedAt: '2026-07-14T11:05:00Z',
    sizeBytes: 18_300_000_000,
    state: 'update-available',
    installedVersion: '11.3',
  },
  {
    id: 'dist-sdxl-essentials',
    name: 'ComfyUI — SDXL Essentials',
    description: 'Lightweight SDXL environment with ControlNet.',
    version: '3.1',
    finishedAt: '2026-07-09T08:30:00Z',
    sizeBytes: 9_450_000_000,
    state: 'installed',
    installedVersion: '3.1',
  },
  {
    id: 'dist-audio-lab',
    name: 'ComfyUI — Audio Lab',
    description: 'Audio generation environment.',
    state: 'no-build',
    blockedReason: 'buildFailed',
  },
  {
    id: 'dist-3d-toolkit',
    name: 'ComfyUI — 3D Toolkit',
    description: '3D generation and texturing environment.',
    version: '4.7',
    finishedAt: '2026-07-18T10:00:00Z',
    sizeBytes: 15_100_000_000,
    state: 'platform-mismatch',
    blockedReason: 'noArtifactForMachine',
  },
  {
    id: 'dist-research-nightly',
    name: 'ComfyUI — Research Nightly',
    description: 'Bleeding-edge research environment.',
    version: '0.9',
    state: 'needs-desktop-update',
    blockedReason: 'needsDesktopUpdate',
    minDesktopVersion: '99.0.0',
  },
]
