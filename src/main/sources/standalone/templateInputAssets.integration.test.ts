// @vitest-environment node
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

const download = vi.fn(async (_url: string, destPath: string) => {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
  await fs.promises.writeFile(destPath, 'bytes')
})

vi.mock('../../lib/download', () => ({
  download: (...args: unknown[]) => download(...(args as [string, string]))
}))

const { downloadTemplateInputAssets, resolveTemplateInputAssetAvailability } =
  await import('./templateInputAssets')

const ASSET = 'subject.png'
const workflow = { nodes: [{ type: 'LoadImage', widgets_values: [ASSET] }] }

let installPath: string
const log = () => {}

function installation(): InstallationRecord {
  return { id: 'inst-test', installPath, useSharedInput: false } as InstallationRecord
}

function availability(name: string) {
  return resolveTemplateInputAssetAvailability(installation(), [name]).then(([entry]) => entry)
}

beforeEach(() => {
  download.mockClear()
  installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-input-contract-'))
})

afterEach(() => {
  fs.rmSync(installPath, { recursive: true, force: true })
})

describe('a downloaded template input asset', () => {
  it('lands where the availability reader looks for it', async () => {
    expect(await availability(ASSET)).toEqual({
      filename: ASSET,
      status: 'missing'
    })

    const placed = await downloadTemplateInputAssets(
      installation(),
      'template-a',
      log,
      undefined,
      workflow
    )

    expect(placed).toEqual([{ filename: ASSET, downloaded: true }])
    expect(await availability(ASSET)).toEqual({
      filename: ASSET,
      status: 'present'
    })
  })

  it('is not fetched again when it is already there', async () => {
    await downloadTemplateInputAssets(installation(), 'template-a', log, undefined, workflow)
    download.mockClear()

    const placed = await downloadTemplateInputAssets(
      installation(),
      'template-a',
      log,
      undefined,
      workflow
    )

    expect(placed).toEqual([{ filename: ASSET, downloaded: false }])
    expect(download).not.toHaveBeenCalled()
  })

  it('answers nothing for a name that escapes the input directory', async () => {
    await expect(
      resolveTemplateInputAssetAvailability(installation(), [
        '../escaped.png',
        'nested/subject.png'
      ])
    ).resolves.toEqual([])
  })
})
