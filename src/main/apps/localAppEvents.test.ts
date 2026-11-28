import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const sdkCaptures = vi.hoisted(
  () => [] as Array<{ event: string; properties?: Record<string, unknown> }>
)

vi.mock('posthog-node', () => ({
  PostHog: class {
    on(): () => void {
      return () => {}
    }
    capture(call: { event: string; properties?: Record<string, unknown> }): void {
      sdkCaptures.push(call)
    }
    identify(): void {}
    flush(): Promise<void> {
      return Promise.resolve()
    }
    shutdown(): Promise<void> {
      return Promise.resolve()
    }
  }
}))

import * as telemetry from '../lib/telemetry'
import { _resetPageTestsForTest, rememberPageTestGroup } from './pageTest'
import {
  _resetForTest,
  buildsWithRuns,
  busyAppOn,
  errorClassOf,
  failRunsOn,
  finishRun,
  isFollowing,
  noteRunMessage,
  onRunLost,
  onRunsChanged,
  RUN_FINISHED_EVENT,
  runAccepted,
  runEndFromHistory,
  runsOn,
  SETUP_EVENT,
  settleRun,
  setupStarted,
  unstartedRunsOn
} from './localAppEvents'

const APP = 'product-ads'
const BUILD = 'studio'
const RUN = '0b1c2d3e-aaaa-bbbb-cccc-0123456789ab'
const OTHER_RUN = 'ffffffff-aaaa-bbbb-cccc-0123456789ab'
const T0 = 1_800_000_000_000
const PROMPT_WORDS = 'a-cat-in-a-red-hat'
const REFUSAL_MESSAGE = `Polling aborted due to error: Task failed: ${JSON.stringify({
  id: 'cgt-20261118-0001',
  status: 'failed',
  content: { prompt: PROMPT_WORDS },
  error: {
    code: 'OutputVideoSensitiveContentDetected',
    message: 'The output video may contain sensitive information.'
  }
})}`

const ECHOED_PROMPT_FAILURE = `Polling aborted due to error: Task failed: ${JSON.stringify({
  id: 'gen-1',
  state: 'failed',
  failure_reason: 'Internal service error',
  request: { prompt: 'A poster saying content moderated' }
})}\n`

const DEEP_ARRAYS = `${'['.repeat(20_000)}${']'.repeat(20_000)}`
const DEEP_TEXT_ANSWER = `Gemini answered with text: {"result": ${DEEP_ARRAYS}}`

function message(type: string, data: Record<string, unknown> = {}, promptId = RUN): unknown {
  return { type, data: { prompt_id: promptId, ...data } }
}

function sent(event: string): Record<string, unknown>[] {
  return sdkCaptures.filter((c) => c.event === event).map((c) => c.properties ?? {})
}

function allowTelemetry(): void {
  telemetry.setConsentState('granted')
  telemetry.bindAnonymousId('anon-1', 'anon-1', {})
}

beforeEach(() => {
  process.env['POSTHOG_API_KEY'] = 'test-key'
  process.env['POSTHOG_ENABLED'] = '1'
  telemetry._resetForTest()
  telemetry._test_resetVolumeGuards()
  telemetry.initTelemetry({ appVersion: '0.0.0', appEnv: 'test', isPackaged: true })
  _resetForTest()
  _resetPageTestsForTest()
  sdkCaptures.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  telemetry._resetForTest()
  _resetForTest()
  sdkCaptures.length = 0
  delete process.env['POSTHOG_API_KEY']
  delete process.env['POSTHOG_ENABLED']
})

describe('errorClassOf', () => {
  it.each([
    ['torch.OutOfMemoryError', 'out_of_memory_error'],
    ['torch.cuda.OutOfMemoryError', 'out_of_memory_error'],
    ['RuntimeError', 'runtime_error'],
    ['comfy.model_management.InterruptProcessingException', 'interrupt_processing_exception'],
    ['CUDAError', 'cuda_error'],
    ['ExecutionBlocked', 'execution_blocked'],
    ['custom_nodes.some_pack.nodes.HTTPTimeoutError', 'http_timeout_error']
  ])('turns %s into %s', (exceptionType, errorClass) => {
    expect(errorClassOf(exceptionType)).toBe(errorClass)
  })

  it.each([
    ['a message with spaces', 'CUDA out of memory. Tried to allocate 2 GiB'],
    ['a path', 'C:\\Users\\someone\\ComfyUI\\nodes.py'],
    ['a unix path', '/home/someone/ComfyUI/nodes.py'],
    ['an empty string', ''],
    ['a class name that is too long', `E${'x'.repeat(64)}`],
    ['not a string', 42]
  ])('drops %s', (_what, exceptionType) => {
    expect(errorClassOf(exceptionType)).toBeUndefined()
  })
})

