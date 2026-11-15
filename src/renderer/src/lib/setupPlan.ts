import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import type { FieldOption, Source } from '../types/ipc'
import type { SystemInfo } from '../../../types/ipc'

export const NO_TEMPLATE_VALUE = 'none'
export const INSTALL_SPACE_FACTOR = 2.25

export interface SetupPlan {
  sourceId: string
  selections: Record<string, FieldOption>
  installRoot: string
  downloadBytes: number
  requiredBytes: number
}

export class SetupPlanUnavailable extends Error {}

function pickOption(fieldId: string, options: FieldOption[]): FieldOption | undefined {
  if (fieldId === 'bundledTemplate') {
    return options.find((o) => o.value === NO_TEMPLATE_VALUE) ?? options[0]
  }
  return options.find((o) => o.recommended) ?? options[0]
}

export function downloadBytesOf(variant: FieldOption | undefined): number {
  const files = variant?.data?.downloadFiles as Array<{ size: number }> | undefined
  return files ? files.reduce((sum, file) => sum + file.size, 0) : 0
}

export async function resolveSetupPlan(): Promise<SetupPlan> {
  const [installRoot, sources] = await Promise.all([
    window.api.getDefaultInstallDir().catch(() => ''),
    window.api.getSources()
  ])
  const standalone = sources.find((source: Source) => source.id === 'standalone')
  if (!standalone) throw new SetupPlanUnavailable('standalone source missing')

  const selections: Record<string, FieldOption> = {}
  for (const field of standalone.fields) {
    if (field.type === 'text') {
      if (field.defaultValue !== undefined) {
        selections[field.id] = { value: field.defaultValue, label: field.defaultValue }
      }
      continue
    }
    const options = await window.api.getFieldOptions(
      standalone.id,
      field.id,
      selections,
      field.id === 'release' ? { includeLatestStable: true } : undefined
    )
    if (field.id === 'comfyVersion' && options.length === 0) continue
    const pick = pickOption(field.id, options ?? [])
    if (!pick) throw new SetupPlanUnavailable(`no options for ${field.id}`)
    selections[field.id] = pick
  }

  const downloadBytes = downloadBytesOf(selections.variant)
  return {
    sourceId: standalone.id,
    selections,
    installRoot: installRoot ?? '',
    downloadBytes,
    requiredBytes: Math.ceil(downloadBytes * INSTALL_SPACE_FACTOR)
  }
}

export function isCpuVariant(variant: FieldOption | undefined): boolean {
  const id = String(variant?.data?.variantId ?? variant?.value ?? '')
  return /(^|-)cpu($|-)/.test(id)
}

export function planVersion(plan: SetupPlan): string {
  const picked = plan.selections.comfyVersion?.value
  if (picked) return picked
  const tag = plan.selections.release?.data?.latestStableTag
  return typeof tag === 'string' ? tag : ''
}

export type SetupPlatform = 'mac' | 'pc' | 'computer'

export function setupPlatform(platform: string | undefined): SetupPlatform {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'pc'
  return 'computer'
}

export function machineName(info: SystemInfo | null, cpuOnly: boolean): string {
  if (!info) return ''
  const gpu = info.gpu_model || info.gpu_label
  return (!cpuOnly && gpu) || info.cpu_model || gpu || ''
}

export function installLocation(root: string, platform: string | undefined): string {
  if (!root) return ''
  const sep = platform === 'win32' ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${DEFAULT_INSTALL_NAME}`
}

export function displayPath(fullPath: string, platform: string | undefined): string {
  if (platform === 'darwin') return fullPath.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
  if (platform === 'linux') return fullPath.replace(/^\/home\/[^/]+(?=\/|$)/, '~')
  return fullPath
}
