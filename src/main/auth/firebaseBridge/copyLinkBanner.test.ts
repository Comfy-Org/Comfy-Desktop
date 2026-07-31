import { describe, expect, it } from 'vitest'

import {
  buildCopyLinkBannerScript,
  buildRemoveCopyLinkBannerScript,
  buildUpdateCopyLinkBannerScript,
  CANCEL_SIGN_IN_SENTINEL,
  COPY_LINK_BANNER_ID,
  OPEN_LINK_SENTINEL,
  START_OVER_SENTINEL,
  type CopyLinkBannerLabels
} from './copyLinkBanner'

const labels: CopyLinkBannerLabels = {
  title: 'Finish signing in in your browser',
  opening: 'Opening your browser…',
  waiting: 'Waiting for you to finish signing in.',
  openFailed: 'We couldn’t open your browser. Try again or copy the link.',
  expired: 'This sign-in link expired. Start over to try again.',
  failed: 'Sign-in didn’t complete. Start over to try again.',
  remaining: '{time} remaining',
  copy: 'Copy link',
  copied: 'Copied',
  openAgain: 'Open browser again',
  cancel: 'Cancel',
  startOver: 'Start over'
}

const url = 'http://localhost:9876/?provider=google.com&n=abc123'

describe('buildCopyLinkBannerScript', () => {
  it('embeds the login URL verbatim (JSON-escaped)', () => {
    const script = buildCopyLinkBannerScript(url, labels)
    expect(script).toContain(JSON.stringify(url))
  })

  it('dedupes on a repeat injection via getElementById', () => {
    const script = buildCopyLinkBannerScript(url, labels)
    expect(script).toContain('getElementById')
    expect(script).toContain(JSON.stringify(COPY_LINK_BANNER_ID))
  })

  it('emits explicit open, cancel, and start-over commands (copy stays in-page)', () => {
    const script = buildCopyLinkBannerScript(url, labels, {
      expiresAtMs: Date.now() + 300_000
    })
    expect(script).toContain(JSON.stringify(OPEN_LINK_SENTINEL))
    expect(script).toContain(JSON.stringify(CANCEL_SIGN_IN_SENTINEL))
    expect(script).toContain(JSON.stringify(START_OVER_SENTINEL))
    // Copy is in-page only — no console sentinel a remote page could abuse.
    expect(script).not.toContain('__comfyCopyLoginLink')
  })

  it('renders a countdown from an absolute expiry without embedding the code in status', () => {
    const expiresAtMs = 1_234_567
    const script = buildCopyLinkBannerScript(url, labels, { expiresAtMs })

    expect(script).toContain(String(expiresAtMs))
    expect(script).toContain('formatRemaining(remaining)')
    expect(script).toContain('setInterval(render,1000)')
    expect(script).toContain(JSON.stringify(labels.remaining))
  })

  it('copies in-page with a clipboard primary and execCommand fallback', () => {
    const script = buildCopyLinkBannerScript(url, labels)
    expect(script).toContain('navigator.clipboard')
    expect(script).toContain("execCommand('copy')")
  })

  it('renders Lucide icons and swaps copy → check on success', () => {
    const script = buildCopyLinkBannerScript(url, labels)
    expect(script).toContain('M20 6 9 17l-5-5') // check
    expect(script).toContain('M15 3h6v6') // external-link
    expect(script).toContain('ICON_TICK')
    expect(script).toContain('ICON_COPY')
  })

  it('is parseable as JavaScript', () => {
    const script = buildCopyLinkBannerScript(url, labels)
    // `Function` surfaces syntax errors without executing.
    expect(() => new Function(script)).not.toThrow()
  })

  it('escapes hostile URLs and labels without breaking the script', () => {
    const tricky = 'http://x/?q="; alert(1); //</script>'
    const hostileLabels: CopyLinkBannerLabels = {
      ...labels,
      title: '"; document.title="x"; //'
    }
    const script = buildCopyLinkBannerScript(tricky, hostileLabels)
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain(JSON.stringify(tricky))
  })
})

describe('buildRemoveCopyLinkBannerScript', () => {
  it('is parseable and tears down the node, countdown, and observer', () => {
    const script = buildRemoveCopyLinkBannerScript()
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain(JSON.stringify(COPY_LINK_BANNER_ID))
    expect(script).toContain('clearInterval')
    expect(script).toContain('disconnect()')
  })
})

describe('buildUpdateCopyLinkBannerScript', () => {
  it('updates an existing panel without rebuilding it', () => {
    const script = buildUpdateCopyLinkBannerScript('open_failed')

    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain(JSON.stringify(COPY_LINK_BANNER_ID))
    expect(script).toContain(JSON.stringify('open_failed'))
    expect(script).toContain('__cclRender')
  })
})
