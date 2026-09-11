import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `canvasEntry` only pulls `getSessionStartedAt` from `./ipc/shared`. Mock the
// module so the server-ready anchor is controllable and we don't drag in
// electron / the live session registry.
const getSessionStartedAt = vi.fn<(installationId: string) => number | null>()
vi.mock('./ipc/shared', () => ({
  getSessionStartedAt: (installationId: string) => getSessionStartedAt(installationId)
}))

const { noteCanvasRendered, resetCanvasRendered, _resetForTest } = await import('./canvasEntry')
const telemetry = await import('./telemetry')

const CANVAS_RENDERED = 'comfy.desktop.comfyui.canvas_rendered'

describe('canvasEntry', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  beforeEach(() => {
    captured = []
    _resetForTest()
    getSessionStartedAt.mockReset()
    getSessionStartedAt.mockReturnValue(null)
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const canvasEvents = () => captured.filter((c) => c.event === CANVAS_RENDERED)

  it('emits canvas_rendered exactly once on the first successful render', () => {
    noteCanvasRendered('inst-1')
    expect(canvasEvents()).toHaveLength(1)
    expect(canvasEvents()[0]!.ctx).toMatchObject({
      installation_id: 'inst-1',
      load_failed: false,
      template_id_or_null: null
    })
  })

  it('dedups a repeat render for the same installation in the same launch', () => {
    noteCanvasRendered('inst-1')
    noteCanvasRendered('inst-1')
    noteCanvasRendered('inst-1')
    expect(canvasEvents()).toHaveLength(1)
  })

  it('dedups per installation_id, not globally', () => {
    noteCanvasRendered('inst-1')
    noteCanvasRendered('inst-2')
    noteCanvasRendered('inst-1') // deduped
    noteCanvasRendered('inst-2') // deduped
    expect(canvasEvents()).toHaveLength(2)
    expect(canvasEvents().map((c) => c.ctx.installation_id)).toEqual(['inst-1', 'inst-2'])
  })

  it('re-fires after resetCanvasRendered clears the per-launch guard', () => {
    noteCanvasRendered('inst-1')
    expect(canvasEvents()).toHaveLength(1)
    resetCanvasRendered('inst-1')
    noteCanvasRendered('inst-1')
    expect(canvasEvents()).toHaveLength(2)
  })

  it('records a failed load and BYPASSES the first-render dedup (distinct signal)', () => {
    // A successful render claims the dedup slot...
    noteCanvasRendered('inst-1')
    // ...but a failed load for the same id still emits — it is not deduped.
    noteCanvasRendered('inst-1', { loadFailed: true })
    expect(canvasEvents()).toHaveLength(2)

    const failed = canvasEvents().filter((c) => c.ctx.load_failed === true)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.ctx).toMatchObject({ installation_id: 'inst-1', load_failed: true })
  })

  it('a failed load does not consume the success dedup slot', () => {
    // Failed load first; the subsequent successful render must still emit once.
    noteCanvasRendered('inst-1', { loadFailed: true })
    noteCanvasRendered('inst-1')
    noteCanvasRendered('inst-1') // now deduped
    const successes = canvasEvents().filter((c) => c.ctx.load_failed === false)
    const failures = canvasEvents().filter((c) => c.ctx.load_failed === true)
    expect(failures).toHaveLength(1)
    expect(successes).toHaveLength(1)
  })

  it('repeated failed loads are each recorded (never deduped)', () => {
    noteCanvasRendered('inst-1', { loadFailed: true })
    noteCanvasRendered('inst-1', { loadFailed: true })
    const failures = canvasEvents().filter((c) => c.ctx.load_failed === true)
    expect(failures).toHaveLength(2)
  })

  it('computes server_ready_to_canvas_ms from the session startedAt anchor', () => {
    vi.useFakeTimers()
    try {
      const startedAt = 1_000_000
      vi.setSystemTime(startedAt)
      getSessionStartedAt.mockReturnValue(startedAt)
      vi.setSystemTime(startedAt + 1234)
      noteCanvasRendered('inst-1')
    } finally {
      vi.useRealTimers()
    }
    expect(canvasEvents()).toHaveLength(1)
    expect(canvasEvents()[0]!.ctx.server_ready_to_canvas_ms).toBe(1234)
  })

  it('emits server_ready_to_canvas_ms = null when no running session is found', () => {
    getSessionStartedAt.mockReturnValue(null)
    noteCanvasRendered('inst-1')
    expect(canvasEvents()[0]!.ctx.server_ready_to_canvas_ms).toBeNull()
  })

  it('emits the full expected prop shape', () => {
    getSessionStartedAt.mockReturnValue(null)
    noteCanvasRendered('inst-1')
    expect(canvasEvents()[0]!.ctx).toEqual({
      installation_id: 'inst-1',
      server_ready_to_canvas_ms: null,
      template_id_or_null: null,
      load_failed: false
    })
  })

  it('passes the installation id through to getSessionStartedAt', () => {
    noteCanvasRendered('inst-42')
    expect(getSessionStartedAt).toHaveBeenCalledWith('inst-42')
  })
})
