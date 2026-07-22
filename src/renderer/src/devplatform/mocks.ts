/**
 * TEMPORARY test doubles for the chooser's Comfy Builder surface.
 *
 * The builder API's pipeline list isn't exposed over IPC yet, so the store
 * serves these fixtures. Delete this file when the real endpoint lands.
 *
 * Mock session: set `localStorage.comfy.devplatform.mockSession = '1'` (or
 * launch with `VITE_DEVPLATFORM_MOCK=1 pnpm dev`) to boot signed-in with a
 * mock identity — no browser handoff, no backend.
 */
import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { Distribution } from './types'

export const MOCK_SESSION_KEY = 'comfy.devplatform.mockSession'

export function mockSessionEnabled(): boolean {
  try {
    if (window.localStorage.getItem(MOCK_SESSION_KEY) === '1') return true
  } catch {
    // Storage unavailable — fall through to the build-time flag.
  }
  return import.meta.env.VITE_DEVPLATFORM_MOCK === '1'
}

export const MOCK_AUTH_STATUS: AuthStatus = {
  signedIn: true,
  email: 'willie@comfy.org',
  workspaceId: 'A24 — Feature VFX',
  workspaceType: 'team',
  role: 'member',
}

/** One fixture per tile state so the whole vocabulary is reviewable at once. */
export const MOCK_DISTRIBUTIONS: Distribution[] = [
  {
    id: 'dist-toy-story-9',
    name: 'Toy Story 9 — Shot Pipeline',
    description: 'Locked shot environment: core, frontend, models and node set for the show.',
    version: '137',
    finishedAt: '2026-07-21T16:40:00Z',
    sizeBytes: 24_800_000_000,
    state: 'installable',
  },
  {
    id: 'dist-concept-art',
    name: 'Concept Art — SDXL + ControlNet',
    description: 'Art department board environment with the approved SDXL and ControlNet set.',
    version: '12.0',
    finishedAt: '2026-07-14T11:05:00Z',
    sizeBytes: 18_300_000_000,
    state: 'update-available',
    installedVersion: '11.3',
  },
  {
    id: 'dist-previz-turntable',
    name: 'Previz Turntable',
    description: 'Lightweight previz environment for turntables and layout blocking.',
    version: '3.1',
    finishedAt: '2026-07-09T08:30:00Z',
    sizeBytes: 9_450_000_000,
    state: 'installed',
    installedVersion: '3.1',
  },
  {
    id: 'dist-lighting-lookdev',
    name: 'Lighting Lookdev',
    description: 'Lookdev environment used by the lighting team.',
    state: 'no-build',
    blockedReason: 'buildFailed',
  },
  {
    id: 'dist-char-fx',
    name: 'Character FX — Sim Suite',
    description: 'Simulation environment for the character FX team.',
    version: '4.7',
    finishedAt: '2026-07-18T10:00:00Z',
    sizeBytes: 15_100_000_000,
    state: 'platform-mismatch',
    blockedReason: 'noArtifactForMachine',
  },
]
