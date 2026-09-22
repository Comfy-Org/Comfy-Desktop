import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculatePerformanceTestStatistics,
  deletePerformanceTestBenchmark,
  deletePerformanceTestWorkflow,
  incrementWorkflowSeeds,
  listPerformanceTestBenchmarks,
  renamePerformanceTestBenchmark,
  readPerformanceTestResultsSummary,
  savePerformanceTestJobsResponse,
  savePerformanceTestLogs,
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
        },
        {
          id: 'measured-failed',
          status: 'failed',
          execution_start_time: 50000,
          execution_end_time: 150000
        }
      ]
    }

    expect(
      calculatePerformanceTestStatistics(response, [
        'measured-1',
        'measured-2',
        'measured-3',
        'measured-4',
        'measured-failed'
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

function benchmarkSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instance: { id: 'instance-1', name: 'Comfy' },
    workspace: { id: null, name: null },
    workflowName: 'workflow.json',
    fastestJobDurationSeconds: 1,
    slowestJobDurationSeconds: 2,
    averageJobDurationSeconds: 1.5,
    medianJobDurationSeconds: 1.5,
    measuredJobCount: 2,
    ...overrides
  }
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

describe('listPerformanceTestBenchmarks', () => {
  it('returns valid summaries newest first and ignores incomplete or malformed sessions', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const testsPath = path.join(userDataPath, 'performance-tests')
    const validSummary = {
      instance: { id: 'instance-1', name: 'Comfy One' },
      workspace: { id: 'workspace-1', name: 'Design' },
      workflowName: 'portrait.json',
      fastestJobDurationSeconds: 1.25,
      slowestJobDurationSeconds: 3.5,
      averageJobDurationSeconds: 2.125,
      medianJobDurationSeconds: 2,
      measuredJobCount: 5,
      hardware: { deviceName: 'NVIDIA RTX 4090' },
      customMetric: 42
    }
    await Promise.all(
      ['original-session', 'renamed session', 'malformed-session', 'incomplete-session'].map((id) =>
        fs.promises.mkdir(path.join(testsPath, id), { recursive: true })
      )
    )
    await fs.promises.writeFile(
      path.join(testsPath, 'original-session', 'results.json'),
      JSON.stringify(validSummary)
    )
    await fs.promises.writeFile(
      path.join(testsPath, 'renamed session', 'results.json'),
      JSON.stringify({
        ...validSummary,
        createdAt: '2026-09-13T15:30:45.000Z',
        instance: { id: 'instance-2', name: 'Comfy Two' },
        workspace: { id: null, name: null },
        workflowName: 'product.json',
        hardware: { deviceType: 'mps' }
      })
    )
    await fs.promises.writeFile(
      path.join(testsPath, 'malformed-session', 'results.json'),
      '{ malformed'
    )

    const benchmarks = await listPerformanceTestBenchmarks(testsPath)

    expect(benchmarks.map((benchmark) => benchmark.id)).toEqual([
      'renamed session',
      'original-session'
    ])
    expect(benchmarks[0]).toEqual({
      id: 'renamed session',
      createdAt: '2026-09-13T15:30:45.000Z',
      instance: { id: 'instance-2', name: 'Comfy Two' },
      workspace: { id: null, name: null },
      workflowName: 'product.json',
      fastestJobDurationSeconds: 1.25,
      slowestJobDurationSeconds: 3.5,
      averageJobDurationSeconds: 2.125,
      medianJobDurationSeconds: 2,
      measuredJobCount: 5,
      hardwareName: 'mps',
      result: {
        ...validSummary,
        createdAt: '2026-09-13T15:30:45.000Z',
        instance: { id: 'instance-2', name: 'Comfy Two' },
        workspace: { id: null, name: null },
        workflowName: 'product.json',
        hardware: { deviceType: 'mps' }
      }
    })
    expect(benchmarks[1]!.createdAt).toBeNull()
  })

  it('returns an empty list before any performance tests have been saved', async () => {
    const root = await makeTempDir()

    await expect(
      listPerformanceTestBenchmarks(path.join(root, 'user-data', 'performance-tests'))
    ).resolves.toEqual([])
  })
})

describe('deletePerformanceTestBenchmark', () => {
  it('deletes the complete validated session directory without allowing path traversal', async () => {
    const root = await makeTempDir()
    const testsPath = path.join(root, 'performance-tests')
    const sessionPath = path.join(testsPath, 'session-1')
    const siblingPath = path.join(root, 'keep-me')
    await fs.promises.mkdir(sessionPath, { recursive: true })
    await fs.promises.mkdir(siblingPath)
    await fs.promises.writeFile(path.join(sessionPath, 'workflow.json'), '{}')
    await fs.promises.writeFile(path.join(sessionPath, 'jobs.json'), '{}')
    await fs.promises.writeFile(
      path.join(sessionPath, 'results.json'),
      JSON.stringify(benchmarkSummary())
    )

    await expect(deletePerformanceTestBenchmark(testsPath, '../keep-me')).rejects.toThrow(
      'Invalid performance test benchmark ID.'
    )
    await expect(deletePerformanceTestBenchmark(testsPath, '.')).rejects.toThrow(
      'Invalid performance test benchmark ID.'
    )
    await expect(deletePerformanceTestBenchmark(testsPath, '..')).rejects.toThrow(
      'Invalid performance test benchmark ID.'
    )
    await expect(fs.promises.stat(siblingPath)).resolves.toBeDefined()

    await deletePerformanceTestBenchmark(testsPath, 'session-1')
    await expect(fs.promises.stat(sessionPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('renamePerformanceTestBenchmark', () => {
  it('renames the complete validated session directory', async () => {
    const root = await makeTempDir()
    const testsPath = path.join(root, 'performance-tests')
    const sessionPath = path.join(testsPath, 'session-1')
    const renamedPath = path.join(testsPath, 'my-session')
    await fs.promises.mkdir(sessionPath, { recursive: true })
    await fs.promises.writeFile(path.join(sessionPath, 'workflow.json'), '{}')
    await fs.promises.writeFile(
      path.join(sessionPath, 'results.json'),
      JSON.stringify(benchmarkSummary())
    )

    await renamePerformanceTestBenchmark(testsPath, 'session-1', 'my-session')

    await expect(fs.promises.stat(sessionPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      fs.promises.readFile(path.join(renamedPath, 'workflow.json'), 'utf8')
    ).resolves.toBe('{}')
    await expect(listPerformanceTestBenchmarks(testsPath)).resolves.toMatchObject([
      { id: 'my-session' }
    ])
  })

  it('rejects invalid or existing destination names', async () => {
    const root = await makeTempDir()
    const testsPath = path.join(root, 'performance-tests')
    const sessionPath = path.join(testsPath, 'session-1')
    await fs.promises.mkdir(sessionPath, { recursive: true })
    await fs.promises.mkdir(path.join(testsPath, 'existing'))
    await fs.promises.writeFile(
      path.join(sessionPath, 'results.json'),
      JSON.stringify(benchmarkSummary())
    )

    await expect(renamePerformanceTestBenchmark(testsPath, 'missing', 'missing')).rejects.toThrow()
    await expect(renamePerformanceTestBenchmark(testsPath, 'session-1', '..')).rejects.toThrow(
      'Invalid performance test benchmark ID.'
    )
    await expect(
      renamePerformanceTestBenchmark(testsPath, 'session-1', 'existing')
    ).rejects.toThrow('A benchmark session with that name already exists.')
    await expect(fs.promises.stat(sessionPath)).resolves.toBeDefined()
  })
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

  it.each(['jobs.json', 'results.json'])(
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

    await expect(deletePerformanceTestWorkflow(storedPath, userDataPath)).resolves.toBe('deleted')

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

  it.each(['jobs.json', 'results.json', 'logs.txt'])(
    'preserves a completed session with %s when clearing its workflow from the page',
    async (outputName) => {
      const root = await makeTempDir()
      const userDataPath = path.join(root, 'user-data')
      const sourcePath = path.join(root, 'performanceTest.json')
      await fs.promises.writeFile(
        sourcePath,
        JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
      )
      const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)
      const outputPath = path.join(path.dirname(storedPath), outputName)
      await fs.promises.writeFile(outputPath, '{}')

      await expect(deletePerformanceTestWorkflow(storedPath, userDataPath)).resolves.toBe(
        'preserved'
      )

      await expect(fs.promises.stat(storedPath)).resolves.toBeDefined()
      await expect(fs.promises.stat(outputPath)).resolves.toBeDefined()
    }
  )
})

describe('submitPerformanceTestWorkflow', () => {
  it('posts warm-up requests before the measured runs with incremented seeds', async () => {
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

    expect(promptIds).toEqual(['prompt-1', 'prompt-2', 'prompt-3', 'prompt-4', 'prompt-5'])
    expect(fetchMock).toHaveBeenCalledTimes(5)
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

    const acceptedPromptIds: string[] = []
    await expect(
      submitPerformanceTestWorkflow(
        storedPath,
        userDataPath,
        'http://127.0.0.1:8189',
        3,
        1,
        fetchMock,
        undefined,
        (promptId) => acceptedPromptIds.push(promptId)
      )
    ).rejects.toThrow('Performance Test request 2 failed: 400')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(acceptedPromptIds).toEqual(['prompt-1'])
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
      pagination: { total: 4, has_more: false }
    }
    const terminalApiResponse = {
      ...terminalResponse,
      jobs: [...terminalResponse.jobs, { id: 'unrelated', status: 'completed' }]
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(pendingResponse)))
      .mockResolvedValueOnce(new Response(JSON.stringify(terminalApiResponse)))
    const onProgress = vi.fn()

    await expect(
      waitForPerformanceTestJobs(
        'http://127.0.0.1:8189/base',
        ['warmup-1', 'measured-1', 'measured-2'],
        fetchMock,
        0,
        onProgress
      )
    ).resolves.toEqual(terminalResponse)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://127.0.0.1:8189/api/jobs?limit=3')
    expect(onProgress.mock.calls).toEqual([
      [2, 3],
      [3, 3]
    ])
  })

  it('stops an in-flight polling delay when cancelled', async () => {
    const abort = new AbortController()
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ jobs: [{ id: 'prompt-1', status: 'in_progress' }] }))
    )

    await expect(
      waitForPerformanceTestJobs(
        'http://127.0.0.1:8189',
        ['prompt-1'],
        fetchMock,
        60_000,
        () => abort.abort(),
        abort.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when the polling deadline has expired', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      waitForPerformanceTestJobs(
        'http://127.0.0.1:8189',
        ['prompt-1'],
        fetchMock,
        0,
        undefined,
        undefined,
        0
      )
    ).rejects.toThrow('Timed out waiting for performance test jobs')
    expect(fetchMock).not.toHaveBeenCalled()
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

    expect(resultPath).toBe(path.join(path.dirname(storedPath), 'jobs.json'))
    expect(JSON.parse(await fs.promises.readFile(resultPath, 'utf8'))).toEqual(response)
  })
})

describe('savePerformanceTestLogs', () => {
  it('writes the displayed instance logs beside the session workflow', async () => {
    const root = await makeTempDir()
    const userDataPath = path.join(root, 'user-data')
    const sourcePath = path.join(root, 'performanceTest.json')
    await fs.promises.writeFile(
      sourcePath,
      JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } })
    )
    const storedPath = await storePerformanceTestWorkflow(sourcePath, userDataPath)

    const logsPath = await savePerformanceTestLogs(
      'launching\ncompleted\n',
      storedPath,
      userDataPath
    )

    expect(logsPath).toBe(path.join(path.dirname(storedPath), 'logs.txt'))
    await expect(fs.promises.readFile(logsPath, 'utf8')).resolves.toBe('launching\ncompleted\n')
  })
})

