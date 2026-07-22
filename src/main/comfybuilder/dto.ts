export interface Pipeline {
  id: string
  org_id: string
  name: string
  description?: string | null
  revision: number
  [key: string]: unknown
}

export interface Artifact {
  artifact_id: string
  filename: string
  download_url: string
  checksum: string
  size_bytes: number
}

export interface TargetBuildStatus {
  target_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  artifact?: Artifact | null
  [key: string]: unknown
}

export interface Deployment {
  id: string
  pipeline_id: string
  pipeline_revision: number
  version: string
  status: 'queued' | 'building' | 'succeeded' | 'partial' | 'failed'
  finished_at?: string | null
  artifact?: Artifact | null
  target_statuses?: TargetBuildStatus[] | null
  error_code?: string | null
  error_message?: string | null
  [key: string]: unknown
}

export class ComfyBuilderDTOParseError extends Error {
  override name = 'ComfyBuilderDTOParseError'
}

type UnknownRecord = Record<string, unknown>

function parseError(message: string): never {
  throw new ComfyBuilderDTOParseError(message)
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') parseError(`Invalid ${field}: expected string`)
  return value
}

function parseNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') parseError(`Invalid ${field}: expected string or null`)
  return value
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) parseError(`Invalid ${field}: expected number`)
  return value
}

function parseArtifactObject(value: unknown): Artifact {
  if (!isRecord(value)) parseError('Invalid artifact: expected object')
  return {
    artifact_id: parseString(value.artifact_id, 'artifact.artifact_id'),
    filename: parseString(value.filename, 'artifact.filename'),
    download_url: parseString(value.download_url, 'artifact.download_url'),
    checksum: parseString(value.checksum, 'artifact.checksum'),
    size_bytes: parseNumber(value.size_bytes, 'artifact.size_bytes')
  }
}

function parseTargetStatuses(value: unknown): TargetBuildStatus[] | undefined {
  if (!Array.isArray(value)) return undefined
  const statuses: TargetBuildStatus[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.target_id !== 'string' || typeof entry.status !== 'string') continue
    const artifact = entry.artifact == null ? null : parseArtifactObject(entry.artifact)
    statuses.push({
      ...entry,
      target_id: entry.target_id,
      status: entry.status as TargetBuildStatus['status'],
      artifact
    })
  }
  return statuses
}

function parseEnvelope<T>(json: unknown, itemParser: (value: unknown, index: number) => T, label: string): T[] {
  const items = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.items) ? json.items : undefined
  if (!items) parseError(`Invalid ${label}: expected array or { items: array }`)
  return items.map((item, index) => itemParser(item, index))
}

function parsePipeline(value: unknown, index: number): Pipeline {
  if (!isRecord(value)) parseError(`Invalid pipeline at index ${index}: expected object`)
  return {
    ...value,
    id: parseString(value.id, `pipeline[${index}].id`),
    org_id: parseString(value.org_id, `pipeline[${index}].org_id`),
    name: parseString(value.name, `pipeline[${index}].name`),
    description: parseNullableString(value.description, `pipeline[${index}].description`),
    revision: parseNumber(value.revision, `pipeline[${index}].revision`)
  }
}

function parseDeployment(value: unknown, index: number): Deployment {
  if (!isRecord(value)) parseError(`Invalid deployment at index ${index}: expected object`)

  const status = value.status
  if (
    status !== 'queued' &&
    status !== 'building' &&
    status !== 'succeeded' &&
    status !== 'partial' &&
    status !== 'failed'
  ) {
    parseError(`Invalid deployment[${index}].status: expected queued | building | succeeded | partial | failed`)
  }

  const artifact = value.artifact === undefined ? undefined : value.artifact === null ? null : parseArtifactObject(value.artifact)
  const targetStatuses = parseTargetStatuses(value.target_statuses)

  return {
    ...value,
    id: parseString(value.id, `deployment[${index}].id`),
    pipeline_id: parseString(value.pipeline_id, `deployment[${index}].pipeline_id`),
    pipeline_revision: parseNumber(value.pipeline_revision, `deployment[${index}].pipeline_revision`),
    version: parseString(value.version, `deployment[${index}].version`),
    status,
    finished_at: parseNullableString(value.finished_at, `deployment[${index}].finished_at`),
    artifact,
    ...(targetStatuses ? { target_statuses: targetStatuses } : {}),
    error_code: parseNullableString(value.error_code, `deployment[${index}].error_code`),
    error_message: parseNullableString(value.error_message, `deployment[${index}].error_message`)
  }
}

export function parsePipelines(json: unknown): Pipeline[] {
  return parseEnvelope(json, parsePipeline, 'pipelines')
}

export function parseDeployments(json: unknown): Deployment[] {
  return parseEnvelope(json, parseDeployment, 'deployments')
}

export function parseArtifact(json: unknown): Artifact {
  return parseArtifactObject(json)
}
