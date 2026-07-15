import { describe, expect, it } from 'vitest'
import { parseTrustedCloudUrl } from './trustedCloudUrl'

describe('parseTrustedCloudUrl', () => {
  it.each([
    'https://cloud.comfy.org/workspaces/abc',
    'https://stagingcloud.comfy.org/',
    'https://testcloud.comfy.org/',
    'https://pr-123.testingcloud.comfy.org/workspaces/abc'
  ])('accepts a trusted Cloud HTTPS origin: %s', (url) => {
    expect(parseTrustedCloudUrl(url)?.href).toBe(url)
  })

  it.each([
    'http://cloud.comfy.org/',
    'https://cloud.comfy.org:444/',
    'https://user:pass@cloud.comfy.org/',
    'https://testingcloud.comfy.org/',
    'https://eviltestingcloud.comfy.org/',
    'https://cloud.comfy.org.attacker.example/',
    'file:///launcher/index.html',
    'not a url'
  ])('rejects an untrusted or malformed URL: %s', (url) => {
    expect(parseTrustedCloudUrl(url)).toBeNull()
  })
})
