import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculatePerformanceTestStatistics,
  deletePerformanceTestWorkflow,
  incrementWorkflowSeeds,
  savePerformanceTestJobsResponse,
  savePerformanceTestResultsSummary,
  storePerformanceTestWorkflow,
  submitPerformanceTestWorkflow,
  waitForPerformanceTestJobs
} from './performanceTestWorkflows'

describe('calculatePerformanceTestStatistics', () => {
  it('calculates fastest, slowest, average, and median for measured jobs only', () => {
    const response = {
      jobs: [
        {
          id: 'measured-3',
          status: 'completed',
          execution_start_time: 30000,
          execution_end_time: 39000
        },
        {
          id: 'warmup',
          status: 'completed',
          execution_start_time: 0,
          execution_end_time: 100000
        },
        {
          id: 'measured-1',
          status: 'completed',
          execution_start_time: 10000,
          execution_end_time: 12000
        },
        {
          id: 'measured-4',
          status: 'completed',
          execution_start_time: 40000,
          execution_end_time: 44000
        },
        {
          id: 'measured-2',
          status: 'completed',
          execution_start_time: 20000,
          execution_end_time: 26000
        }
      ]
    }

    expect(
      calculatePerformanceTestStatistics(response, [
        'measured-1',
        'measured-2',
        'measured-3',
        'measured-4'
      ])
    ).toEqual({
      fastest: { jobId: 'measured-1', durationSeconds: 2 },
      slowest: { jobId: 'measured-3', durationSeconds: 9 },
      averageDurationSeconds: 5.25,
      medianDurationSeconds: 5,
      measuredJobCount: 4
    })
  })

  it('ignores jobs without valid timestamps and returns null when none are measurable', () => {
    expect(
      calculatePerformanceTestStatistics(
        {
          jobs: [
            { id: 'missing-end', status: 'failed', execution_start_time: 10 },
            {
              id: 'backwards',
              status: 'completed',
              execution_start_time: 10,
              execution_end_time: 5
            }
          ]
        },
        ['missing-end', 'backwards']
      )
    ).toBeNull()
  })
})

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfy-performance-test-workflow-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) =>
        fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
      )
  )
})

describe('storePerformanceTestWorkflow', () => {
  it('copies an API-format workflow into the app user-data directory', async () => {
    const root = await makeTempDir()
    const sourcePath = path.join(root, 'performanceTest.json')
    const contents = JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    await fs.promises.writeFile(sourcePath, contents)

    const storedPath = await storePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))

    expect(path.dirname(path.dirname(storedPath))).toBe(
      path.join(root, 'user-data', 'performance-tests')
    )
    expect(path.basename(path.dirname(storedPath))).toMatch(/^\d{14}$/)
    expect(path.basename(storedPath)).toBe('performanceTest.json')
    expect(await fs.promises.readFile(storedPath, 'utf8')).toBe(contents)
    expect(await fs.promises.readFile(sourcePath, 'utf8')).toBe(contents)
  })

  it('creates a unique timestamped session directory for each workflow', async () => {
    const root = await makeTempDir()
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )

    const firstPath = await storePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))
    const secondPath = await storePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))

    expect(path.basename(secondPath)).toBe('performanceTest.json')
    expect(path.basename(path.dirname(secondPath))).toMatch(/^\d{14}$/)
    expect(path.dirname(secondPath)).not.toBe(path.dirname(firstPath))
  })

  it.each(['results.json', 'results_summary.json'])(
    'reserves %s for performance test output',
    async (name) => {
      const root = await makeTempDir()
      const sourcePath = path.join(root, name)
      await fs.promises.writeFile(
        sourcePath,
        JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
      )

      await expect(
        storePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))
      ).rejects.toThrow(`${name} is reserved`)
    }
  )

  it('rejects JSON that is not a ComfyUI API-format workflow', async () => {
    const root = await makeTempDir()
    const sourcePath = path.join(root, 'editor-workflow.json')
    await fs.promises.writeFile(sourcePath, JSON.stringify({ nodes: [], links: [] }))

    await expect(
      storePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))
    ).rejects.toThrow('not a ComfyUI API-format workflow')
  })
})

describe('deletePerformanceTestWorkflow', () => {
  it('deletes a managed performance test workflow copy', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)

    await deletePerformanceTestWorkflow(storedPath, userDataPath)

    await expect(fs.promises.stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to delete files outside the managed directory', async () => {
    const root = await makeTempDir()
    const sourcePath = path.join(root, 'keep.json')
    await fs.promises.writeFile(sourcePath, '{}')

    await expect(
      deletePerformanceTestWorkflow(sourcePath, path.join(root, 'user-data'))
    ).rejects.toThrow('outside a managed performance test session directory')
    expect(await fs.promises.readFile(sourcePath, 'utf8')).toBe('{}')
  })

  it('preserves a completed session when clearing its workflow from the page', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
    const resultsPath = path.join(path.dirname(storedPath), 'results.json')
    await fs.promises.writeFile(resultsPath, '{}')

    await deletePerformanceTestWorkflow(storedPath, userDataPath)

    await expect(fs.promises.stat(storedPath)).resolves.toBeDefined()
    await expect(fs.promises.stat(resultsPath)).resolves.toBeDefined()
  })
})

