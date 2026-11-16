function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

export function buildFeedbackHiddenFields(version?: string): Record<string, string> {
  return { platform: detectPlatform(), ...(version ? { ver: version } : {}) }
}
