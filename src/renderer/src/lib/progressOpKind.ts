import type { ShowProgressOpts } from '../types/ipc'

export type ProgressOpKind = NonNullable<ShowProgressOpts['opKind']>

export function progressOpKindForActionId(actionId: string): ProgressOpKind {
  switch (actionId) {
    case 'launch':
    case 'restart':
      return 'launch'
    // A version check is a read, not an update - it must never paint
    // update-op UI (the dashboard tile's "Updating" pill keys on this kind),
    // and the includes('update') fallback below would misclassify it.
    case 'check-update':
      return 'generic'
    case 'delete':
      return 'destructive'
    case 'restore-snapshot':
      return 'snapshot'
    case 'release-update':
    case 'copy-update':
    case 'copy-pytorch':
    case 'update':
      return 'update'
    default:
      if (actionId.startsWith('install')) return 'install'
      if (actionId.startsWith('snapshot')) return 'snapshot'
      if (actionId.includes('update')) return 'update'
      return 'generic'
  }
}

/** Whether the action removes the install from the registry on success. */
export function destroysInstanceForActionId(actionId: string): boolean {
  return actionId === 'delete'
}
