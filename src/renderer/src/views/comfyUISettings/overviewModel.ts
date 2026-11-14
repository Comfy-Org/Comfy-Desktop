import type { ActionDef, DetailField, DetailFieldOption, DetailSection } from '../../types/ipc'

export interface OverviewChannel {
  value: string
  label: string
  description?: string
  installedVersion?: string
  latestVersion?: string
  lastChecked?: string
  lastCheckedAt?: number
  updateAvailable: boolean
  enriching: boolean
  actions: ActionDef[]
}

export interface OverviewTorchVersion {
  value: string
  version: string
  description?: string
  current: boolean
  actions: ActionDef[]
}

export interface OverviewTorchGroup {
  id: string
  label: string
  versions: OverviewTorchVersion[]
}

export interface OverviewTorch {
  label: string
  current: string
  groups: OverviewTorchGroup[]
}

export interface BuildOverviewModel {
  channelLabel: string
  channelTooltip?: string
  currentChannel: string
  channels: OverviewChannel[]
  checkAction?: ActionDef
  torch: OverviewTorch | null
  facts: Partial<Record<OverviewFactKey, OverviewFact>>
}

export interface OverviewFact {
  label: string
  value: string
}

export type OverviewFactKey =
  | 'comfyui-version'
  | 'variant'
  | 'python'
  | 'pytorch'
  | 'location'
  | 'lineage'
  | 'active-port'

const FACT_KEYS: OverviewFactKey[] = [
  'comfyui-version',
  'variant',
  'python',
  'pytorch',
  'location',
  'lineage',
  'active-port'
]

const EMPTY_VALUE = '—'

function fieldKey(field: DetailField): string | undefined {
  return (field as DetailField & { key?: string }).key ?? field.id
}

function textValue(field: DetailField): string | undefined {
  const v = field.value
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v).trim()
  return s && s !== EMPTY_VALUE ? s : undefined
}

function actionsOf(option: DetailFieldOption): ActionDef[] {
  const actions = option.data?.actions
  return Array.isArray(actions) ? (actions as ActionDef[]) : []
}

function optionText(option: DetailFieldOption, key: string): string | undefined {
  const v = option.data?.[key]
  return typeof v === 'string' && v !== EMPTY_VALUE ? v : undefined
}

function toChannel(option: DetailFieldOption): OverviewChannel {
  const checkedAt = option.data?.lastCheckedAt
  return {
    value: option.value,
    label: option.label,
    description: option.description,
    installedVersion: optionText(option, 'installedVersion'),
    latestVersion: optionText(option, 'latestVersion'),
    lastChecked: optionText(option, 'lastChecked'),
    lastCheckedAt: typeof checkedAt === 'number' ? checkedAt : undefined,
    updateAvailable: option.data?.updateAvailable === true,
    enriching: option.data?.enriching === true,
    actions: actionsOf(option)
  }
}

function torchVersionLabel(option: DetailFieldOption): string {
  return option.label.replace(/^PyTorch\s+/, '')
}

function toTorch(field: DetailField): OverviewTorch {
  const current = String(field.value ?? '')
  const groups = new Map<string, OverviewTorchGroup>()
  for (const option of field.options ?? []) {
    const group = option.groupPath?.[0]
    const id = group?.id ?? ''
    if (!groups.has(id)) groups.set(id, { id, label: group?.label ?? '', versions: [] })
    groups.get(id)!.versions.push({
      value: option.value,
      version: torchVersionLabel(option),
      description: option.description,
      current: option.value === current,
      actions: actionsOf(option)
    })
  }
  const picked = (field.options ?? []).find((o) => o.value === current)
  return {
    label: field.label,
    current: picked ? torchVersionLabel(picked) : '',
    groups: [...groups.values()]
  }
}

function allFields(sections: DetailSection[]): DetailField[] {
  return sections.flatMap((s) => s.fields ?? [])
}

export function buildOverviewModel(
  updateSections: DetailSection[],
  statusSections: DetailSection[]
): BuildOverviewModel | null {
  const updateFields = allFields(updateSections)
  const channelField = updateFields.find(
    (f) => f.id === 'updateChannel' && f.editType === 'channel-cards'
  )
  if (!channelField) return null
  const torchField = updateFields.find(
    (f) => f.id === 'pytorchStack' && f.editType === 'channel-cards'
  )
  const facts: Partial<Record<OverviewFactKey, OverviewFact>> = {}
  for (const field of allFields(statusSections)) {
    const key = fieldKey(field) as OverviewFactKey | undefined
    const value = textValue(field)
    if (key && value && FACT_KEYS.includes(key)) facts[key] = { label: field.label, value }
  }
  return {
    channelLabel: channelField.label,
    channelTooltip: channelField.tooltip,
    currentChannel: String(channelField.value ?? ''),
    channels: (channelField.options ?? []).map(toChannel),
    checkAction: updateSections
      .flatMap((s) => s.actions ?? [])
      .find((a) => a.id === 'check-update'),
    torch: torchField ? toTorch(torchField) : null,
    facts
  }
}

export function splitVersion(raw: string | undefined): { main: string; rest: string } {
  const value = (raw ?? '').trim()
  if (!value) return { main: EMPTY_VALUE, rest: '' }
  const cut = value.search(/\s/)
  return cut === -1
    ? { main: value, rest: '' }
    : { main: value.slice(0, cut), rest: value.slice(cut).trim() }
}

export function channelAction(channel: OverviewChannel, id: string): ActionDef | undefined {
  return channel.actions.find((a) => a.id === id)
}
