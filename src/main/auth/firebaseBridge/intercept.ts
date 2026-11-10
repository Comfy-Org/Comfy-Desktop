const FIREBASE_AUTH_HANDLER_HOSTS = [
  'dreamboothy.firebaseapp.com',
  'dreamboothy-dev.firebaseapp.com'
] as const

const FIREBASE_AUTH_HANDLER_PATH = '/__/auth/handler'

export function isFirebaseAuthHandlerUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (
    !FIREBASE_AUTH_HANDLER_HOSTS.includes(
      parsed.host as (typeof FIREBASE_AUTH_HANDLER_HOSTS)[number]
    )
  ) {
    return false
  }
  return parsed.pathname === FIREBASE_AUTH_HANDLER_PATH
}

export type SupportedProvider = 'google.com' | 'github.com'

export function extractProviderId(url: string): SupportedProvider | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const providerId = parsed.searchParams.get('providerId')
  if (providerId === 'google.com' || providerId === 'github.com') {
    return providerId
  }
  return null
}
