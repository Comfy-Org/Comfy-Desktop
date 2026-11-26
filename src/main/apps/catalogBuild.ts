import { meetsCatalogWorkflowMinimum } from '../../shared/catalogWorkflowCompatibility'
import { isInstallationInWorkspace } from '../../shared/workspaces'
import * as installations from '../installations'
import * as i18n from '../lib/i18n'
import type { LocalBuild } from './localBuild'

export interface CatalogBuildRules {
  workspaceId: string
  minComfyUIVersion: string | null
}

export async function catalogBuildRefusal(
  build: LocalBuild,
  { workspaceId, minComfyUIVersion }: CatalogBuildRules
): Promise<string | null> {
  const installation = await installations.get(build.id)
  if (!installation || !isInstallationInWorkspace(installation, workspaceId)) {
    return i18n.t('apps.local.openUnknownBuild')
  }
  if (!meetsCatalogWorkflowMinimum(build.version, minComfyUIVersion)) {
    return i18n.t('workflowLaunch.updateBuild', { version: minComfyUIVersion ?? '' })
  }
  return null
}
