const MODEL_HOST = 'huggingface.co'
const MODEL_FOLDER = /^[a-z0-9][a-z0-9_]{0,39}$/
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.safetensors$/
const RESOLVE_PATH = /^\/[^/]+\/[^/]+\/resolve\/[^/]+\/.+$/

export interface ModelRequest {
  url: string
  folder: string
  name: string
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isPlainHuggingFaceFile(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === MODEL_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    RESOLVE_PATH.test(url.pathname)
  )
}

export function readModelRequest(raw: unknown): ModelRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { url, folder, name } = raw as Record<string, unknown>
  if (typeof url !== 'string' || typeof folder !== 'string' || typeof name !== 'string') return null
  if (!MODEL_FOLDER.test(folder) || !MODEL_NAME.test(name)) return null
  const source = parseUrl(url)
  if (!source || !isPlainHuggingFaceFile(source)) return null
  if (!source.pathname.endsWith(`/${name}`)) return null
  return { url: source.href, folder, name }
}