describe('run_finished', () => {
  beforeEach(allowTelemetry)

  it('sends how a run ended, with its run and queue time in whole seconds', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 + 2_400 }))
    noteRunMessage(message('execution_success', { timestamp: T0 + 14_700 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({
        app_id: APP,
        where: 'local',
        outcome: 'success',
        run_seconds: 12,
        queue_seconds: 2
      })
    ])
    expect(sent(RUN_FINISHED_EVENT)[0]).not.toHaveProperty('error_class')
  })

  it.each([
    ['execution_success', {}, { outcome: 'success' }],
    [
      'execution_error',
      { exception_type: 'torch.OutOfMemoryError', exception_message: 'Allocation on /dev/x' },
      { outcome: 'failed', error_class: 'out_of_memory_error' }
    ],
    ['execution_interrupted', { node_id: '3' }, { outcome: 'cancelled' }]
  ])('maps %s to its outcome', (type, data, expected) => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(message(type, { ...data, timestamp: T0 + 1_000 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([expect.objectContaining(expected)])
    expect(JSON.stringify(sdkCaptures)).not.toContain('/dev/x')
  })

  it.each([
    ['Exception', REFUSAL_MESSAGE, 'exception'],
    [
      'RuntimeError',
      `ByteDance request failed. Code: InputImageSensitiveContentDetected, message: ${PROMPT_WORDS}`,
      'runtime_error'
    ]
  ])(
    'sends a run a partner refused for its content as refused, with the %s error class and no message text',
    (exceptionType, exceptionMessage, errorClass) => {
      runAccepted(RUN, BUILD, APP, T0)
      noteRunMessage(message('execution_start', { timestamp: T0 }))
      noteRunMessage(
        message('execution_error', {
          node_id: '12',
          node_type: 'ByteDanceSeedanceNode',
          exception_type: exceptionType,
          exception_message: exceptionMessage,
          timestamp: T0 + 30_000
        })
      )

      expect(sent(RUN_FINISHED_EVENT)).toEqual([
        expect.objectContaining({
          app_id: APP,
          where: 'local',
          outcome: 'refused',
          error_class: errorClass,
          run_seconds: 30
        })
      ])
      const wire = JSON.stringify(sdkCaptures)
      expect(wire).not.toContain(PROMPT_WORDS)
      expect(wire).not.toContain('SensitiveContentDetected')
      expect(wire).not.toContain('Task failed')
    }
  )

  it('keeps a run that broke on its own as failed', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(
      message('execution_error', {
        exception_type: 'KeyError',
        exception_message: "'clip_vision'",
        timestamp: T0 + 1_000
      })
    )

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'failed', error_class: 'key_error' })
    ])
  })

  it('keeps a failed run whose echoed prompt names a refusal status as failed', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(
      message('execution_error', {
        exception_type: 'Exception',
        exception_message: ECHOED_PROMPT_FAILURE,
        timestamp: T0 + 1_000
      })
    )

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'failed', error_class: 'exception' })
    ])
  })

  it('keeps a failed run whose message nests JSON 20,000 deep as failed', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    expect(() =>
      noteRunMessage(
        message('execution_error', {
          exception_type: 'ValueError',
          exception_message: DEEP_TEXT_ANSWER,
          timestamp: T0 + 1_000
        })
      )
    ).not.toThrow()

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'failed', error_class: 'value_error' })
    ])
  })

  it('sends a refused run that ended before Desktop read its prompt id as refused', () => {
    noteRunMessage(message('execution_start', { timestamp: T0 + 1_000 }))
    noteRunMessage(
      message('execution_error', {
        exception_type: 'Exception',
        exception_message: REFUSAL_MESSAGE,
        timestamp: T0 + 4_000
      })
    )
    runAccepted(RUN, BUILD, APP, T0)

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'refused', error_class: 'exception' })
    ])
    expect(JSON.stringify(sdkCaptures)).not.toContain(PROMPT_WORDS)
  })

  it('sends one event per run, however many end messages arrive', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(message('execution_success', { timestamp: T0 + 1_000 }))
    noteRunMessage(message('execution_success', { timestamp: T0 + 2_000 }))
    noteRunMessage(message('execution_interrupted', { timestamp: T0 + 3_000 }))
    failRunsOn(BUILD, 'comfyui_stopped')

    expect(sent(RUN_FINISHED_EVENT)).toHaveLength(1)
    expect(isFollowing(RUN)).toBe(false)
  })

  it('keeps following a run past the ExecutionBlocked notice ComfyUI sends for a blocked branch', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(
      message('execution_error', {
        node_id: '7',
        node_type: 'TestExecutionBlocker',
        executed: [],
        exception_message: 'Execution Blocked: not this branch',
        exception_type: 'ExecutionBlocked',
        traceback: [],
        current_inputs: [],
        current_outputs: []
      })
    )
    expect(isFollowing(RUN)).toBe(true)

    noteRunMessage(message('execution_success', { timestamp: T0 + 3_000 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'success', run_seconds: 3 })
    ])
  })

  it('does not hold an ExecutionBlocked notice as the end of a run Desktop has not read yet', () => {
    noteRunMessage(message('execution_start', { timestamp: T0 + 1_000 }))
    noteRunMessage(message('execution_error', { exception_type: 'ExecutionBlocked' }))
    runAccepted(RUN, BUILD, APP, T0)

    expect(sent(RUN_FINISHED_EVENT)).toEqual([])
    expect(isFollowing(RUN)).toBe(true)
  })

  it('sends nothing for a run Desktop did not send', () => {
    noteRunMessage(message('execution_start', {}, OTHER_RUN))
    noteRunMessage(message('execution_success', {}, OTHER_RUN))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([])
  })

  it('ignores messages that are not about a run', () => {
    runAccepted(RUN, BUILD, APP, T0)
    for (const other of [
      null,
      'execution_success',
      { type: 'execution_success' },
      { type: 'execution_success', data: { prompt_id: 42 } },
      message('progress', { value: 3, max: 10 }),
      message('executing', { node: '3' })
    ]) {
      noteRunMessage(other)
    }

    expect(sent(RUN_FINISHED_EVENT)).toEqual([])
    expect(isFollowing(RUN)).toBe(true)
  })

  it('sends a run that ended before Desktop read its prompt id, once it does', () => {
    noteRunMessage(message('execution_start', { timestamp: T0 + 1_000 }))
    noteRunMessage(message('execution_success', { timestamp: T0 + 4_000 }))
    expect(sent(RUN_FINISHED_EVENT)).toEqual([])

    runAccepted(RUN, BUILD, APP, T0)

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'success', run_seconds: 3, queue_seconds: 1 })
    ])
  })

  it('keeps the start of a run that started before Desktop read its prompt id', () => {
    noteRunMessage(message('execution_start', { timestamp: T0 + 3_000 }))
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_success', { timestamp: T0 + 8_000 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ run_seconds: 5, queue_seconds: 3 })
    ])
  })

  it('uses the time Desktop heard a message when ComfyUI gives none', () => {
    vi.useFakeTimers({ now: T0 })
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_start'))
    vi.setSystemTime(T0 + 6_000)
    noteRunMessage(message('execution_success'))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ run_seconds: 6, queue_seconds: 0 })
    ])
  })

  it('leaves out app_id when Desktop does not know the app', () => {
    runAccepted(RUN, BUILD, null, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(message('execution_success', { timestamp: T0 }))

    expect(sent(RUN_FINISHED_EVENT)[0]).not.toHaveProperty('app_id')
  })

  it('ends every run on a build that exited as failed, and only those', () => {
    runAccepted(RUN, BUILD, APP, T0)
    runAccepted(OTHER_RUN, 'lab', 'remove-background', T0)
    expect(buildsWithRuns()).toEqual([BUILD, 'lab'])

    failRunsOn(BUILD, 'comfyui_crashed', T0 + 9_000)

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({
        app_id: APP,
        outcome: 'failed',
        error_class: 'comfyui_exited'
      })
    ])
    expect(sent(RUN_FINISHED_EVENT)[0]).not.toHaveProperty('run_seconds')
    expect(sent(RUN_FINISHED_EVENT)[0]).not.toHaveProperty('queue_seconds')
    expect(runsOn(BUILD)).toEqual([])
    expect(runsOn('lab')).toEqual([OTHER_RUN])
  })

  it('tells a lost-run watcher which run was lost and why, once', () => {
    const watcher = vi.fn()
    onRunLost(watcher)
    runAccepted(RUN, BUILD, APP, T0)

    failRunsOn(BUILD, 'comfyui_stopped', T0 + 9_000)
    finishRun(RUN, { outcome: 'success', at: T0 + 10_000 })

    expect(watcher).toHaveBeenCalledExactlyOnceWith(RUN, 'comfyui_stopped')
  })

  it.each([
    ['that finished', message('execution_success')],
    [
      'that a custom node failed with an error called ComfyuiExited',
      message('execution_error', { exception_type: 'ComfyuiExited' })
    ]
  ])('does not call a run lost %s', (_case, ending) => {
    const watcher = vi.fn()
    onRunLost(watcher)
    runAccepted(RUN, BUILD, APP, T0)

    noteRunMessage(message('execution_start'))
    noteRunMessage(ending)

    expect(isFollowing(RUN)).toBe(false)
    expect(watcher).not.toHaveBeenCalled()
  })

  it('lists the runs on a build that have not started, for checking a queue that changed', () => {
    runAccepted(RUN, BUILD, APP, T0)
    runAccepted(OTHER_RUN, BUILD, APP, T0)
    runAccepted('third-run', 'lab', APP, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }, OTHER_RUN))

    expect(unstartedRunsOn(BUILD)).toEqual([RUN])
  })

  it('counts a run that never started as no run time and no queue time', () => {
    runAccepted(RUN, BUILD, APP, T0)
    finishRun(RUN, { outcome: 'cancelled', at: T0 + 5_000 })

    const [event] = sent(RUN_FINISHED_EVENT)
    expect(event).toMatchObject({ outcome: 'cancelled' })
    expect(event).not.toHaveProperty('run_seconds')
    expect(event).not.toHaveProperty('queue_seconds')
  })

  it.each(['denied', 'undecided'] as const)('sends nothing while consent is %s', (consent) => {
    telemetry.setConsentState(consent)
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_success', { timestamp: T0 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([])
  })
})

