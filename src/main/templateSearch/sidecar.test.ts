import type { ChildProcess } from 'child_process'
import os from 'os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { parseReadyLine, sidecarArgs, startSidecar, type SidecarLaunch } from './sidecar'
import { FAKE_TOKEN, spawnFakeSidecar } from './testing/fakeSidecar'

function launch(behaviour: string, verify = false): SidecarLaunch {
  return { python: 'python', pyz: 'search.pyz', bundleDir: behaviour, cacheDir: 'cache', verify }
}

const READY = {
  event: 'ready',
  protocol: 1,
  port: 41234,
  token: FAKE_TOKEN,
  bundle: { version: '1.0.0' }
}

describe('sidecarArgs', () => {
  it('runs the zipapp isolated, with the bundle and cache, and verifies only when asked', () => {
    expect(sidecarArgs(launch('b'))).toEqual([
      '-I',
      '-B',
      'search.pyz',
      '--bundle',
      'b',
      '--cache-dir',
      'cache'
    ])
    expect(sidecarArgs(launch('b', true)).at(-1)).toBe('--verify')
  })
})

describe('parseReadyLine', () => {
  it('reads the port and token', () => {
    expect(parseReadyLine(JSON.stringify(READY))).toEqual({ port: 41234, token: FAKE_TOKEN })
  })

  it.each([
    ['a fatal line', { ...READY, event: 'fatal' }],
    ['another protocol', { ...READY, protocol: 2 }],
    ['a port out of range', { ...READY, port: 70000 }],
    ['a short token', { ...READY, token: 'abc' }]
  ])('refuses %s', (_name, event) => {
    expect(parseReadyLine(JSON.stringify(event))).toBeNull()
  })

  it('refuses a line that is not JSON', () => {
    expect(parseReadyLine('Traceback (most recent call last):')).toBeNull()
  })
})

describe('startSidecar', () => {
  it('starts on the ready line, and stops by closing stdin, well before any kill', async () => {
    const started = await startSidecar(launch('ready'), {
      spawnSidecar: spawnFakeSidecar,
      stopGraceMs: 30_000
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.sidecar.ready.token).toBe(FAKE_TOKEN)

    const begun = Date.now()
    await started.sidecar.stop()
    await started.sidecar.exited
    expect(Date.now() - begun).toBeLessThan(5_000)
  })

  it.each([
    [3, 'runtime_unsupported'],
    [4, 'bundle_incompatible'],
    [5, 'bundle_invalid'],
    [6, 'failed'],
    [1, 'failed']
  ])('reports exit code %i as %s', async (code, problem) => {
    expect(await startSidecar(launch(`fatal-${code}`), { spawnSidecar: spawnFakeSidecar })).toEqual(
      { ok: false, problem }
    )
  })

  it('stops a sidecar whose first line is not a ready line', async () => {
    expect(await startSidecar(launch('garbage'), { spawnSidecar: spawnFakeSidecar })).toEqual({
      ok: false,
      problem: 'failed'
    })
  })

  it('gives up on a sidecar that says nothing before the deadline', async () => {
    expect(
      await startSidecar(launch('silent'), { spawnSidecar: spawnFakeSidecar, readyTimeoutMs: 200 })
    ).toEqual({ ok: false, problem: 'failed' })
  })

  it('kills a sidecar that ignores its stdin closing, after the grace period', async () => {
    const children: ChildProcess[] = []
    const begun = Date.now()
    expect(
      await startSidecar(launch('stubborn'), {
        spawnSidecar: (python, args, options) => {
          const child = spawnFakeSidecar(python, args, options)
          children.push(child)
          return child
        },
        readyTimeoutMs: 200,
        stopGraceMs: 200
      })
    ).toEqual({ ok: false, problem: 'failed' })
    expect(Date.now() - begun).toBeLessThan(4_000)
    await vi.waitFor(() => expect(children[0]!.exitCode ?? children[0]!.signalCode).not.toBeNull())
  })

  it('stops a start that is called off, and never spawns one called off already', async () => {
    const abort = new AbortController()
    const spawned = vi.fn(spawnFakeSidecar)
    const pending = startSidecar(launch('silent'), {
      spawnSidecar: spawned,
      readyTimeoutMs: 30_000,
      stopGraceMs: 200,
      signal: abort.signal
    })
    setTimeout(() => abort.abort(), 100)
    expect(await pending).toEqual({ ok: false, problem: 'failed' })

    expect(
      await startSidecar(launch('ready'), { spawnSidecar: spawned, signal: abort.signal })
    ).toEqual({ ok: false, problem: 'failed' })
    expect(spawned).toHaveBeenCalledTimes(1)
  })

  it('reports a Python that does not exist as failed', async () => {
    expect(await startSidecar({ ...launch('ready'), python: '/nonexistent/python3' })).toEqual({
      ok: false,
      problem: 'failed'
    })
  })
})