describe('submitPerformanceTestWorkflow', () => {
  it('posts model-load and warm-up requests before the measured runs with incremented seeds', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    const workflow = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }
    await fs.promises.writeFile(sourcePath, JSON.stringify(workflow))
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
    let requestCount = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requestCount++
      return new Response(JSON.stringify({ prompt_id: `prompt-${requestCount}` }))
    })

    const promptIds = await submitPerformanceTestWorkflow(
      storedPath,
      userDataPath,
      'http://127.0.0.1:8189/base',
      3,
      2,
      fetchMock
    )

    expect(promptIds).toEqual([
      'prompt-1',
      'prompt-2',
      'prompt-3',
      'prompt-4',
      'prompt-5',
      'prompt-6'
    ])
    expect(fetchMock).toHaveBeenCalledTimes(6)
    for (const [index, [requestUrl, requestInit]] of fetchMock.mock.calls.entries()) {
      expect(String(requestUrl)).toBe('http://127.0.0.1:8189/prompt')
      expect(requestInit).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      expect(JSON.parse(String(requestInit?.body))).toEqual({
        prompt: { '1': { class_type: 'KSampler', inputs: { seed: index + 2 } } }
      })
    }
    expect(JSON.parse(await fs.promises.readFile(storedPath, 'utf8'))).toEqual(workflow)
  })

  it('stops submitting when ComfyUI rejects a request', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: 'prompt-1' })))
      .mockResolvedValueOnce(new Response('invalid workflow', { status: 400 }))

    await expect(
      submitPerformanceTestWorkflow(
        storedPath,
        userDataPath,
        'http://127.0.0.1:8189',
        3,
        1,
        fetchMock
      )
    ).rejects.toThrow('Performance Test request 2 failed: 400')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a successful response without a prompt ID', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'))

    await expect(
      submitPerformanceTestWorkflow(
        storedPath,
        userDataPath,
        'http://127.0.0.1:8189',
        1,
        1,
        fetchMock
      )
    ).rejects.toThrow('did not return a prompt ID')
  })
})

describe('waitForPerformanceTestJobs', () => {
  it('polls the jobs collection until every submitted prompt is terminal', async () => {
    const pendingResponse = {
      jobs: [
        { id: 'warmup-1', status: 'completed' },
        { id: 'measured-1', status: 'completed' },
        { id: 'measured-2', status: 'in_progress' },
        { id: 'unrelated', status: 'pending' }
      ]
    }
    const terminalResponse = {
      jobs: [
        { id: 'warmup-1', status: 'completed' },
        { id: 'measured-1', status: 'completed' },
        { id: 'measured-2', status: 'failed', execution_error: { message: 'failed' } }
      ],
      pagination: { total: 3, has_more: false }
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(pendingResponse)))
      .mockResolvedValueOnce(new Response(JSON.stringify(terminalResponse)))

    await expect(
      waitForPerformanceTestJobs(
        'http://127.0.0.1:8189/base',
        ['warmup-1', 'measured-1', 'measured-2'],
        fetchMock,
        0
      )
    ).resolves.toEqual(terminalResponse)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://127.0.0.1:8189/api/jobs?limit=3')
  })
})

describe('savePerformanceTestJobsResponse', () => {
  it('writes the final jobs response beside the session workflow', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
    const response = { jobs: [{ id: 'prompt-1', status: 'completed' }] }

    const resultPath = await savePerformanceTestJobsResponse(response, storedPath, userDataPath)

    expect(resultPath).toBe(path.join(path.dirname(storedPath), 'results.json'))
    expect(JSON.parse(await fs.promises.readFile(resultPath, 'utf8'))).toEqual(response)
  })
})

describe('savePerformanceTestResultsSummary', () => {
  it('writes duration aggregates and compact hardware info beside the raw results', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)

    const hardware = {
      deviceType: 'cuda',
      deviceIndex: 0,
      deviceName: 'NVIDIA GeForce RTX 4090',
      backend: 'native',
      devices: [],
      vramMb: 24576,
      ramMb: 65536,
      pytorchVersion: '2.10.0+cu130',
      xformersVersion: '0.0.31',
      cudaDeviceSet: 0
    }
    const summaryPath = await savePerformanceTestResultsSummary(
      {
        fastest: { jobId: 'job-1', durationSeconds: 1.25 },
        slowest: { jobId: 'job-2', durationSeconds: 2.75 },
        averageDurationSeconds: 2,
        medianDurationSeconds: 1.875,
        measuredJobCount: 2
      },
      { id: 'local-instance', name: 'Local Instance' },
      { id: 'workspace-2', name: 'Workspace Two' },
      hardware,
      storedPath,
      userDataPath
    )

    expect(summaryPath).toBe(path.join(path.dirname(storedPath), 'results_summary.json'))
    expect(JSON.parse(await fs.promises.readFile(summaryPath, 'utf8'))).toEqual({
      instance: { id: 'local-instance', name: 'Local Instance' },
      workspace: { id: 'workspace-2', name: 'Workspace Two' },
      workflowName: 'performanceTest.json',
      fastestJobDurationSeconds: 1.25,
      slowestJobDurationSeconds: 2.75,
      averageJobDurationSeconds: 2,
      medianJobDurationSeconds: 1.875,
      measuredJobCount: 2,
      hardware
    })
  })
})

describe('incrementWorkflowSeeds', () => {
  it('increments all numeric seed-like inputs without mutating the source workflow', () => {
    const workflow = {
      sampler: {
        class_type: 'KSampler',
        inputs: { seed: 10, noise_seed: 20, seed_mode: 'fixed', cfg: 7 }
      },
      linked: { class_type: 'Sampler', inputs: { seed: ['primitive', 0] } }
    }

    expect(incrementWorkflowSeeds(workflow)).toEqual({
      sampler: {
        class_type: 'KSampler',
        inputs: { seed: 11, noise_seed: 21, seed_mode: 'fixed', cfg: 7 }
      },
      linked: { class_type: 'Sampler', inputs: { seed: ['primitive', 0] } }
    })
    expect(workflow.sampler.inputs.seed).toBe(10)
    expect(workflow.sampler.inputs.noise_seed).toBe(20)
  })
})
