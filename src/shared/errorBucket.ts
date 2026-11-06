export type ErrorBucket =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'disk'
  | 'permissions'
  | 'path'
  | 'oom'
  | 'node_missing'
  | 'import_error'
  | 'cuda_init'
  | 'shape_mismatch'
  | 'model_load'
  | 'validation'
  | 'python'
  | 'source_missing'
  | 'other'
  | 'unknown'

export function bucketError(input: unknown): ErrorBucket {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : null
  const cause =
    record?.cause && typeof record.cause === 'object'
      ? (record.cause as Record<string, unknown>)
      : null
  const code =
    typeof record?.code === 'string'
      ? record.code
      : typeof cause?.code === 'string'
        ? cause.code
        : ''
  const name =
    input instanceof Error ? input.name : typeof record?.name === 'string' ? record.name : ''
  const detail =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
        ? input
        : typeof record?.message === 'string'
          ? record.message
          : ''
  const raw = [code, name, detail].filter(Boolean).join(' ')
  if (!raw) return 'unknown'
  const message = raw.toLowerCase()
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('timeout')) return 'timeout'
  if (
    message.includes('out of memory') ||
    message.includes('outofmemoryerror') ||
    /\bkilled\b/.test(message)
  ) {
    return 'oom'
  }
  if (
    message.includes('cuda not available') ||
    message.includes('no cuda-capable device') ||
    message.includes('cuda runtime error')
  ) {
    return 'cuda_init'
  }
  if (message.includes('importerror') || message.includes('modulenotfounderror')) {
    return 'import_error'
  }
  if (
    /\bnode (not found|missing)\b/.test(message) ||
    message.includes('unknown node type') ||
    message.includes('nodenotfound')
  ) {
    return 'node_missing'
  }
  if (
    message.includes('size mismatch') ||
    message.includes('shape mismatch') ||
    /shape '?\[.+\]'? is invalid/.test(message) ||
    /expected .+ (got|but got|to be) /.test(message) ||
    /\bdimensions?\b.*\b(mismatch|must match|do not match)\b/.test(message)
  ) {
    return 'shape_mismatch'
  }
  if (
    message.includes('safetensors') ||
    message.includes('error while deserializing') ||
    /\b(missing|unexpected) key\(s\)/.test(message) ||
    /\b(checkpoint|state_?dict)\b.*\b(load|loading|corrupt)/.test(message)
  ) {
    return 'model_load'
  }
  if (
    message.includes('validation_failed') ||
    message.includes('prompt outputs failed validation')
  ) {
    return 'validation'
  }
  if (
    message.includes('source-missing') ||
    message.includes('source_missing') ||
    /source.*clone.*fail/.test(message)
  ) {
    return 'source_missing'
  }
  if (
    /\b(?:econnrefused|econnreset|enotfound|eai_again|enetunreach|etimedout)\b/.test(message) ||
    /net::err_[a-z0-9_]+/.test(message) ||
    message.includes('network') ||
    message.includes('fetch')
  )
    return 'network'
  if (message.includes('disk') || message.includes('space') || message.includes('enospc'))
    return 'disk'
  if (
    message.includes('permission') ||
    message.includes('access') ||
    /\b(?:eacces|eperm|erofs)\b/.test(message)
  )
    return 'permissions'
  if (message.includes('path') || /\b(?:enoent|enotdir|eisdir)\b/.test(message)) return 'path'
  if (/\b[A-Z][A-Za-z0-9_.]*(?:Error|Exception)\b/.test(detail)) return 'python'
  return 'other'
}
