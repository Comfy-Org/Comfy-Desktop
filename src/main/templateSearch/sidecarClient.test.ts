import os from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
import { startSidecar, type RunningSidecar } from './sidecar'
import { postToSidecar, SidecarRequestError } from './sidecarClient'
import { spawnFakeSidecar } from './testing/fakeSidecar'

let running: RunningSidecar | null = null

async function start(behaviour = 'ready'): Promise<RunningSidecar> {
  const started = await startSidecar(
    { python: 'python', pyz: 'search.pyz', bundleDir: behaviour, cacheDir: 'cache', verify: false },
    { spawnSidecar: spawnFakeSidecar }
  )
  if (!started.ok) throw new Error(started.problem)
  running = started.sidecar
  return started.sidecar
}

afterEach(async () => {
  await running?.stop()
  running = null
})

describe('postToSidecar', () => {
  it('sends the request with the launch token and no browser origin, and reads the answer', async () => {
    const sidecar = await start()
    const answer = await postToSidecar(sidecar.ready, '/api/decide', { text: 'a poster' }, 2000)
    expect(answer).toMatchObject({ request: { text: 'a poster' }, outcome: { kind: 'unsat' } })
  })

  it('reports a refused request as an answer, not as the sidecar being gone', async () => {
    const sidecar = await start()
    const error = await postToSidecar(
      { ...sidecar.ready, token: 'x'.repeat(64) },
      '/api/decide',
      {},
      2000
    ).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(SidecarRequestError)
    expect(error).toMatchObject({ unreachable: false, message: expect.stringContaining('401') })
  })

  it('reports a sidecar that has stopped as unreachable', async () => {
    const sidecar = await start()
    await sidecar.stop()
    running = null
    await expect(postToSidecar(sidecar.ready, '/api/decide', {}, 2000)).rejects.toMatchObject({
      unreachable: true
    })
  })

  it('reports a sidecar that stops mid-answer as unreachable, so search can start it again', async () => {
    const sidecar = await start('drop')
    await expect(postToSidecar(sidecar.ready, '/api/decide', {}, 2000)).rejects.toMatchObject({
      unreachable: true
    })
  })

  it('gives up on an answer that takes longer than the timeout', async () => {
    const sidecar = await start('slow')
    await expect(postToSidecar(sidecar.ready, '/api/decide', {}, 300)).rejects.toMatchObject({
      unreachable: false,
      message: expect.stringContaining('timed out')
    })
  })
})
