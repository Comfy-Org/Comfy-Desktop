import { describe, expect, it, vi } from 'vitest'
import { createUvProgressParser, type UvProgress } from './uvProgress'

/** Feed output through the parser and collect every emitted state. */
function run(...chunks: string[]): UvProgress[] {
  const seen: UvProgress[] = []
  const feed = createUvProgressParser((p) => seen.push(p))
  chunks.forEach(feed)
  return seen
}

const last = (states: UvProgress[]): UvProgress | undefined => states.at(-1)

describe('summary lines', () => {
  it('reads the resolved package count', () => {
    const states = run('Resolved 42 packages in 1.23s\n')
    expect(last(states)).toMatchObject({ stage: 'resolving', resolvedCount: 42 })
  })

  it('handles the singular form uv uses for one package', () => {
    const states = run('Resolved 1 package in 5ms\n')
    expect(last(states)?.resolvedCount).toBe(1)
  })

  it('advances to installing once packages are prepared', () => {
    const states = run('Prepared 12 packages in 4.56s\n')
    expect(last(states)?.stage).toBe('installing')
  })

  it('accepts the without-build-isolation variant', () => {
    const states = run('Prepared 1 package without build isolation in 2.00s\n')
    expect(last(states)?.stage).toBe('installing')
  })

  it('finishes on the installed summary', () => {
    const states = run('Installed 12 packages in 789ms\n')
    expect(last(states)?.stage).toBe('done')
  })

  it('finishes on an audited summary, which a no-op sync emits instead', () => {
    const states = run('Audited 5 packages in 12ms\n')
    expect(last(states)?.stage).toBe('done')
  })
})

describe('download lines', () => {
  it('names the package and size uv reported', () => {
    const states = run('Downloading torch (2.7GiB)\n')
    expect(last(states)).toMatchObject({
      stage: 'preparing',
      currentPackage: 'torch',
      currentSize: '2.7GiB'
    })
  })

  it('handles a download with no known size', () => {
    const states = run('Downloading torch\n')
    expect(last(states)).toMatchObject({ currentPackage: 'torch', currentSize: undefined })
  })

  it('clears the current package on the indented completion line', () => {
    const states = run('Downloading torch (2.7GiB)\n', ' Downloaded torch\n')
    expect(last(states)).toMatchObject({ currentPackage: undefined, currentSize: undefined })
  })

  it('ignores a repeated Downloading line for the same package', () => {
    // uv 0.9.x printed `Downloading` on completion; counting it would double.
    const states = run('Downloading torch (2.7GiB)\n', 'Downloading torch (2.7GiB)\n')
    expect(states).toHaveLength(1)
  })

  it('names each large download in turn', () => {
    const states = run(
      'Downloading torch (2.7GiB)\n',
      ' Downloaded torch\n',
      'Downloading nvidia-cudnn-cu12 (664.8MiB)\n'
    )
    expect(states.map((s) => s.currentPackage)).toEqual(['torch', undefined, 'nvidia-cudnn-cu12'])
  })
})

describe('stream handling', () => {
  it('holds a partial line until its newline arrives', () => {
    const seen: UvProgress[] = []
    const feed = createUvProgressParser((p) => seen.push(p))
    feed('Resolved 42 pack')
    expect(seen).toHaveLength(0)
    feed('ages in 1.23s\n')
    expect(last(seen)?.resolvedCount).toBe(42)
  })

  it('parses several lines delivered in one chunk', () => {
    const states = run('Resolved 3 packages in 1s\nPrepared 3 packages in 2s\n')
    expect(states).toHaveLength(2)
    expect(last(states)?.stage).toBe('installing')
  })

  it('strips ANSI styling before matching', () => {
    const states = run('[1m[36mDownloading[0m torch [2m(2.7GiB)[0m\n')
    expect(last(states)?.currentPackage).toBe('torch')
  })

  it('handles CRLF output from Windows', () => {
    const states = run('Resolved 7 packages in 1.00s\r\n')
    expect(last(states)?.resolvedCount).toBe(7)
  })

  it('ignores unrelated output rather than guessing', () => {
    const states = run('warning: `uv pip install` is experimental\n', 'error: oh no\n')
    expect(states).toHaveLength(0)
  })

  it('recovers after output that never breaks into lines', () => {
    const seen: UvProgress[] = []
    const feed = createUvProgressParser((p) => seen.push(p))
    feed('x'.repeat(100_000))
    feed('\nResolved 5 packages in 1s\n')
    expect(last(seen)?.resolvedCount).toBe(5)
  })

  it('keeps parsing after a consumer throws', () => {
    const onProgress = vi.fn().mockImplementationOnce(() => {
      throw new Error('render blew up')
    })
    const feed = createUvProgressParser(onProgress)
    expect(() => feed('Resolved 1 package in 1s\n')).not.toThrow()
    feed('Installed 1 package in 1s\n')
    expect(onProgress).toHaveBeenCalledTimes(2)
  })
})