describe('run_finished for a run whose start Desktop did not hear', () => {
  beforeEach(allowTelemetry)

  const fromHistory = { outcome: 'success' as const, startedAt: T0 + 2_000, at: T0 + 9_000 }

  it('waits for its history instead of sending a run time of zero', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_success', { timestamp: T0 + 9_000 }))

    expect(sent(RUN_FINISHED_EVENT)).toEqual([])
    expect(unstartedRunsOn(BUILD)).toEqual([RUN])
  })

  it('takes the start from its history', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_success', { timestamp: T0 + 9_000 }))

    settleRun(RUN, fromHistory, { outcome: 'cancelled', at: T0 + 10_000 })

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ outcome: 'success', run_seconds: 7, queue_seconds: 2 })
    ])
  })

  it('sends how it ended with no run time when its history is gone', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_error', { exception_type: 'RuntimeError' }))

    settleRun(RUN, null, { outcome: 'cancelled', at: T0 + 10_000 })

    const [event] = sent(RUN_FINISHED_EVENT)
    expect(event).toMatchObject({ outcome: 'failed', error_class: 'runtime_error' })
    expect(event).not.toHaveProperty('run_seconds')
  })

  it('sends how it ended with no run time when its ComfyUI exits first', () => {
    runAccepted(RUN, BUILD, APP, T0)
    noteRunMessage(message('execution_success', { timestamp: T0 + 9_000 }))

    failRunsOn(BUILD, 'comfyui_stopped')

    const [event] = sent(RUN_FINISHED_EVENT)
    expect(event).toMatchObject({ outcome: 'success' })
    expect(event).not.toHaveProperty('run_seconds')
    expect(event).not.toHaveProperty('error_class')
  })

  it('sends a run that ended before Desktop read its prompt id with no run time', () => {
    noteRunMessage(message('execution_success', { timestamp: T0 + 4_000 }))
    runAccepted(RUN, BUILD, APP, T0)

    const [event] = sent(RUN_FINISHED_EVENT)
    expect(event).toMatchObject({ outcome: 'success' })
    expect(event).not.toHaveProperty('run_seconds')
  })
})

