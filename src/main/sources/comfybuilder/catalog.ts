/**
 * ComfyBuilder catalog browsing for the install wizard (main process → no CORS).
 *
 * Backs the wizard's cascading select fields: paste a Cloud JWT + base URL, then
 * pick distribution → version → artifact. Each artifact option carries the exact
 * payload `install()` reads (`artifact` + `comfybuilderBaseUrl` +
 * `comfybuilderAuthToken`) flattened onto the record via `buildInstallation`.
 */
import type { Artifact, ArtifactGpu, ArtifactOs } from '../../comfybuilder/types'
import type { FieldOption } from '../../types/sources'

const STAGING_BASE_URL = 'https://stagingplatformapi.comfy.org/builder'
const REQUEST_TIMEOUT_MS = 30_000

function trimTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

async function getJson(baseUrl: string, path: string, token: string): Promise<unknown> {
  const res = await fetch(`${trimTrailingSlash(baseUrl)}${path}`, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (res.status === 401 || res.status === 403) throw new Error('Unauthorized — check the pasted Cloud JWT (it may have expired).')
  if (!res.ok) throw new Error(`Builder API ${path} failed: HTTP ${res.status}`)
  return res.json()
}

/** OS token for the platform the wizard is running on. */
function currentOs(): ArtifactOs | null {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'linux') return 'linux'
  return null
}

interface Named { id: string; name?: string }
interface VersionRow { id: string; version: number; status: string }

/**
 * Resolve wizard select options for the field chain. Reads prior selections:
 * `baseUrl`/`jwt` (text) and `distribution`/`version` (upstream selects).
 */
export async function getFieldOptions(
  fieldId: string,
  selections: Record<string, FieldOption | undefined>,
): Promise<FieldOption[]> {
  const baseUrl = (selections.baseUrl?.value || STAGING_BASE_URL).trim()
  const token = (selections.jwt?.value || '').trim()
  if (!token) throw new Error('Paste a Cloud JWT, then press Connect.')

  if (fieldId === 'distribution') {
    const body = (await getJson(baseUrl, '/v1/distributions', token)) as { distributions?: Named[] }
    return (body.distributions ?? []).map((d) => ({ value: d.id, label: d.name || d.id }))
  }

  if (fieldId === 'version') {
    const distId = selections.distribution?.value
    if (!distId) return []
    const body = (await getJson(baseUrl, `/v1/distributions/${distId}/versions`, token)) as { versions?: VersionRow[] }
    return (body.versions ?? [])
      .filter((v) => v.status === 'complete')
      .map((v) => ({ value: v.id, label: `v${v.version} · ${v.status}` }))
  }

  if (fieldId === 'artifact') {
    const versionId = selections.version?.value
    if (!versionId) return []
    const body = (await getJson(baseUrl, `/v1/distribution-versions/${versionId}`, token)) as { artifacts?: Artifact[] }
    const os = currentOs()
    return (body.artifacts ?? [])
      .filter((a) => a.status === 'ready' && (!os || a.os === os))
      .map((a) => ({
        value: a.id,
        label: `${a.os}/${a.gpu}${a.accelVariant ? ` · ${a.accelVariant}` : ''}`,
        recommended: a.gpu === 'cpu',
        data: {
          artifact: { id: a.id, os: a.os, gpu: a.gpu as ArtifactGpu, accelVariant: a.accelVariant, status: a.status, ...(a.outputSha256 ? { outputSha256: a.outputSha256 } : {}) },
          comfybuilderBaseUrl: baseUrl,
          comfybuilderAuthToken: token,
        },
      }))
  }

  return []
}
