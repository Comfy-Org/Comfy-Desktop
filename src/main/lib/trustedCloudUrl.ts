const TRUSTED_CLOUD_HOSTS = new Set([
  'cloud.comfy.org',
  'stagingcloud.comfy.org',
  'testcloud.comfy.org'
])

export function parseTrustedCloudUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const isTestingCloudPreview =
      hostname !== 'testingcloud.comfy.org' && hostname.endsWith('.testingcloud.comfy.org')
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      (!TRUSTED_CLOUD_HOSTS.has(hostname) && !isTestingCloudPreview)
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}