describe('savePerformanceTestResultsSummary', () => {
  it('writes every value needed by the image export beside the raw results', async () => {
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
    const systemInfo = {
      cpu_model: 'AMD Ryzen 9 7950X',
      cpu_cores: 32,
      arch: 'x64',
      platform: 'win32',
      os_version: '10.0.26200',
      os_distro: 'Microsoft Windows 11 Pro',
      os_release: '10.0.26200'
    } as Parameters<typeof savePerformanceTestResultsSummary>[4]
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
      systemInfo,
      storedPath,
      userDataPath,
      2,
      1
    )

    expect(summaryPath).toBe(path.join(path.dirname(storedPath), 'results.json'))
    const savedSummary = JSON.parse(await fs.promises.readFile(summaryPath, 'utf8'))
    expect(savedSummary).toEqual({
      createdAt: expect.any(String),
      instance: { id: 'local-instance', name: 'Local Instance' },
      workspace: { id: 'workspace-2', name: 'Workspace Two' },
      workflowName: 'performanceTest.json',
      fastestJobDurationSeconds: 1.25,
      slowestJobDurationSeconds: 2.75,
      averageJobDurationSeconds: 2,
      medianJobDurationSeconds: 1.875,
      measuredJobCount: 2,
      failedRunCount: 1,
      hardware,
      systemInfo
    })
    expect(Number.isFinite(Date.parse(savedSummary.createdAt))).toBe(true)

    savedSummary.workflowName = 'renamed-after-test.json'
    await fs.promises.writeFile(summaryPath, JSON.stringify(savedSummary))
    await expect(readPerformanceTestResultsSummary(summaryPath, userDataPath)).resolves.toEqual(
      expect.objectContaining({ workflowName: 'renamed-after-test.json' })
    )
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
