import { useAuthStore } from '../stores/authStore'
import type { Installation } from '../types/ipc'

export function useCanPromoteToWorkspace(): (inst: Installation) => boolean {
  const authStore = useAuthStore()
  return (inst) =>
    authStore.isSignedIn &&
    Boolean(authStore.status.workspaceId) &&
    inst.status === 'installed' &&
    inst.sourceCategory === 'local' &&
    Boolean(inst.installPath)
}
