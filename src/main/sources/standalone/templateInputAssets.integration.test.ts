// @vitest-environment node
// The unit tests inject `access`; this one uses a real directory, so the writer
// and the reader have to agree on a path.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallationRecord } from '../../installations'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  }
}))

const { resolveInputDir, resolveTemplateInputAssetAvailability } =
  await import('./templateInputAssets')

let installPath: string

function installation(): InstallationRecord {
  // Without `useSharedInput: false` the lookup escapes to the user's own
  // configured input directory.
  return {
    id: 'inst-test',
    installPath,
    useSharedInput: false
  } as InstallationRecord
}

beforeEach(() => {
  installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-input-contract-'))
  fs.mkdirSync(path.join(installPath, 'ComfyUI', 'input'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(installPath, { recursive: true, force: true })
})

describe('template input availability against a real input directory', () => {
  it('sees a file written where a download would put it', async () => {
    const inputDir = resolveInputDir(installation())
    const [before] = await resolveTemplateInputAssetAvailability(installation(), ['subject.png'])
    expect(before).toEqual({ filename: 'subject.png', status: 'missing' })

    fs.writeFileSync(path.join(inputDir, 'subject.png'), 'bytes')

    const [after] = await resolveTemplateInputAssetAvailability(installation(), ['subject.png'])
    expect(after).toEqual({ filename: 'subject.png', status: 'present' })
  })

  it('does not count a file that landed outside the input directory', async () => {
    fs.writeFileSync(path.join(installPath, 'subject.png'), 'bytes')

    const [availability] = await resolveTemplateInputAssetAvailability(installation(), [
      'subject.png'
    ])
    expect(availability).toEqual({ filename: 'subject.png', status: 'missing' })
  })

  it('answers nothing for a name that escapes the input directory', async () => {
    const outside = path.join(installPath, 'escaped.png')
    fs.writeFileSync(outside, 'bytes')

    await expect(
      resolveTemplateInputAssetAvailability(installation(), [
        '../escaped.png',
        'nested/subject.png'
      ])
    ).resolves.toEqual([])
  })
})
