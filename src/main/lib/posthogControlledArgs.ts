/**
 * The launch args a PostHog payload may put on a ComfyUI command line.
 *
 * A SECURITY allowlist, not a beta concept: membership means "we are prepared to have this arg
 * under remote control", and every channel that grants from a payload (`coreBetaGrants.ts` today)
 * reads it from here. That is this list's only job. It is not a registry of grant-owned tokens,
 * and membership says nothing about whether a user may pass the same arg by hand (they may, and
 * the user's own arg always wins).
 *
 * An entry need not exist in Core yet: `--disable-assets` is the planned remote force-off for
 * when assets go default-on, and `--enable-agent` lands here ahead of the Core flag because
 * Desktop reaches users on its own update cadence — the allowlist has to already be installed
 * before a payload can grant anything. Granting an arg Core cannot parse is safe meanwhile: the
 * running core's supported-argument schema filters it and the launch reports it as
 * `dropped_unsupported`.
 *
 * Each row states its relations explicitly rather than having them derived from the
 * `--enable-`/`--disable-` prefix, so an arg whose opposite does not follow that pattern has to
 * be written down, not guessed. A test pins every row to the prefix derivation the rows replaced.
 */

export interface PostHogControlledArg {
  readonly arg: string
  /** The token that contradicts this one. A payload naming both grants nothing, and a user's
   *  copy of either withholds a grant of the other. `null` for an arg with no negated form. */
  readonly opposite: string | null
  /** Whether a grant turns a feature on or off. Drives the wording of anything announcing it. */
  readonly direction: 'enable' | 'disable'
  /** Whether a channel that ramps beyond opted-in users must name the Core bugs this arg is
   *  blocked on before it may grant it. Turning a feature on can expose a user to its bugs;
   *  turning one off is the safe direction. */
  readonly requiresBlockers: boolean
}

export const POSTHOG_CONTROLLED_ARGS: readonly PostHogControlledArg[] = [
  {
    arg: '--enable-assets',
    opposite: '--disable-assets',
    direction: 'enable',
    requiresBlockers: true
  },
  {
    arg: '--enable-asset-hashing',
    opposite: '--disable-asset-hashing',
    direction: 'enable',
    requiresBlockers: true
  },
  {
    arg: '--disable-assets',
    opposite: '--enable-assets',
    direction: 'disable',
    requiresBlockers: false
  },
  {
    arg: '--enable-agent',
    opposite: '--disable-agent',
    direction: 'enable',
    requiresBlockers: true
  }
]

const BY_ARG: ReadonlyMap<string, PostHogControlledArg> = new Map(
  POSTHOG_CONTROLLED_ARGS.map((row) => [row.arg, row])
)

/** The row for `arg`, or `undefined` when a payload may not grant it. */
export function controlledArg(arg: string): PostHogControlledArg | undefined {
  return BY_ARG.get(arg)
}

export function isControlledArg(arg: string): boolean {
  return BY_ARG.has(arg)
}

/** The token that contradicts `arg`, or `null` for an arg with no negated form or one outside the
 *  allowlist. Every caller passes a granted, and therefore allowlisted, arg. */
export function oppositeArg(arg: string): string | null {
  return BY_ARG.get(arg)?.opposite ?? null
}
