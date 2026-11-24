import { bucketError, type ErrorBucket } from './errorBucket'
import { scrubAll } from './piiScrub'

export const ERROR_MESSAGE_MAX = 2048
export const ERROR_STACK_MAX = 16 * 1024
export const ERROR_SIGNATURE_MAX = 200
export const ERROR_TAIL_MAX = 16 * 1024

export interface ErrorFields {
  error_class: string
  error_message: string
  error_bucket: ErrorBucket
  error_signature: string
}

const EXCEPTION_LINE =
  /^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning|Interrupt)\b|SystemExit\b)\s*:?/

const SIGNATURE_CLASSES: [needle: string, className: string][] = [
  ['no kernel image is available', 'CUDANoKernelImage'],
  ['no cuda-capable device', 'CUDANoDevice'],
  ['cuda out of memory', 'CUDAOutOfMemory'],
  ['out of memory', 'OutOfMemory'],
  ['device-side assert', 'CUDADeviceAssert'],
  ['cuda error', 'CUDAError'],
  ['cuda runtime error', 'CUDAError'],
  ['cuda not available', 'CUDANotAvailable']
]

function messageOf(input: unknown): string {
  if (input instanceof Error) return input.message || input.name || ''
  if (typeof input === 'string') return input
  if (input == null) return ''
  return String(input)
}

function structuredCode(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (typeof record.code === 'string' && isRecognizedErrorCode(record.code)) {
    return record.code
  }
  const cause = record.cause
  if (cause && typeof cause === 'object') {
    const code = (cause as Record<string, unknown>).code
    if (typeof code === 'string' && isRecognizedErrorCode(code)) return code
  }
  return null
}

const RECOGNIZED_NODE_CODES = new Set([
  'E2BIG',
  'EACCES',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'EAFNOSUPPORT',
  'EAGAIN',
  'EAI_AGAIN',
  'EBADF',
  'EBUSY',
  'ECANCELED',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EFAULT',
  'EHOSTUNREACH',
  'EINTR',
  'EINVAL',
  'EIO',
  'EISDIR',
  'ELOOP',
  'EMFILE',
  'ENAMETOOLONG',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENFILE',
  'ENOBUFS',
  'ENODEV',
  'ENOENT',
  'ENOMEM',
  'ENOSPC',
  'ENOSYS',
  'ENOTCONN',
  'ENOTDIR',
  'ENOTEMPTY',
  'ENOTFOUND',
  'ENOTSUP',
  'EPERM',
  'EPIPE',
  'EPROTO',
  'EPROTONOSUPPORT',
  'EROFS',
  'ETIMEDOUT',
  'ETXTBSY',
  'EXDEV'
])

const RECOGNIZED_CHROMIUM_CODES = new Set([
  'ERR_ABORTED',
  'ERR_ACCESS_DENIED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_FAILED',
  'ERR_FILE_NOT_FOUND',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TIMED_OUT',
  'ERR_TOO_MANY_REDIRECTS',
  'ERR_UNSAFE_PORT'
])

function isRecognizedErrorCode(code: string): boolean {
  return RECOGNIZED_NODE_CODES.has(code) || RECOGNIZED_CHROMIUM_CODES.has(code)
}

const SAFE_MISSING_MODULES = new Set([
  'aiohttp',
  'comfy',
  'cv2',
  'einops',
  'folder_paths',
  'nodes',
  'numpy',
  'pil',
  'requests',
  'safetensors',
  'scipy',
  'server',
  'torch',
  'torchaudio',
  'torchvision',
  'transformers',
  'triton',
  'yaml'
])

function embeddedCode(message: string): string | null {
  const chromium = message.match(/\bnet::(ERR_[A-Z0-9_]+)\b/i)
  if (chromium) return chromium[1]!.toUpperCase()
  const node = message.match(
    /\b(E(?:AI_AGAIN|CONNREFUSED|CONNRESET|NOTFOUND|NETUNREACH|TIMEDOUT|ACCES|PERM|ROFS|NOENT|NOTDIR|ISDIR|NOSPC))\b/i
  )
  return node ? node[1]!.toUpperCase() : null
}

export function findExceptionLine(text: string): string | null {
  let found: string | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (EXCEPTION_LINE.test(line)) found = line
  }
  return found
}

export function extractErrorClass(input: unknown): string {
  const code = structuredCode(input)
  if (code) return code
  const text = messageOf(input)

  const exceptionLine = findExceptionLine(text)
  if (exceptionLine) {
    const m = exceptionLine.match(EXCEPTION_LINE)
    if (m) return m[1]!
  }

  const codeFromMessage = embeddedCode(text)
  if (codeFromMessage) return codeFromMessage

  const lower = text.toLowerCase()
  for (const [needle, className] of SIGNATURE_CLASSES) {
    if (lower.includes(needle)) return className
  }

  if (input instanceof Error && input.name && input.name !== 'Error') {
    return input.name
  }

  return 'unknown'
}

export function normalizeSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(
      /(no module named\s+)["']([a-z_][a-z0-9_.]*)["']/g,
      (_match, prefix: string, moduleName: string) =>
        `${prefix}${SAFE_MISSING_MODULES.has(moduleName) ? moduleName : '<str>'}`
    )
    .replace(/'[^']*'/g, '<str>')
    .replace(/"[^"]*"/g, '<str>')
    .replace(/(?:[a-z]:)?(?:[\\/][^\s'":<>|?*]+)+/gi, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/0x[0-9a-f]+/g, '0x#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_SIGNATURE_MAX)
}

export function buildErrorFields(
  input: unknown,
  opts: { messageCap?: number; errorClass?: string } = {}
): ErrorFields {
  const raw = messageOf(input)
  const messageCap = opts.messageCap ?? ERROR_MESSAGE_MAX
  const errorClass = opts.errorClass ?? extractErrorClass(input)
  const primary = findExceptionLine(raw) ?? raw
  const scrubbedMessage = scrubAll(primary).slice(0, messageCap)
  return {
    error_class: errorClass,
    error_message: scrubbedMessage,
    error_bucket: bucketError(input),
    error_signature: `${errorClass}|${normalizeSignature(scrubbedMessage)}`
  }
}

export function errorTail(
  stderr: string | null | undefined,
  opts: { maxChars?: number } = {}
): string | null {
  if (!stderr) return null
  const maxChars = opts.maxChars ?? ERROR_TAIL_MAX
  const scrubbed = scrubAll(stderr)
  const bounded = scrubbed.length > maxChars ? scrubbed.slice(-maxChars) : scrubbed
  const trimmed = bounded.trim()
  return trimmed.length > 0 ? trimmed : null
}
