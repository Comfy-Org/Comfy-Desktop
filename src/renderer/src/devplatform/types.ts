/**
 * Renderer-facing dev-platform types.
 *
 * The wire shapes live in `src/types/ipc.ts` (the single IPC source of truth);
 * this file just re-exports them under the shorter names the views use, so a
 * component imports `Distribution` from one local place.
 */
import type { DevPlatformDistribution, DevPlatformDistributionState } from '../../../types/ipc'

export type Distribution = DevPlatformDistribution
export type DistributionState = DevPlatformDistributionState
