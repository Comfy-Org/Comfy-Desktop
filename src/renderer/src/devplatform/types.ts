/**
 * Renderer-facing Comfy Builder types. Field names mirror the shipped DTOs
 * (`src/main/comfybuilder/dto.ts`) where a real field exists, so swapping the
 * mocks for the real client stays mechanical.
 *
 * Vocabulary: the API noun is `Pipeline`; the user-facing noun is
 * "distribution" — a `Distribution` is a pipeline + its latest deployment,
 * flattened for the UI. "Pipeline" never appears in copy.
 */

/**
 * Every state a distribution tile can be in. The first four are pre-install —
 * a distribution is never hidden for being un-installable, it is shown with a
 * reason. The last two are post-install.
 */
export type DistributionState =
  | 'installable'
  | 'no-build'
  | 'platform-mismatch'
  | 'needs-desktop-update'
  | 'installed'
  | 'update-available'

/** A distribution: a versioned, self-contained ComfyUI environment. NAME is
 *  the primary key in the UI; version is metadata. */
export interface Distribution {
  id: string
  name: string
  description?: string
  version?: string
  /** ISO 8601 finish stamp of the latest succeeded deployment. */
  finishedAt?: string
  sizeBytes?: number
  state: DistributionState
  /** i18n suffix explaining a blocking state (see `devPlatform.distribution.blockedReason.*`). */
  blockedReason?: string
  minDesktopVersion?: string
  /** Local-only: present for installed / update-available. */
  installedVersion?: string
}
