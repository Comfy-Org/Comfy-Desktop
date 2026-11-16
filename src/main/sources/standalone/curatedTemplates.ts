export type TemplateModality = 'image' | 'video' | 'audio' | '3d'

export interface TemplateSnapshot {
  title: string
  description: string
  sizeBytes: number
  mediaSubtype: string
}

export const TEMPLATE_MODALITY_ORDER: readonly TemplateModality[] = [
  'video',
  'image',
  '3d',
  'audio'
]

const RAW_TEMPLATES_REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main'
export const RAW_TEMPLATES_BASE = `${RAW_TEMPLATES_REPO}/templates`
export const TEMPLATE_INPUT_BASE = `${RAW_TEMPLATES_REPO}/input`

export const INDEX_URL = `${RAW_TEMPLATES_BASE}/index.json`

const IMAGE_SUBTYPES = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'])

export function thumbnailUrlFor(id: string, mediaSubtype: string): string | null {
  const ext = (mediaSubtype || 'webp').toLowerCase()
  if (!IMAGE_SUBTYPES.has(ext)) return null
  return `${RAW_TEMPLATES_BASE}/${id}-1.${ext}`
}

export const NO_TEMPLATE_VALUE = 'none'

const TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/
const RESERVED_TEMPLATE_IDS = new Set(['.', '..'])

export function isPersistableTemplateId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== NO_TEMPLATE_VALUE &&
    !RESERVED_TEMPLATE_IDS.has(value) &&
    TEMPLATE_ID_PATTERN.test(value)
  )
}
