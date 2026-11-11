import { describe, expect, it, vi } from 'vitest'
import { templateSearchBackendFor } from './backend'
import { fakeDecision } from './fakeBackend'
import type { FetchLike } from './types'

const fetch = vi.fn<FetchLike>(async () => new Response('{}'))

describe('templateSearchBackendFor', () => {
  it.each([undefined, '', '   ', 'fake', 'ftp://decisions.example.test', 'nonsense'])(
    'answers from the fake without the network for %j',
    async (setting) => {
      const backend = templateSearchBackendFor(setting, fetch)
      await expect(backend.search('a poster for a bake sale')).resolves.toMatchObject({
        outcome: 'template'
      })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('asks the decision service at an http address', async () => {
    const backend = templateSearchBackendFor('http://127.0.0.1:8000', fetch)
    await backend.search('a poster').catch(() => undefined)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/api/decide', expect.anything())
  })
})

describe('fakeDecision', () => {
  it.each([
    ['a poster for a bake sale', 'template', 'image_z_image_turbo'],
    ['a short clip of waves at night', 'template', 'video_minimax_h3_t2v'],
    ['a jingle for a lemonade stand', 'template', 'audio_ace_step_1_5_checkpoint'],
    [
      'remove the background from this photo',
      'template',
      'api_bytedance_seedream_5_0_pro_image_edit'
    ]
  ])('sends %j to a template', (query, outcome, templateId) => {
    const result = fakeDecision(query)
    expect(result.outcome).toBe(outcome)
    expect(result.run[0]?.templateId).toBe(templateId)
  })

  it('marks the partner template it suggests', () => {
    expect(fakeDecision('remove the background from this photo').run[0]?.partner).toBe(true)
  })

  it('sends a question to the agent', () => {
    expect(fakeDecision('how do I train a lora?').outcome).toBe('agent')
  })

  it('answers input with no words with a reply instead of templates', () => {
    const result = fakeDecision('?!')
    expect(result.outcome).toBe('bad_input')
    expect(result.reply).toBeTruthy()
    expect(result.run).toEqual([])
  })
})
