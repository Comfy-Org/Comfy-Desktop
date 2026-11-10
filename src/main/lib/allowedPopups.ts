const CHECKOUT_PREFIX = 'https://checkout.comfy.org/'

export const POPUP_ALLOWED_PREFIXES = [
  'https://dreamboothy.firebaseapp.com/',
  CHECKOUT_PREFIX,
  'https://accounts.google.com/',
  'https://github.com/login/oauth/'
]

export function shouldOpenInPopup(url: string): boolean {
  return POPUP_ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))
}

export function isCheckoutUrl(url: string): boolean {
  return url.startsWith(CHECKOUT_PREFIX)
}

export function isCheckoutReturnUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host === 'checkout.comfy.org') return false
  return host === 'comfy.org' || host.endsWith('.comfy.org')
}

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
  let pathname: string
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    return false
  }
  return DOWNLOAD_FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext))
}
