import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/userdata' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { sanitizeModelPath, resolveTemplateModelsFromJson } from './templateModels'

const model = (over: Record<string, unknown>) => ({
  name: 'm.safetensors',
  url: 'https://huggingface.co/x/m.safetensors',
  directory: 'checkpoints',
  ...over
})

describe('sanitizeModelPath', () => {
  it('accepts a clean relative dir + bare filename', () => {
    expect(sanitizeModelPath('checkpoints', 'm.safetensors')).toEqual({
      directory: 'checkpoints',
      filename: 'm.safetensors'
    })
  })

  it('normalizes backslashes and nested clean dirs', () => {
    expect(sanitizeModelPath('models\\loras', 'm.safetensors')).toEqual({
      directory: 'models/loras',
      filename: 'm.safetensors'
    })
  })

  it('rejects a traversing directory', () => {
    expect(sanitizeModelPath('../etc', 'm.safetensors')).toBeNull()
    expect(sanitizeModelPath('a/../../b', 'm.safetensors')).toBeNull()
    expect(sanitizeModelPath('..', 'm.safetensors')).toBeNull()
  })

  it('rejects an absolute directory', () => {
    expect(sanitizeModelPath('/abs', 'm.safetensors')).toBeNull()
  })

  it('rejects an empty or current (".") directory (would land in the models root)', () => {
    expect(sanitizeModelPath('', 'm.safetensors')).toBeNull()
    expect(sanitizeModelPath('.', 'm.safetensors')).toBeNull()
    expect(sanitizeModelPath('./', 'm.safetensors')).toBeNull()
  })

  it('rejects a filename with separators or traversal', () => {
    expect(sanitizeModelPath('checkpoints', '../m.safetensors')).toBeNull()
    expect(sanitizeModelPath('checkpoints', 'sub/m.safetensors')).toBeNull()
    expect(sanitizeModelPath('checkpoints', 'sub\\m.safetensors')).toBeNull()
  })

  it('strips query params from the filename', () => {
    expect(sanitizeModelPath('checkpoints', 'm.safetensors?token=abc')).toEqual({
      directory: 'checkpoints',
      filename: 'm.safetensors'
    })
  })
})

describe('resolveTemplateModelsFromJson — URL + path guards', () => {
  const resolveWith = (models: unknown[]) => resolveTemplateModelsFromJson({ models })

  it('accepts a whitelisted HTTPS model', () => {
    const out = resolveWith([model({})])
    expect(out).toEqual([
      { filename: 'm.safetensors', url: model({}).url, directory: 'checkpoints' }
    ])
  })

  it('rejects plain http:// (insecure transport)', () => {
    const out = resolveWith([model({ url: 'http://huggingface.co/x/m.safetensors' })])
    expect(out).toEqual([])
  })

  it('rejects a non-whitelisted host', () => {
    const out = resolveWith([model({ url: 'https://evil.example.com/m.safetensors' })])
    expect(out).toEqual([])
  })

  it('rejects a non-model extension', () => {
    const out = resolveWith([model({ url: 'https://huggingface.co/x/m.zip' })])
    expect(out).toEqual([])
  })

  it('drops an entry whose directory traverses out of the models dir', () => {
    const out = resolveWith([model({ directory: '../../etc' })])
    expect(out).toEqual([])
  })

  it('drops an entry whose filename carries a path separator', () => {
    const out = resolveWith([model({ name: 'sub/m.safetensors' })])
    expect(out).toEqual([])
  })
})