describe('runEndFromHistory', () => {
  function entry(statusStr: string, messages: unknown[]): unknown {
    return { outputs: {}, status: { status_str: statusStr, completed: true, messages } }
  }

  it('reads a run that succeeded, with its start and end time', () => {
    expect(
      runEndFromHistory(
        entry('success', [
          ['execution_start', { prompt_id: RUN, timestamp: T0 }],
          ['execution_cached', { prompt_id: RUN, nodes: [], timestamp: T0 + 10 }],
          ['execution_success', { prompt_id: RUN, timestamp: T0 + 7_000 }]
        ])
      )
    ).toEqual({ outcome: 'success', startedAt: T0, at: T0 + 7_000 })
  })

  it('reads a run that failed, with its error class and no message text', () => {
    const end = runEndFromHistory(
      entry('error', [
        ['execution_start', { prompt_id: RUN, timestamp: T0 }],
        [
          'execution_error',
          {
            prompt_id: RUN,
            exception_type: 'torch.OutOfMemoryError',
            exception_message: 'out of memory at C:\\Users\\someone',
            timestamp: T0 + 2_000
          }
        ]
      ])
    )
    expect(end).toEqual({
      outcome: 'failed',
      errorClass: 'out_of_memory_error',
      startedAt: T0,
      at: T0 + 2_000
    })
  })

  it('reads a run a partner refused for its content as refused, with its error class', () => {
    const end = runEndFromHistory(
      entry('error', [
        ['execution_start', { prompt_id: RUN, timestamp: T0 }],
        [
          'execution_error',
          {
            prompt_id: RUN,
            node_id: '12',
            exception_type: 'Exception',
            exception_message: REFUSAL_MESSAGE,
            timestamp: T0 + 30_000
          }
        ]
      ])
    )
    expect(end).toEqual({
      outcome: 'refused',
      errorClass: 'exception',
      startedAt: T0,
      at: T0 + 30_000
    })
  })

  it('reads an API error whose type is a content policy violation as refused', () => {
    expect(
      runEndFromHistory(
        entry('error', [
          [
            'execution_error',
            {
              prompt_id: RUN,
              exception_type: 'Exception',
              exception_message: 'API Error: Request blocked. (Type: content_policy_violation)'
            }
          ]
        ])
      )
    ).toMatchObject({ outcome: 'refused', errorClass: 'exception' })
  })

  it('reads a failed run whose echoed prompt names a refusal status as failed', () => {
    expect(
      runEndFromHistory(
        entry('error', [
          [
            'execution_error',
            {
              prompt_id: RUN,
              exception_type: 'Exception',
              exception_message: ECHOED_PROMPT_FAILURE
            }
          ]
        ])
      )
    ).toMatchObject({ outcome: 'failed', errorClass: 'exception' })
  })

  it('reads a failed run whose message nests JSON 20,000 deep as failed', () => {
    expect(
      runEndFromHistory(
        entry('error', [
          [
            'execution_error',
            {
              prompt_id: RUN,
              exception_type: 'ValueError',
              exception_message: DEEP_TEXT_ANSWER
            }
          ]
        ])
      )
    ).toMatchObject({ outcome: 'failed', errorClass: 'value_error' })
  })

  it('reads a run that failed with no message as failed', () => {
    expect(
      runEndFromHistory(
        entry('error', [['execution_error', { prompt_id: RUN, exception_type: 'Exception' }]])
      )
    ).toMatchObject({ outcome: 'failed', errorClass: 'exception' })
  })

  it('reads a run that was stopped as cancelled', () => {
    expect(
      runEndFromHistory(
        entry('error', [
          ['execution_start', { prompt_id: RUN, timestamp: T0 }],
          ['execution_interrupted', { prompt_id: RUN, timestamp: T0 + 1_000 }]
        ])
      )
    ).toMatchObject({ outcome: 'cancelled', at: T0 + 1_000 })
  })

  const blocked = [
    'execution_error',
    {
      prompt_id: RUN,
      exception_type: 'ExecutionBlocked',
      exception_message: 'Execution Blocked: switch off',
      timestamp: T0 + 1_000
    }
  ]

  it('reads a run that succeeded after a blocked branch as a success', () => {
    expect(
      runEndFromHistory(
        entry('success', [
          ['execution_start', { prompt_id: RUN, timestamp: T0 }],
          blocked,
          ['execution_success', { prompt_id: RUN, timestamp: T0 + 3_000 }]
        ])
      )
    ).toEqual({ outcome: 'success', startedAt: T0, at: T0 + 3_000 })
  })

  it('reads the error that failed a run, not a blocked branch before it', () => {
    expect(
      runEndFromHistory(
        entry('error', [
          ['execution_start', { prompt_id: RUN, timestamp: T0 }],
          blocked,
          [
            'execution_error',
            { prompt_id: RUN, exception_type: 'torch.OutOfMemoryError', timestamp: T0 + 2_000 }
          ]
        ])
      )
    ).toEqual({
      outcome: 'failed',
      errorClass: 'out_of_memory_error',
      startedAt: T0,
      at: T0 + 2_000
    })
  })

  it.each([
    ['no entry', undefined],
    ['an entry with no status', { outputs: {} }],
    ['a status it does not know', entry('running', [])]
  ])('says nothing for %s', (_what, historyEntry) => {
    expect(runEndFromHistory(historyEntry)).toBeNull()
  })
})

