import { readonly, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { deployToCloudPrompt } from '../lib/deployToCloudPrompt'
import type { AgentApp, Installation } from '../types/ipc'

const promotingInstallationIds = ref<ReadonlySet<string>>(new Set())
const deployTarget = ref<Installation | null>(null)

export const deployToCloudTarget = readonly(deployTarget)

export function isPromotingToWorkspace(inst: Installation): boolean {
  return promotingInstallationIds.value.has(inst.id)
}

function setPromotingToWorkspace(installationId: string, promoting: boolean): void {
  const next = new Set(promotingInstallationIds.value)
  if (promoting) next.add(installationId)
  else next.delete(installationId)
  promotingInstallationIds.value = next
}

export function openDeployToCloud(inst: Installation): void {
  deployTarget.value = inst
}

export function closeDeployToCloud(): void {
  deployTarget.value = null
}

export function useDeployToCloud() {
  const { t } = useI18n()
  const modal = useModal()

  async function setUpManually(inst: Installation): Promise<boolean> {
    if (isPromotingToWorkspace(inst)) return false
    let failureMessage: string | null = null
    setPromotingToWorkspace(inst.id, true)
    try {
      const result = await window.api.comfybuilder.promoteLocalInstance(inst.id)
      if (!result.ok) {
        failureMessage = result.message || t('devPlatform.workspace.promoteFailedMessage')
      }
    } catch (err) {
      failureMessage = (err as Error)?.message || String(err)
    } finally {
      setPromotingToWorkspace(inst.id, false)
    }
    if (failureMessage) {
      await modal.alert({
        title: t('devPlatform.workspace.promoteFailedTitle'),
        message: failureMessage
      })
    }
    return failureMessage === null
  }

  async function openAgent(app: AgentApp, inst: Installation): Promise<boolean> {
    try {
      return await window.api.comfybuilder.openAgentApp(app, deployToCloudPrompt(inst))
    } catch {
      return false
    }
  }

  async function copyPrompt(inst: Installation): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(deployToCloudPrompt(inst))
      return true
    } catch {
      return false
    }
  }

  return {
    target: deployToCloudTarget,
    close: closeDeployToCloud,
    setUpManually,
    openAgent,
    copyPrompt
  }
}
