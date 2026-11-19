export type ArtifactOs = 'linux' | 'windows' | 'mac'
export type ArtifactGpu = 'nvidia' | 'amd' | 'cpu' | 'mps'

export interface Build {
  id: string
  name: string
  description?: string
  createdBy?: string
  numCustomNodes?: number
  numModels?: number
  numAllowedModels?: number
  sizeBytes?: number
  updatedAt?: string
}

export interface BuildDraft {
  buildId: string
  workspaceId: string
  editUrl: string
}

export interface BuildVersion {
  id: string
  version: number
  status: string
  createdAt?: string
}

export interface Artifact {
  id: string
  os: ArtifactOs
  gpu: ArtifactGpu
  accelVariant: string
  status: string
  archiveRef?: string
  archiveSha256?: string
}

export interface Host {
  os: ArtifactOs
  gpu: ArtifactGpu
  accelVariant?: string
}

export interface TokenProvider {
  getAccessToken(): Promise<string | null>
  onUnauthorized?(rejectedAccessToken: string): void
}

export interface LaunchSpec {
  cmd: string
  args: string[]
  cwd: string
  port: number
}

export interface InstallProgress {
  phase: 'resolve' | 'download' | 'extract'
  percent: number
  detail?: string
}

export interface ModelDescriptor {
  type: string
  filename: string
  sha256?: string
  downloadUrl: string
  expiresAt?: string
}

export interface ModelPolicy {
  mode: 'allowlist' | 'blocklist'
  list?: string[]
}

export interface ModelManifest {
  models: ModelDescriptor[]
  modelPolicy?: ModelPolicy | null
  partnerNodePolicy?: ModelPolicy | null
  customNodePolicy?: ModelPolicy | null
}

export interface StageProgress {
  index: number
  total: number
  filename: string
  percent: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSecs?: number
}
