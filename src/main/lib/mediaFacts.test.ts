import { describe, expect, it } from 'vitest'

import { mediaFactsFromBytes } from './mediaFacts'

function wavHeader(seconds: number, sampleRate = 8000): Uint8Array {
  const dataBytes = seconds * sampleRate
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(1024)]))
}

describe('mediaFactsFromBytes', () => {
  it('reads how long a sound runs from the start of its file', async () => {
    const facts = await mediaFactsFromBytes(wavHeader(60), 'audio', 'audio/wav', 44 + 60 * 8000)

    expect(facts).toEqual({ width: null, height: null, durationSeconds: 60 })
  })

  it('reads nothing for a 3D file', async () => {
    const facts = await mediaFactsFromBytes(wavHeader(60), '3d', null)

    expect(facts.durationSeconds).toBeNull()
  })
})