describe('run_finished for a refused run read from history', () => {
  beforeEach(allowTelemetry)

  it('sends refused with its error class and no message text', () => {
    runAccepted(RUN, BUILD, APP, T0)
    const fromHistory = runEndFromHistory({
      outputs: {},
      status: {
        status_str: 'error',
        completed: true,
        messages: [
          ['execution_start', { prompt_id: RUN, timestamp: T0 + 1_000 }],
          [
            'execution_error',
            {
              prompt_id: RUN,
              exception_type: 'Exception',
              exception_message: REFUSAL_MESSAGE,
              timestamp: T0 + 21_000
            }
          ]
        ]
      }
    })

    settleRun(RUN, fromHistory, {
      outcome: 'failed',
      errorClass: 'comfyui_exited',
      at: T0 + 30_000
    })

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({
        app_id: APP,
        where: 'local',
        outcome: 'refused',
        error_class: 'exception',
        run_seconds: 20,
        queue_seconds: 1
      })
    ])
    const wire = JSON.stringify(sdkCaptures)
    expect(wire).not.toContain(PROMPT_WORDS)
    expect(wire).not.toContain('SensitiveContentDetected')
  })
})

describe('setup', () => {
  beforeEach(allowTelemetry)

  it('sends started, then finished once with whole seconds', () => {
    vi.useFakeTimers({ now: T0 })
    const step = setupStarted('start', APP)
    vi.setSystemTime(T0 + 41_600)
    step.finished()
    step.finished()
    step.failed('start_failed')

    expect(sent(SETUP_EVENT)).toEqual([
      expect.objectContaining({ app_id: APP, stage: 'start', outcome: 'started' }),
      expect.objectContaining({ app_id: APP, stage: 'start', outcome: 'finished', seconds: 42 })
    ])
    expect(sent(SETUP_EVENT)[0]).not.toHaveProperty('seconds')
  })

  it('sends failed with its error class', () => {
    vi.useFakeTimers({ now: T0 })
    const step = setupStarted('install', APP)
    vi.setSystemTime(T0 + 3_000)
    step.failed('install_failed')

    expect(sent(SETUP_EVENT).at(-1)).toMatchObject({
      stage: 'install',
      outcome: 'failed',
      error_class: 'install_failed',
      seconds: 3
    })
  })

  it('sends nothing more for a cancelled step', () => {
    const step = setupStarted('install', APP)
    step.cancelled()
    step.finished()

    expect(sent(SETUP_EVENT).map((event) => event['outcome'])).toEqual(['started'])
  })

  it('leaves out app_id when no app asked', () => {
    setupStarted('start', null).finished()

    for (const event of sent(SETUP_EVENT)) expect(event).not.toHaveProperty('app_id')
  })

  it.each(['denied', 'undecided'] as const)('sends nothing while consent is %s', (consent) => {
    telemetry.setConsentState(consent)
    setupStarted('start', APP).finished()

    expect(sent(SETUP_EVENT)).toEqual([])
  })
})

