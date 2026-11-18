const CHECKOUT_PREFIX = 'https://checkout.comfy.org/'

export const POPUP_ALLOWED_PREFIXES = [
  'https://dreamboothy.firebaseapp.com/',
  'https://accounts.google.com/',
  'https://github.com/login/oauth/'
]

export function shouldOpenInPopup(url: string): boolean {
  return POPUP_ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))
}

export function isCheckoutUrl(url: string): boolean {
  return url.startsWith(CHECKOUT_PREFIX)
}

/** May this URL be handed to the system browser via `shell.openExternal`?
 *  http(s) only: page content must not be able to push `file:`, `smb:` or
 *  app-protocol URLs to the OS handler. The open-external IPC handler
 *  enforces the same allowlist. */
export function isExternalBrowserUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Extensions indicating a download rather than something to open in the
 *  browser. Archive + bundled-asset only; deliberately omits `.json`/`.html`. */
const DOWNLOAD_FILE_EXTENSIONS = [
  '.zip',
  '.7z',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.gz',
  '.bz2',
  '.xz',
  '.rar',
  '.dmg',
  '.exe',
  '.msi',
  '.pkg',
  '.deb',
  '.rpm',
  '.appimage',
  '.safetensors',
  '.sft',
  '.ckpt',
  '.bin',
  '.gguf',
  '.pt',
  '.pth'
]

export function isLikelyDownloadUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const pathname = parsed.pathname.toLowerCase()
  return DOWNLOAD_FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext))
}
