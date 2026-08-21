/**
 * Renderer-facing dev-platform types.
 *
 * The wire shapes live in `src/types/ipc.ts` (the single IPC source of truth);
 * this file just re-exports them under the shorter names the views use, so a
 * component imports `Build` from one local place.
 */
import type { DevPlatformBuild, DevPlatformBuildState } from '../../../types/ipc'

export type Build = DevPlatformBuild
export type BuildState = DevPlatformBuildState