describe('which app a build is busy with', () => {
  beforeEach(() => _resetForTest())

  it('names the app of the oldest run on the build, and nothing once its runs end', () => {
    runAccepted('run-1', 'inst-1', 'remove-background', 1)
    runAccepted('run-2', 'inst-1', 'sdr-to-hdr', 2)

    expect(busyAppOn('inst-1')).toBe('remove-background')
    expect(busyAppOn('inst-2')).toBeNull()

    finishRun('run-1', { outcome: 'success', at: 3 })
    expect(busyAppOn('inst-1')).toBe('sdr-to-hdr')
    finishRun('run-2', { outcome: 'success', at: 4 })
    expect(busyAppOn('inst-1')).toBeNull()
  })

  it('names the app whose run is working, never the app that asks', () => {
    runAccepted('run-ads', 'inst-1', 'product-ads', 1)
    runAccepted('run-swap', 'inst-1', 'product-swap', 2)
    noteRunMessage(message('execution_start', { timestamp: 3 }, 'run-swap'))

    expect(busyAppOn('inst-1', 'remove-background')).toBe('product-swap')
    expect(busyAppOn('inst-1', 'product-ads')).toBe('product-swap')
    expect(busyAppOn('inst-1', 'product-swap')).toBeNull()
  })

  it('names the oldest queued run ahead of the asking app when none is working yet', () => {
    runAccepted('run-ads', 'inst-1', 'product-ads', 1)
    runAccepted('run-swap', 'inst-1', 'product-swap', 2)
    runAccepted('run-cutout', 'inst-1', 'remove-background', 3)

    expect(busyAppOn('inst-1', 'product-ads')).toBeNull()
    expect(busyAppOn('inst-1', 'product-swap')).toBe('product-ads')
    expect(busyAppOn('inst-1', 'remove-background')).toBe('product-ads')
    expect(busyAppOn('inst-1', 'upscale')).toBe('product-ads')
  })

  it('never names an app queued behind the asking app, even while a run from elsewhere holds the build', () => {
    runAccepted('run-cutout', 'inst-1', 'remove-background', 1)
    runAccepted('run-swap', 'inst-1', 'product-swap', 2)

    expect(busyAppOn('inst-1', 'remove-background')).toBeNull()
    expect(busyAppOn('inst-1', 'product-swap')).toBe('remove-background')
  })

  it("follows ComfyUI's queue numbers, not send times, including runs sent at the same moment", () => {
    runAccepted('run-cutout', 'inst-1', 'remove-background', 1, 11)
    runAccepted('run-swap', 'inst-1', 'product-swap', 2, 10)
    runAccepted('run-ads', 'inst-1', 'product-ads', 2, 12)

    expect(busyAppOn('inst-1', 'product-swap')).toBeNull()
    expect(busyAppOn('inst-1', 'remove-background')).toBe('product-swap')
    expect(busyAppOn('inst-1', 'product-ads')).toBe('product-swap')
    expect(busyAppOn('inst-1')).toBe('product-swap')
  })

  it('keeps the order runs were accepted in when they were sent at the same moment with no queue number', () => {
    runAccepted('run-ads', 'inst-1', 'product-ads', 5)
    runAccepted('run-swap', 'inst-1', 'product-swap', 5)

    expect(busyAppOn('inst-1', 'product-swap')).toBe('product-ads')
    expect(busyAppOn('inst-1', 'product-ads')).toBeNull()
  })

  it('names nothing for the app whose own run the build is working on', () => {
    runAccepted('run-cutout', 'inst-1', 'remove-background', 1)
    runAccepted('run-swap', 'inst-1', 'product-swap', 2)
    noteRunMessage(message('execution_start', { timestamp: 3 }, 'run-cutout'))

    expect(busyAppOn('inst-1', 'remove-background')).toBeNull()
    expect(busyAppOn('inst-1', 'product-swap')).toBe('remove-background')
  })

  it('names nothing when the only runs on the build are the asking app own', () => {
    runAccepted('run-1', 'inst-1', 'remove-background', 1)

    expect(busyAppOn('inst-1', 'remove-background')).toBeNull()
  })

  it('tells its watchers when the oldest run is dropped to keep the list short', () => {
    for (let index = 0; index < 200; index += 1)
      runAccepted(`run-${index}`, 'inst-1', 'product-ads', index)
    const watcher = vi.fn()
    onRunsChanged(watcher)

    runAccepted('run-200', 'inst-2', 'product-swap', 200)

    expect(isFollowing('run-0')).toBe(false)
    expect(watcher).toHaveBeenCalledTimes(1)
  })

  it('tells its watchers when a queued run starts working', () => {
    runAccepted('run-1', 'inst-1', 'product-ads', 1)
    const watcher = vi.fn()
    onRunsChanged(watcher)

    noteRunMessage(message('execution_start', { timestamp: 2 }, 'run-1'))
    noteRunMessage(message('execution_start', { timestamp: 3 }, 'run-1'))

    expect(watcher).toHaveBeenCalledTimes(1)
  })

  it('tells its watchers when a run starts or ends', () => {
    const watcher = vi.fn()
    const stop = onRunsChanged(watcher)

    runAccepted('run-1', 'inst-1', 'remove-background', 1)
    finishRun('run-1', { outcome: 'success', at: 2 })
    expect(watcher).toHaveBeenCalledTimes(2)

    stop()
    runAccepted('run-2', 'inst-1', 'remove-background', 3)
    expect(watcher).toHaveBeenCalledTimes(2)
  })
})

