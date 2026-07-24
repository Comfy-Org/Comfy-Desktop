const TRUSTED_CLOUD_HOSTS = new Set([
  'cloud.comfy.org',
  'stagingcloud.comfy.org',
  'testcloud.comfy.org'
])

export function isTrustedCloudUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const isTestingCloudPreview =
      hostname !== 'testingcloud.comfy.org' && hostname.endsWith('.testingcloud.comfy.org')
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      (TRUSTED_CLOUD_HOSTS.has(hostname) || isTestingCloudPreview)
    )
  } catch {
    return false
  }
}
