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
import {
  _resetForTest,
  buildsWithRuns,
  COMFYUI_EXITED,
  errorClassOf,
  failRunsOn,
  finishRun,
  isFollowing,
  noteRunMessage,
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
    failRunsOn(BUILD, COMFYUI_EXITED)

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

    failRunsOn(BUILD, COMFYUI_EXITED, T0 + 9_000)

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

    failRunsOn(BUILD, COMFYUI_EXITED)

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

    settleRun(RUN, fromHistory, { outcome: 'failed', errorClass: COMFYUI_EXITED, at: T0 + 30_000 })

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