describe('run_finished and setup for an app with a page_test', () => {
  const KEY = 't2i-2026-12'

  beforeEach(allowTelemetry)

  function finishOneRun(appId: string | null): void {
    runAccepted(RUN, BUILD, appId, T0)
    noteRunMessage(message('execution_start', { timestamp: T0 }))
    noteRunMessage(message('execution_success', { timestamp: T0 + 1_000 }))
  }

  it("carry the card's id with the page_test key and the variant shown", () => {
    rememberPageTestGroup(APP, { key: KEY, variant: 'comfy', pageUrl: 'https://comfy.org/apps/x/' })

    finishOneRun(APP)
    setupStarted('start', APP).finished()

    const tags = { app_id: APP, page_test_key: KEY, page_test_variant: 'comfy' }
    expect(sent(RUN_FINISHED_EVENT)).toEqual([expect.objectContaining(tags)])
    expect(sent(SETUP_EVENT)).toEqual([
      expect.objectContaining({ ...tags, outcome: 'started' }),
      expect.objectContaining({ ...tags, outcome: 'finished' })
    ])
  })

  it("carry control for an install on the card's own page", () => {
    rememberPageTestGroup(APP, { key: KEY, variant: 'control', pageUrl: null })

    finishOneRun(APP)

    expect(sent(RUN_FINISHED_EVENT)).toEqual([
      expect.objectContaining({ app_id: APP, page_test_key: KEY, page_test_variant: 'control' })
    ])
  })

  it('carry no page_test properties for an app with no page_test, or a run no app asked for', () => {
    rememberPageTestGroup('other-app', { key: KEY, variant: 'comfy', pageUrl: null })

    finishOneRun(APP)
    setupStarted('start', null).finished()

    for (const event of [...sent(RUN_FINISHED_EVENT), ...sent(SETUP_EVENT)]) {
      expect(event).not.toHaveProperty('page_test_key')
      expect(event).not.toHaveProperty('page_test_variant')
    }
  })
})
