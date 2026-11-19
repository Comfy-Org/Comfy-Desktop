import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../installations', () => ({ get: vi.fn() }))
vi.mock('../lib/outputFolders', () => ({ comfyOutputPath: vi.fn() }))
vi.mock('./localComfy', () => ({ pageBuildId: vi.fn(() => 'apps-build') }))

import type { WebContents } from 'electron'
import * as installations from '../installations'
import { findInPageBuild, locateOutputFiles } from './outputFiles'
import type { FindOutputFile } from './outputFiles'
import type { RequestedOutput } from './outputRequest'

const FOUND = path.join(path.sep, 'outputs', 'apps', 'cutout_00001_.png')

function output(extra: Partial<RequestedOutput> = {}): RequestedOutput {
  return {
    name: 'cutout.png',
    mimeType: 'image/png',
    bytes: new Uint8Array([1]),
    tags: [],
    workflow: false,
    ...extra
  }
}

const cutoutFile = { filename: 'cutout_00001_.png', subfolder: 'apps' }

describe('locateOutputFiles', () => {
  it('shows the folder of a ComfyUI file Desktop found, and never sends the reference on', async () => {
    const find = vi.fn<FindOutputFile>(async () => FOUND)

    const located = await locateOutputFiles(
      { items: [output({ savedOn: 'computer', comfyFile: cutoutFile })], index: 0 },
      find
    )

    expect(find).toHaveBeenCalledExactlyOnceWith(cutoutFile, new Uint8Array([1]))
    expect(located.outputs.items[0]).toEqual(
      output({ savedOn: 'computer', folder: path.dirname(FOUND) })
    )
    expect(located.files).toEqual([FOUND])
  })

  it('shows no folder for a ComfyUI file Desktop did not find, even one the page sent', async () => {
    const located = await locateOutputFiles(
      {
        items: [
          output({ savedOn: 'computer', comfyFile: cutoutFile, folder: '/Users/me/out' }),
          output({ savedOn: 'computer', comfyFile: cutoutFile })
        ],
        index: 1
      },
      vi.fn<FindOutputFile>().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('gone'))
    )

    expect(located.outputs).toEqual({
      items: [output({ savedOn: 'computer' }), output({ savedOn: 'computer' })],
      index: 1
    })
    expect(located.files).toEqual([null, null])
  })

  it('keeps the folder a page saved an output in, and looks for nothing without a ComfyUI file', async () => {
    const find = vi.fn<FindOutputFile>()

    const located = await locateOutputFiles(
      {
        items: [
          output({ savedOn: 'computer', folder: '/Users/me/out' }),
          output({ savedOn: 'cloud' }),
          output()
        ],
        index: 0
      },
      find
    )

    expect(find).not.toHaveBeenCalled()
    expect(located.outputs.items).toEqual([
      output({ savedOn: 'computer', folder: '/Users/me/out' }),
      output({ savedOn: 'cloud' }),
      output()
    ])
    expect(located.files).toEqual([null, null, null])
  })

  it('looks for at most four files at once', async () => {
    let looking = 0
    let most = 0
    const find = vi.fn<FindOutputFile>(async () => {
      looking += 1
      most = Math.max(most, looking)
      await new Promise((resolve) => setTimeout(resolve, 1))
      looking -= 1
      return null
    })
    const items = Array.from({ length: 10 }, () =>
      output({ savedOn: 'computer', comfyFile: cutoutFile })
    )

    await locateOutputFiles({ items, index: 0 }, find)

    expect(find).toHaveBeenCalledTimes(10)
    expect(most).toBe(4)
  })
})

describe('findInPageBuild', () => {
  it('finds nothing when the build cannot be read', async () => {
    vi.mocked(installations.get).mockRejectedValueOnce(new Error('unreadable'))

    const find = await findInPageBuild({} as WebContents)

    expect(await find(cutoutFile, new Uint8Array([1]))).toBeNull()
  })
})
