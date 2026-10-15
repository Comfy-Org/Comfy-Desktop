import { describe, it, expect } from 'vitest'
import {
  isCheckoutReturnUrl,
  isCheckoutUrl,
  isLikelyDownloadUrl,
  POPUP_ALLOWED_PREFIXES,
  reservedTabRoute,
  shouldOpenInPopup
} from './allowedPopups'

describe('POPUP_ALLOWED_PREFIXES', () => {
  it('includes the Firebase auth domain', () => {
    expect(POPUP_ALLOWED_PREFIXES).toContain('https://dreamboothy.firebaseapp.com/')
  })

  it('includes the checkout domain', () => {
    expect(POPUP_ALLOWED_PREFIXES).toContain('https://checkout.comfy.org/')
  })

  it('includes the Google accounts domain', () => {
    expect(POPUP_ALLOWED_PREFIXES).toContain('https://accounts.google.com/')
  })

  it('includes the GitHub OAuth domain', () => {
    expect(POPUP_ALLOWED_PREFIXES).toContain('https://github.com/login/oauth/')
  })
})

describe('shouldOpenInPopup', () => {
  it('returns true for Firebase auth URLs', () => {
    expect(shouldOpenInPopup('https://dreamboothy.firebaseapp.com/__/auth/handler')).toBe(true)
  })

  it('returns true for checkout URLs', () => {
    expect(shouldOpenInPopup('https://checkout.comfy.org/session/abc123')).toBe(true)
  })

  it('returns true for Google accounts URLs', () => {
    expect(shouldOpenInPopup('https://accounts.google.com/o/oauth2/auth?client_id=abc')).toBe(true)
  })

  it('returns true for GitHub OAuth URLs', () => {
    expect(shouldOpenInPopup('https://github.com/login/oauth/authorize?client_id=abc')).toBe(true)
  })

  it('returns false for unknown URLs', () => {
    expect(shouldOpenInPopup('https://evil.example.com/')).toBe(false)
  })

  it('returns false for partial prefix matches', () => {
    expect(shouldOpenInPopup('https://dreamboothy.firebaseapp.com.evil.com/')).toBe(false)
  })
})

describe('isCheckoutUrl', () => {
  it('returns true for the checkout host', () => {
    expect(isCheckoutUrl('https://checkout.comfy.org/session/abc123')).toBe(true)
  })

  it('returns false for other comfy.org hosts', () => {
    expect(isCheckoutUrl('https://cloud.comfy.org/')).toBe(false)
    expect(isCheckoutUrl('https://checkout.comfy.org.evil.com/')).toBe(false)
  })
})

describe('isCheckoutReturnUrl', () => {
  it('returns true for first-party comfy.org return pages', () => {
    expect(isCheckoutReturnUrl('https://cloud.comfy.org/?checkout=success')).toBe(true)
    expect(isCheckoutReturnUrl('https://app.comfy.org/credits')).toBe(true)
    expect(isCheckoutReturnUrl('https://comfy.org/')).toBe(true)
  })

  it('returns false while still on the checkout host (mid-flow)', () => {
    expect(isCheckoutReturnUrl('https://checkout.comfy.org/session/abc123')).toBe(false)
  })

  it('returns false for intermediate Stripe / bank redirect hosts', () => {
    expect(isCheckoutReturnUrl('https://hooks.stripe.com/3d_secure/authenticate')).toBe(false)
    expect(isCheckoutReturnUrl('https://acs.bank.example/challenge')).toBe(false)
  })

  it('returns false for the comfy.org spoof host', () => {
    expect(isCheckoutReturnUrl('https://comfy.org.evil.com/')).toBe(false)
  })

  it('returns false for unparseable URLs', () => {
    expect(isCheckoutReturnUrl('not a url')).toBe(false)
    expect(isCheckoutReturnUrl('')).toBe(false)
  })
})

describe('isLikelyDownloadUrl (regression for #582 cloud zip handoff)', () => {
  it('returns true for a cloud zip export URL', () => {
    expect(isLikelyDownloadUrl('https://app.comfy.org/api/exports/abc123/workflow.zip')).toBe(true)
  })

  it('returns true for common archive extensions', () => {
    for (const url of [
      'https://example.com/file.zip',
      'https://example.com/dir/file.7z',
      'https://example.com/file.tar.gz',
      'https://example.com/file.tgz',
      'https://example.com/build/installer.exe',
      'https://example.com/installer.msi',
      'https://example.com/model.safetensors',
      'https://example.com/model.gguf'
    ]) {
      expect(isLikelyDownloadUrl(url)).toBe(true)
    }
  })

  it('ignores query strings and fragments when matching the extension', () => {
    expect(isLikelyDownloadUrl('https://example.com/file.zip?token=abc')).toBe(true)
    expect(isLikelyDownloadUrl('https://example.com/file.zip#section')).toBe(true)
  })

  it('returns false for plain web pages and docs URLs', () => {
    for (const url of [
      'https://example.com/',
      'https://example.com/some/page',
      'https://docs.example.com/getting-started.html',
      'https://example.com/file.json',
      'https://example.com/image.png'
    ]) {
      expect(isLikelyDownloadUrl(url)).toBe(false)
    }
  })

  it('returns false for unparseable URLs', () => {
    expect(isLikelyDownloadUrl('not a url')).toBe(false)
    expect(isLikelyDownloadUrl('')).toBe(false)
  })

  it('matching is case-insensitive (.ZIP works too)', () => {
    expect(isLikelyDownloadUrl('https://example.com/FILE.ZIP')).toBe(true)
  })
})

describe('reservedTabRoute (#1729 blank-tab reservation)', () => {
  it('sends checkout to the system browser, ahead of the popup allowlist', () => {
    expect(reservedTabRoute('https://checkout.comfy.org/session/abc')).toBe('checkout')
  })

  it('blocks the Firebase auth handler, which must go through the system-browser bridge', () => {
    expect(reservedTabRoute('https://dreamboothy.firebaseapp.com/__/auth/handler?x=1')).toBe(
      'block'
    )
  })

  it('loads allowlisted popup destinations in the child window', () => {
    expect(reservedTabRoute('https://accounts.google.com/o/oauth2/auth')).toBe('load')
  })

  it('loads blob: URLs in the child window (cloud open-image-in-new-tab)', () => {
    expect(reservedTabRoute('blob:https://cloud.comfy.org/1234-abcd')).toBe('load')
  })

  it('routes download URLs to the downloads tray', () => {
    expect(reservedTabRoute('https://app.comfy.org/api/exports/abc/workflow.zip')).toBe('download')
  })

  it('sends any other http(s) page to the system browser', () => {
    expect(reservedTabRoute('https://billing.stripe.com/p/session/test')).toBe('external')
    expect(reservedTabRoute('https://billing.comfy.org/v1/payment-methods')).toBe('external')
    expect(reservedTabRoute('http://example.com/')).toBe('external')
  })

  it('blocks non-web schemes and unparseable URLs', () => {
    expect(reservedTabRoute('javascript:alert(1)')).toBe('block')
    expect(reservedTabRoute('file:///etc/passwd')).toBe('block')
    expect(reservedTabRoute('not a url')).toBe('block')
  })
})
