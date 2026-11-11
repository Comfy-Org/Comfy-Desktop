import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

function flagResult(value: unknown): unknown {
  return { kind: 'value', value, payload: undefined }
}

function unreachable(): unknown {
  return { kind: 'unreachable' }
}

import {
  initAgentChatRedesignFlag,
  isAgentChatRedesignEnabled,
  AGENT_CHAT_REDESIGN_FLAG_KEY,
  _resetForTest
} from './agentChatRedesignFlag'

async function resolveWithResult(result: unknown): Promise<boolean> {
  getOpsFlagResult.mockResolvedValue(result)
  await initAgentChatRedesignFlag({ distinctId: 'anon' })
  return isAgentChatRedesignEnabled()
}

async function resolveWith(value: unknown): Promise<boolean> {
  return resolveWithResult(flagResult(value))
}

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
})

describe('agentChatRedesignFlag', () => {
  it('reads the desktop ops flag without a persist callback', async () => {
    expect(AGENT_CHAT_REDESIGN_FLAG_KEY).toBe('desktop_agent_chat_redesign')
    await resolveWith('on')
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      AGENT_CHAT_REDESIGN_FLAG_KEY,
      'anon',
      expect.any(Number),
      undefined
    )
  })

  it.each([['on'], [true]])('%s grants the redesign', async (value) => {
    expect(await resolveWith(value)).toBe(true)
  })

  it.each([['off'], [false], ['garbage'], ['treatment']])(
    'keeps the redesign off for %s',
    async (value) => {
      expect(await resolveWith(value)).toBe(false)
    }
  )

  it('keeps the redesign off when the flag is unreachable', async () => {
    expect(await resolveWithResult(unreachable())).toBe(false)
  })

  it('keeps the redesign off when the fetch rejects', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await initAgentChatRedesignFlag({ distinctId: 'anon' })
    expect(await isAgentChatRedesignEnabled()).toBe(false)
  })

  it('awaits the in-flight boot fetch rather than returning the default', async () => {
    let release: (v: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void initAgentChatRedesignFlag({ distinctId: 'anon' })
    const pending = isAgentChatRedesignEnabled()
    release(flagResult('on'))
    expect(await pending).toBe(true)
  })

  it('fetches once however many callers init', async () => {
    getOpsFlagResult.mockResolvedValue(flagResult('on'))
    await Promise.all([
      initAgentChatRedesignFlag({ distinctId: 'anon' }),
      initAgentChatRedesignFlag({ distinctId: 'anon' })
    ])
    expect(getOpsFlagResult).toHaveBeenCalledTimes(1)
  })
})
