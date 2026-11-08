/** Release eligibility for catalog selection and sealed-manifest lookup.
 * Artifact readiness and host compatibility are checked separately. */
export function isTerminalRelease(status: string): boolean {
  return status === 'complete' || status === 'stopped'
}
