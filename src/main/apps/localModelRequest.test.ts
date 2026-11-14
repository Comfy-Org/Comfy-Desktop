import { describe, expect, it } from 'vitest'

import { readModelRequest } from './localModelRequest'

const BIREFNET = {
  url: 'https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors',
  folder: 'background_removal',
  name: 'birefnet.safetensors'
}

describe('a model an app page may ask Desktop to download', () => {
  it('is a safetensors file on Hugging Face, saved under its own name in a models folder', () => {
    expect(readModelRequest(BIREFNET)).toEqual(BIREFNET)
    expect(
      readModelRequest({
        url: 'https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors?download=true',
        folder: 'text_encoders',
        name: 'qwen3vl_8b_int8_convrot.safetensors'
      })
    ).toMatchObject({ folder: 'text_encoders', name: 'qwen3vl_8b_int8_convrot.safetensors' })
  })

  it.each([
    [
      'another host',
      { url: BIREFNET.url.replace('huggingface.co', 'huggingface.co.evil.example') }
    ],
    [
      'a look-alike host',
      { url: BIREFNET.url.replace('huggingface.co', 'evil.example/huggingface.co') }
    ],
    ['plain http', { url: BIREFNET.url.replace('https:', 'http:') }],
    ['a file on this computer', { url: 'file:///models/birefnet.safetensors' }],
    ['sign-in details in the address', { url: BIREFNET.url.replace('https://', 'https://me:pw@') }],
    ['another port', { url: BIREFNET.url.replace('huggingface.co', 'huggingface.co:8443') }],
    ['a page that is not a file', { url: 'https://huggingface.co/Comfy-Org/birefnet.safetensors' }],
    ['an address that is not one', { url: 'birefnet.safetensors' }]
  ])('refuses %s', (_what, change) => {
    expect(readModelRequest({ ...BIREFNET, ...change })).toBeNull()
  })

  it.each([
    'birefnet.ckpt',
    'birefnet.pt',
    'birefnet.safetensors.py',
    'run.py',
    '../birefnet.safetensors',
    'sub/birefnet.safetensors',
    '.safetensors',
    'bire fnet.safetensors'
  ])('refuses to save it as %s', (name) => {
    expect(
      readModelRequest({ ...BIREFNET, name, url: BIREFNET.url.replace(BIREFNET.name, name) })
    ).toBeNull()
  })

  it('refuses a name that is not the file the address points at', () => {
    expect(readModelRequest({ ...BIREFNET, name: 'other.safetensors' })).toBeNull()
  })

  it.each(['', '..', '../custom_nodes', 'checkpoints/sub', '/abs', 'Check Points', 'custom-nodes'])(
    'refuses the folder %j',
    (folder) => {
      expect(readModelRequest({ ...BIREFNET, folder })).toBeNull()
    }
  )

  it.each([null, undefined, 'birefnet', 7, {}, { url: 7, folder: 'vae', name: 'a.safetensors' }])(
    'refuses the malformed request %j',
    (raw) => {
      expect(readModelRequest(raw)).toBeNull()
    }
  )
})
