import { isPermittedDownloadUrl } from './downloadUrlPolicy'

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

export function startPopupDownload(
  session: Pick<Electron.Session, 'downloadURL'>,
  url: string
): boolean {
  if (!isPermittedDownloadUrl(url)) return false
  session.downloadURL(url)
  return true
}
