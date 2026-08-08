/**
 * PostHog flag keys read on BOTH sides of the process boundary, plus the
 * predicate that turns a raw flag value into a branch.
 *
 * Main reads them with `getFlag()` (`main/lib/experiments.ts`); the renderer
 * reads the same key over `window.api.telemetryGetExperimentFlag`. Keeping the
 * key and the "is it on?" rule in one place is what stops the two surfaces
 * drifting into opposite arms of the same experiment.
 */

/**
 * Comfy Builder availability. Gates every Comfy Builder affordance — today the
 * file-menu sign-in item and the chooser account chip's signed-out CTA.
 *
 * Boolean rollout flag, not multivariate.
 */
export const COMFY_BUILDER_FLAG_KEY = 'desktop-comfy-builder'

/**
 * Whether a Comfy Builder gate is open. Deliberately strict: ONLY a boolean
 * `true` enables. An absent flag (no cache on first boot, PostHog unreachable,
 * consent not granted so no fetch ever ran) arrives as `undefined`/`null` and
 * resolves to OFF, which is also the arm we ship to everyone the rollout has
 * not reached.
 */
export function isFlagEnabled(value: string | boolean | null | undefined): boolean {
  return value === true
}
