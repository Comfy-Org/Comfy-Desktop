/**
 * PostHog flag keys read on BOTH sides of the process boundary, plus the
 * predicate that turns a raw flag value into a branch.
 *
 * Main reads them with `getFlag()` (`main/lib/experiments.ts`); the renderer
 * reads the same key over `window.api.telemetryGetExperimentFlag`. Keeping the
 * key and the "is it on?" rule in one place is what stops the two surfaces
 * drifting into opposite arms of the same rollout.
 */

/**
 * Comfy Builder availability for a SIGNED-IN account: whether the distribution
 * catalog, installs and updates are offered once we know who the user is.
 *
 * It deliberately does NOT gate logging in. The rollout is decided per account,
 * so the decision cannot be made until the user has logged in — gating the
 * login button behind it would put the flag's own precondition behind the flag.
 * Log in is therefore always reachable from the title-bar file menu; what an
 * account may then DO is what this key governs.
 *
 * Boolean rollout flag, not multivariate. Declared here rather than at a call
 * site because the surfaces it will gate span both processes.
 */
export const COMFY_BUILDER_FLAG_KEY = 'desktop-comfy-builder'

/**
 * Whether a rollout gate is open. Deliberately strict: ONLY a boolean `true`
 * enables. An absent flag (no cache on first boot, PostHog unreachable, consent
 * not granted so no fetch ever ran) arrives as `undefined`/`null` and resolves
 * to OFF, which is also the arm we ship to everyone the rollout has not reached.
 */
export function isFlagEnabled(value: string | boolean | null | undefined): boolean {
  return value === true
}
