import { describe, expect, it } from 'vitest'
import {
  isPermittedChain,
  isPermittedDownloadUrl,
  isPermittedRedirect,
  isSameOrigin,
  isSecurePublicDownloadUrl,
  originOf,
  sameOriginCheck
} from './downloadUrlPolicy'

describe('isPermittedDownloadUrl', () => {
  it.each([
    'https://huggingface.co/org/repo/resolve/main/model.safetensors',
    'https://civitai.com/api/download/models/1',
    'http://127.0.0.1:8188/api/view?filename=a.png',
    'http://localhost:8188/api/view?filename=a.png',
    'http://192.168.1.20:8188/api/view?filename=a.png',
    'http://[::1]:8188/api/view',
    'http://comfy.lan:8188/api/view'
  ])('allows %s', (url) => {
    expect(isPermittedDownloadUrl(url)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['not a URL', 'not a url'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com/model.bin'],
    ['data scheme', 'data:text/plain,hello'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['chrome scheme', 'chrome://settings'],
    ['userinfo', 'https://user:pass@huggingface.co/model.safetensors'],
    ['username only', 'https://user@huggingface.co/model.safetensors'],
    ['userinfo suffix confusion', 'https://huggingface.co@evil.example/x'],
    ['metadata IPv4', 'http://169.254.169.254/latest/meta-data/'],
    ['link-local IPv4', 'http://169.254.0.1/'],
    ['metadata decimal notation', 'http://2852039166/'],
    ['metadata hex notation', 'http://0xa9fea9fe/'],
    ['metadata octal notation', 'http://0251.0376.0251.0376/'],
    ['metadata short notation', 'http://169.254.43518/'],
    ['metadata IPv4-mapped IPv6', 'http://[::ffff:169.254.169.254]/'],
    ['unspecified IPv4', 'http://0.0.0.0:8188/'],
    ['zero network', 'http://0/'],
    ['unspecified IPv6', 'http://[::]/'],
    ['link-local IPv6', 'http://[fe80::1]/'],
    ['AWS IPv6 metadata', 'http://[fd00:ec2::254]/'],
    ['GCP metadata hostname', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['GCP metadata hostname trailing dot', 'http://metadata.google.internal./'],
    ['bare metadata hostname', 'http://metadata/']
  ])('rejects %s', (_label, url) => {
    expect(isPermittedDownloadUrl(url)).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isPermittedDownloadUrl(undefined)).toBe(false)
    expect(isPermittedDownloadUrl(42)).toBe(false)
    expect(isPermittedDownloadUrl({ toString: () => 'https://a.b/' })).toBe(false)
  })
})

describe('isSecurePublicDownloadUrl', () => {
  it.each([
    'https://huggingface.co/x.safetensors',
    'http://127.0.0.1:9000/x.safetensors',
    'http://127.5.6.7/x.safetensors',
    'http://localhost:9000/x.safetensors',
    'http://[::1]:9000/x.safetensors'
  ])('allows %s', (url) => {
    expect(isSecurePublicDownloadUrl(url)).toBe(true)
  })

  it.each([
    'http://huggingface.co/x.safetensors',
    'http://192.168.1.20/x.safetensors',
    'http://localhost.evil.example/x.safetensors',
    'http://127.0.0.1.nip.io/x.safetensors',
    'http://169.254.169.254/',
    'https://user:pass@huggingface.co/x.safetensors',
    'file:///tmp/x.safetensors'
  ])('rejects %s', (url) => {
    expect(isSecurePublicDownloadUrl(url)).toBe(false)
  })
})

describe('isPermittedRedirect', () => {
  it('allows an HTTPS hop to another host', () => {
    expect(
      isPermittedRedirect(
        'https://huggingface.co/x',
        'https://cdn-lfs.hf.co/x?sig=1',
        isSecurePublicDownloadUrl
      )
    ).toBe(true)
  })

  it('refuses an HTTPS to HTTP downgrade even when the target passes the policy', () => {
    expect(
      isPermittedRedirect('https://cloud.comfy.org/api/view', 'http://127.0.0.1:8188/x', () => true)
    ).toBe(false)
  })

  it('allows HTTP to HTTP on a LAN server under the baseline policy', () => {
    expect(
      isPermittedRedirect(
        'http://192.168.1.20:8188/api/view',
        'http://192.168.1.20:8188/view/a.png',
        isPermittedDownloadUrl
      )
    ).toBe(true)
  })

  it('refuses a hop that fails the policy', () => {
    expect(
      isPermittedRedirect(
        'https://example.com/x',
        'http://169.254.169.254/latest',
        isPermittedDownloadUrl
      )
    ).toBe(false)
  })
})

describe('isPermittedChain', () => {
  it('accepts a chain where every hop passes', () => {
    expect(
      isPermittedChain(
        ['https://a.example/x', 'https://b.example/y', 'https://c.example/z'],
        isPermittedDownloadUrl
      )
    ).toBe(true)
  })

  it('rejects an empty chain', () => {
    expect(isPermittedChain([], isPermittedDownloadUrl)).toBe(false)
  })

  it('rejects a chain with a bad hop anywhere', () => {
    expect(
      isPermittedChain(
        ['https://a.example/x', 'http://169.254.169.254/', 'https://c.example/z'],
        isPermittedDownloadUrl
      )
    ).toBe(false)
  })

  it('rejects a downgrade inside the chain', () => {
    expect(
      isPermittedChain(['https://a.example/x', 'http://b.example/y'], isPermittedDownloadUrl)
    ).toBe(false)
  })
})

describe('origin helpers', () => {
  it('normalises default ports and case', () => {
    expect(originOf('HTTPS://Cloud.Comfy.org:443/api')).toBe('https://cloud.comfy.org')
    expect(isSameOrigin('http://127.0.0.1:8188/a', 'http://127.0.0.1:8188/b?c')).toBe(true)
  })

  it('treats scheme, host and port as distinct origins', () => {
    expect(isSameOrigin('http://127.0.0.1:8188/', 'http://localhost:8188/')).toBe(false)
    expect(isSameOrigin('http://127.0.0.1:8188/', 'http://127.0.0.1:8189/')).toBe(false)
    expect(isSameOrigin('http://example.com/', 'https://example.com/')).toBe(false)
  })

  it('has no origin for non-http(s) or invalid input', () => {
    expect(originOf('file:///tmp/a')).toBeNull()
    expect(originOf('')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})

describe('sameOriginCheck', () => {
  const check = sameOriginCheck([originOf('http://192.168.1.20:8188/'), null])

  it('allows URLs on an allowed origin', () => {
    expect(check('http://192.168.1.20:8188/api/view?filename=a.png')).toBe(true)
  })

  it.each([
    'http://192.168.1.21:8188/api/view',
    'http://192.168.1.20:8189/api/view',
    'https://192.168.1.20:8188/api/view',
    'http://192.168.1.20.evil.example:8188/api/view',
    'http://user@192.168.1.20:8188/api/view',
    'http://169.254.169.254/latest/meta-data/'
  ])('rejects %s', (url) => {
    expect(check(url)).toBe(false)
  })

  it('allows nothing when no origin is known', () => {
    expect(sameOriginCheck([null])('http://127.0.0.1:8188/api/view')).toBe(false)
  })
})
