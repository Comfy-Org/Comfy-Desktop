import type { InstallationRecord } from '../installations'

export function expectedPartitionFor(installation: InstallationRecord): string {
  return (installation.browserPartition as string | undefined) === 'unique'
    ? `persist:${installation.id}`
    : 'persist:shared'
}
