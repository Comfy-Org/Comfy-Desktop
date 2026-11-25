const claims = new Map<string, number>()
let lastClaim = 0

export function claimWindowForWorkspace(installationId: string): () => boolean {
  const claim = ++lastClaim
  claims.set(installationId, claim)
  return () => claims.get(installationId) === claim
}

export function releaseWindowWorkspaceClaim(installationId: string): void {
  claims.delete(installationId)
}

export function _resetWorkspaceClaimsForTest(): void {
  claims.clear()
}
