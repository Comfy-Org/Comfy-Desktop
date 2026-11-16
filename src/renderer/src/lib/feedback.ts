const FEEDBACK_PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'mac',
  win32: 'windows',
  linux: 'linux'
}

export function buildFeedbackHiddenFields(version?: string): Record<string, string> {
  return {
    platform: FEEDBACK_PLATFORMS[window.api.platform] ?? 'unknown',
    ...(version ? { ver: version } : {})
  }
}
