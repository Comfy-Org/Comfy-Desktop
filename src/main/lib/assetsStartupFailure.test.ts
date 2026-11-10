import { describe, expect, it } from 'vitest'
import { parseAssetsStartupFailure } from './assetsStartupFailure'

const MESSAGE = [
  "Another ComfyUI is already using this database: '/x/user/comfyui.db'.",
  'Close the other ComfyUI and start this one again.',
  'Or give this ComfyUI its own database: --database-url sqlite:///path/to/another.db',
  'Or start ComfyUI without the assets system: --disable-assets'
].join('\n')

describe('parseAssetsStartupFailure', () => {
  it.each([
    ['a bare marker', `ASSETS_STARTUP_FAILED: in_use\n${MESSAGE}\n`],
    ['a log-level tag', `[ERROR] ASSETS_STARTUP_FAILED: in_use\n${MESSAGE}\n`],
    [
      'a coloured tag',
      `\u001b[1m\u001b[31m[ERROR]\u001b[0m ASSETS_STARTUP_FAILED: in_use\n${MESSAGE}\n`
    ],
    [
      'CRLF line ends',
      `[ERROR] ASSETS_STARTUP_FAILED: in_use\r\n${MESSAGE.replace(/\n/g, '\r\n')}\r\n`
    ],
    [
      'a tag on every line',
      `[ERROR] ASSETS_STARTUP_FAILED: in_use\n${MESSAGE.replace(/^/gm, '[ERROR] ')}\n`
    ]
  ])("reads the kind and Core's message after %s", (_why, stderr) => {
    expect(parseAssetsStartupFailure(`[INFO] Starting server\nalembic noise\n${stderr}`)).toEqual({
      kind: 'in_use',
      message: MESSAGE
    })
  })

  it('stops at the --disable-assets hint, leaving later output out', () => {
    expect(
      parseAssetsStartupFailure(
        `ASSETS_STARTUP_FAILED: corrupt\nThe asset database is corrupt.\n` +
          `Or start ComfyUI without the assets system: --disable-assets\n` +
          `Exception ignored in thread\n`
      )
    ).toEqual({
      kind: 'corrupt',
      message:
        'The asset database is corrupt.\nOr start ComfyUI without the assets system: --disable-assets'
    })
  })

  it('keeps the rest of stderr when the hint is missing', () => {
    expect(parseAssetsStartupFailure('ASSETS_STARTUP_FAILED: other\nfirst\n\nsecond\n')).toEqual({
      kind: 'other',
      message: 'first\nsecond'
    })
  })

  it('reads the last marker when there are several', () => {
    expect(
      parseAssetsStartupFailure(
        'ASSETS_STARTUP_FAILED: locked\nold --disable-assets\nASSETS_STARTUP_FAILED: in_use\nnew --disable-assets\n'
      )
    ).toEqual({ kind: 'in_use', message: 'new --disable-assets' })
  })

  it.each([
    ['no stderr', undefined],
    [
      'an older core',
      'Database is locked. Another ComfyUI process is already using this database.\n'
    ]
  ])('is null for %s', (_why, stderr) => {
    expect(parseAssetsStartupFailure(stderr)).toBeNull()
  })
})
