import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: false,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { createExecutionTap } = await import('./executionTap')
const telemetry = await import('./telemetry')

describe('executionTap', () => {
  let captured: Array<{ event: string; ctx: Record<string, unknown> }>

  beforeEach(() => {
    captured = []
    vi.spyOn(telemetry, 'emit').mockImplementation((event, ctx) => {
      captured.push({ event, ctx: ctx as Record<string, unknown> })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aggregates starts and completions into the session summary', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('got prompt\ngot prompt\nPrompt executed in 12.5 seconds\n', 'stdout')
    tap.flushSummary()

    expect(captured.map((c) => c.event)).not.toContain('comfy.desktop.execution.started')
    expect(captured.map((c) => c.event)).not.toContain('comfy.desktop.execution.completed')
    const summary = captured.find((c) => c.event === 'comfy.desktop.execution.session_summary')
    expect(summary!.ctx).toMatchObject({
      installation_id: 'inst-1',
      started_count: 2,
      completed_count: 1
    })
  })

  it('adds model-load observations to the session summary without separate events', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load MiniMaxH3\nRequested to load MiniMaxH3\n', 'stdout')
    tap.ingest(
      'Model MiniMaxH3TEModel_ prepared for dynamic VRAM loading. 7671MB Staged.\n',
      'stdout'
    )
    tap.flushSummary()

    expect(captured.map((entry) => entry.event)).not.toContain('comfy.desktop.comfyui.model_usage')
    const summary = captured.find(
      (entry) => entry.event === 'comfy.desktop.execution.session_summary'
    )
    expect(summary?.ctx).toMatchObject({
      model_usage_schema_version: 1,
      model_observation_semantics: 'runtime_load_log_v1',
      model_classes: ['MiniMaxH3', 'MiniMaxH3TEModel_'],
      model_load_triggers: ['requested', 'dynamic_prepare'],
      model_target_devices: [null, null],
      model_load_counts: [2, 1],
      model_usage_truncated: false
    })
  })

  it('emits validation_failed errors with the reason lines as the message', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    // ComfyUI logs the header, then `* node:` / `- reason` detail lines, then
    // an unrelated line that terminates the block.
    tap.ingest(
      [
        'Failed to validate prompt for output 42:',
        '* CheckpointLoaderSimple 4:',
        "  - Value not in list: ckpt_name: 'missing.ckpt' not in ['real.safetensors']",
        'Something else entirely'
      ].join('\n') + '\n',
      'stdout'
    )
    const err = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(err).toBeDefined()
    expect(err!.ctx).toMatchObject({
      error_class: 'validation_failed',
      error_bucket: 'validation',
      node_id: '42'
    })
    // The reason detail is captured, not just the header.
    expect(String(err!.ctx.error_message)).toContain('Value not in list')
    // The signature normalizes user-specific values so distinct reasons still
    // group by shape.
    expect(String(err!.ctx.error_signature)).toContain('validation_failed|')
  })

  it('defers the validation error until the block ends and flushes on exit', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('Failed to validate prompt for output 7:\n', 'stdout')
    // No terminating line yet — nothing emitted.
    expect(captured.filter((c) => c.event === 'comfy.desktop.execution.error')).toHaveLength(0)
    tap.flushSummary()
    const err = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(err!.ctx).toMatchObject({ error_class: 'validation_failed', node_id: '7' })
  })

  it('parses current ComfyUI log lines carrying a colored [LEVEL] prefix', () => {
    // ComfyUI's ColoredFormatter emits `\x1b[32m[INFO]\x1b[0m got prompt` etc.,
    // not the bare strings the anchored patterns expect — ANSI must be stripped
    // before the level tag for the aggregate counters and errors to update.
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('\u001b[32m[INFO]\u001b[0m got prompt\n', 'stdout')
    tap.ingest('\u001b[32m[INFO]\u001b[0m Prompt executed in 7.78 seconds\n', 'stdout')
    tap.ingest(
      '\u001b[1m\u001b[31m[ERROR]\u001b[0m Failed to validate prompt for output 9:\n',
      'stdout'
    )
    // Deferred validation error flushes when the block ends.
    tap.flushSummary()

    const summary = captured.find((c) => c.event === 'comfy.desktop.execution.session_summary')
    expect(summary!.ctx).toMatchObject({ started_count: 1, completed_count: 1, error_count: 1 })
    const err = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(err!.ctx).toMatchObject({ error_class: 'validation_failed', node_id: '9' })
  })

  it('captures Python tracebacks from stderr and emits a single error', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    // Trailing line after the blank-line boundary so the parser sees the
    // boundary as a complete line (mirrors real ComfyUI output where logs
    // continue after a failure).
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "main.py", line 10, in <module>',
        '    raise RuntimeError("boom")',
        'RuntimeError: boom',
        '',
        'next-line'
      ].join('\n'),
      'stderr'
    )
    const errs = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    expect(errs.length).toBe(1)
    expect(errs[0]!.ctx).toMatchObject({ error_class: 'RuntimeError' })
  })

  it('recognizes exceptions from uppercase module packages like PIL', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "nodes.py", line 5, in load_image',
        '    img = Image.open(path)',
        "PIL.UnidentifiedImageError: cannot identify image file 'x.png'",
        '',
        'next-line'
      ].join('\n'),
      'stderr'
    )
    const errs = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    expect(errs.length).toBe(1)
    expect(errs[0]!.ctx).toMatchObject({ error_class: 'PIL.UnidentifiedImageError' })
  })

  it('emits one error using the outer exception in chained Python tracebacks', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "a.py", line 1, in <module>',
        '    raise ValueError("inner")',
        'ValueError: inner',
        '',
        'During handling of the above exception, another exception occurred:',
        '',
        'Traceback (most recent call last):',
        '  File "b.py", line 2, in <module>',
        '    raise RuntimeError("outer")',
        'RuntimeError: outer',
        '',
        'next-line'
      ].join('\n'),
      'stderr'
    )
    const errs = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    const classes = errs.map((e) => e.ctx['error_class'])
    expect(classes).toEqual(['RuntimeError'])
    expect(String(errs[0]!.ctx.error_traceback)).toContain('ValueError: inner')
  })

  it('does not emit an inner exception when a chain marker is split across chunks', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "a.py", line 1, in <module>',
        'ValueError: inner',
        ''
      ].join('\n'),
      'stderr'
    )
    tap.ingest('During handling of the above excep', 'stderr')
    tap.ingest(
      [
        'tion, another exception occurred:',
        '',
        'Traceback (most recent call last):',
        '  File "b.py", line 2, in <module>',
        'RuntimeError: outer'
      ].join('\n'),
      'stderr'
    )
    tap.flushSummary()

    const errors = captured.filter((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.ctx.error_class).toBe('RuntimeError')
  })

  it('emits separate errors for independent tracebacks', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "a.py", line 1, in <module>',
        'ValueError: first',
        '',
        'Traceback (most recent call last):',
        '  File "b.py", line 2, in <module>',
        'RuntimeError: second'
      ].join('\n'),
      'stderr'
    )
    tap.flushSummary()

    const errors = captured.filter((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(errors.map((entry) => entry.ctx.error_class)).toEqual(['ValueError', 'RuntimeError'])
  })

  it('separates adjacent independent tracebacks without a blank line', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        'ValueError: first',
        'Traceback (most recent call last):',
        'RuntimeError: second'
      ].join('\n'),
      'stderr'
    )
    tap.flushSummary()

    const errors = captured.filter((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(errors.map((entry) => entry.ctx.error_class)).toEqual(['ValueError', 'RuntimeError'])
  })

  it('ends a chain before a later independent traceback', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        'ValueError: inner',
        '',
        'During handling of the above exception, another exception occurred:',
        '',
        'Traceback (most recent call last):',
        'RuntimeError: outer',
        '',
        'Traceback (most recent call last):',
        'OSError: independent'
      ].join('\n'),
      'stderr'
    )
    tap.flushSummary()

    const errors = captured.filter((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(errors.map((entry) => entry.ctx.error_class)).toEqual(['RuntimeError', 'OSError'])
  })

  it('scrubs PII (Windows user paths) from traceback error messages', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "C:\\Users\\alice\\stuff.py", line 10, in foo',
        '    open("bad")',
        "FileNotFoundError: [Errno 2] No such file: 'C:\\Users\\alice\\bad'",
        '',
        'next-line'
      ].join('\n'),
      'stderr'
    )
    const errs = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    expect(errs.length).toBe(1)
    const message = String(errs[0]!.ctx.error_message)
    expect(message).not.toContain('alice')
    expect(message).toContain('[REDACTED]')
  })

  it('flushSummary drains a pending traceback so errors are not lost on exit', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    // No trailing blank line — process died before traceback ended.
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "x.py", line 9, in y',
        'KeyError: missing'
      ].join('\n') + '\n',
      'stderr'
    )
    // Without flush, no error emitted yet (no blank-line boundary).
    expect(captured.filter((c) => c.event === 'comfy.desktop.execution.error')).toHaveLength(0)
    tap.flushSummary()
    expect(captured.filter((c) => c.event === 'comfy.desktop.execution.error')).toHaveLength(1)
    expect(
      captured.filter((c) => c.event === 'comfy.desktop.execution.session_summary')
    ).toHaveLength(1)
  })

  it('recognizes SystemExit and keeps a bounded traceback suffix', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    const frames = Array.from({ length: 300 }, (_, i) => `  File "frame${i}.py", line ${i}`)
    tap.ingest(
      ['Traceback (most recent call last):', ...frames, 'SystemExit: 2'].join('\n'),
      'stderr'
    )
    tap.flushSummary()
    const error = captured.find((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(error?.ctx.error_class).toBe('SystemExit')
    expect(String(error?.ctx.error_traceback).length).toBeLessThanOrEqual(16 * 1024)
    expect(String(error?.ctx.error_traceback)).toContain('SystemExit: 2')
  })

  it('recognizes traceback exceptions without a conventional class suffix', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest(
      ['Traceback (most recent call last):', '  File "node.py", line 1', 'Boom: failed'].join('\n'),
      'stderr'
    )
    tap.flushSummary()

    const error = captured.find((entry) => entry.event === 'comfy.desktop.execution.error')
    expect(error?.ctx.error_message).toBe('Boom: failed')
  })

  it('flushSummary parses a final line written without a trailing newline', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    // The fatal exception line is the LAST thing written and has no trailing
    // newline (process died mid-line), so it sits unparsed in `pending`.
    tap.ingest(
      [
        'Traceback (most recent call last):',
        '  File "z.py", line 3, in run',
        '    raise KeyError("gone")',
        'KeyError: gone' // no trailing '\n'
      ].join('\n'),
      'stderr'
    )
    expect(captured.filter((c) => c.event === 'comfy.desktop.execution.error')).toHaveLength(0)
    tap.flushSummary()
    const errs = captured.filter((c) => c.event === 'comfy.desktop.execution.error')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.ctx).toMatchObject({ error_class: 'KeyError' })
  })

  it('flushSummary captures a validation reason line written without a trailing newline', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('Failed to validate prompt for output 3:\n', 'stdout')
    // Reason line is the final write and has no trailing newline.
    tap.ingest("  - Value not in list: ckpt_name: 'x' not in ['y']", 'stdout')
    tap.flushSummary()
    const err = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(err!.ctx).toMatchObject({ error_class: 'validation_failed', node_id: '3' })
    expect(String(err!.ctx.error_message)).toContain('Value not in list')
  })

  it('retains error wall-clock tracking after many unpaired starts', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    // Far more than the cap (256).
    for (let i = 0; i < 1000; i++) tap.ingest('got prompt\n', 'stdout')
    tap.ingest(
      ['Traceback (most recent call last):', 'RuntimeError: boom', '', 'next-line'].join('\n'),
      'stderr'
    )
    const error = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(typeof error!.ctx.wall_clock_ms).toBe('number')
  })

  it('emits a session_summary on flush even when nothing was captured', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.flushSummary()
    const summary = captured.find((c) => c.event === 'comfy.desktop.execution.session_summary')
    expect(summary).toBeDefined()
    expect(summary!.ctx).toMatchObject({
      installation_id: 'inst-1',
      started_count: 0,
      completed_count: 0,
      error_count: 0,
      model_classes: [],
      model_load_triggers: [],
      model_target_devices: [],
      model_load_counts: [],
      model_usage_truncated: false
    })
  })

  it('flushes a model observation from a final unterminated line only once', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('Requested to load MiniMaxH3', 'stdout')
    tap.flushSummary()
    tap.flushSummary()

    const summaries = captured.filter(
      (entry) => entry.event === 'comfy.desktop.execution.session_summary'
    )
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.ctx).toMatchObject({
      model_classes: ['MiniMaxH3'],
      model_load_counts: [1]
    })
  })

  it('handles split chunks at line boundaries', () => {
    const tap = createExecutionTap({ installationId: 'inst-1' })
    tap.ingest('got pro', 'stdout')
    tap.ingest('mpt\nPrompt executed in 2 seconds\n', 'stdout')
    tap.flushSummary()
    const summary = captured.find((c) => c.event === 'comfy.desktop.execution.session_summary')
    expect(summary!.ctx).toMatchObject({ started_count: 1, completed_count: 1 })
  })

  it('redacts Bearer tokens and api keys from traceback messages (secret scrub)', () => {
    const bearer = 'Bearer ' + 'a'.repeat(30)
    const apiKey = 's' + 'k-' + 'a'.repeat(24)
    const tap = createExecutionTap({ installationId: 'inst-1' })
    const tracebackLines = [
      'Traceback (most recent call last):',
      '  File ' + JSON.stringify('x.py') + ', line 1, in <module>',
      '    raise RuntimeError(' +
        JSON.stringify(bearer + ' was rejected, ' + apiKey + ' also bad') +
        ')',
      'RuntimeError: ' + bearer + ' was rejected, ' + apiKey + ' also bad',
      '',
      'next-line'
    ]
    tap.ingest(tracebackLines.join('\n'), 'stderr')
    const err = captured.find((c) => c.event === 'comfy.desktop.execution.error')
    expect(err).toBeDefined()
    const msg = String(err!.ctx['error_message'])
    expect(msg).toContain('Bearer ' + '[' + 'REDACTED' + ']')
    expect(msg).not.toContain('a'.repeat(30))
    expect(msg).not.toContain(apiKey)
    expect(msg).toContain('[' + 'REDACTED' + ']')
  })
})
