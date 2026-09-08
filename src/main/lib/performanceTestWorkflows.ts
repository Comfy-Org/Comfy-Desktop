import fs from 'fs'
import path from 'path'
import type { AcceleratorSnapshot } from './hardwareTap'

const PERFORMANCE_TESTS_DIR = 'performance-tests'
const PERFORMANCE_TEST_POLL_INTERVAL_MS = 1000
export const PERFORMANCE_TEST_MODEL_LOAD_RUNS = 1

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export interface PerformanceTestJob {
  id: string
  status: string
  [key: string]: unknown
}

export interface PerformanceTestJobsResponse {
  jobs: PerformanceTestJob[]
  pagination?: unknown
  [key: string]: unknown
}

export interface PerformanceTestDurationResult {
  jobId: string
  durationSeconds: number
}

export interface PerformanceTestStatistics {
  fastest: PerformanceTestDurationResult
  slowest: PerformanceTestDurationResult
  averageDurationSeconds: number
  medianDurationSeconds: number
  measuredJobCount: number
}

export interface PerformanceTestResultsSummary {
  instance: {
    id: string
    name: string
  }
  workspace: {
    id: string | null
    name: string | null
  }
  workflowName: string
  fastestJobDurationSeconds: number | null
  slowestJobDurationSeconds: number | null
  averageJobDurationSeconds: number | null
  medianJobDurationSeconds: number | null
  measuredJobCount: number
  hardware: AcceleratorSnapshot | null
}

/** Calculate duration statistics for measured jobs with valid start and end timestamps. */
export function calculatePerformanceTestStatistics(
  response: PerformanceTestJobsResponse,
  measuredPromptIds: string[]
): PerformanceTestStatistics | null {
  const measuredIds = new Set(measuredPromptIds)
  const durations = response.jobs.flatMap((job) => {
    if (!measuredIds.has(job.id)) return []
    const start = job.execution_start_time
    const end = job.execution_end_time
    if (
      typeof start !== 'number' ||
      !Number.isFinite(start) ||
      typeof end !== 'number' ||
      !Number.isFinite(end) ||
      end < start
    ) {
      return []
    }
    return [{ jobId: job.id, durationSeconds: (end - start) / 1000 }]
  })
  if (durations.length === 0) return null

  const sorted = [...durations].sort((a, b) => a.durationSeconds - b.durationSeconds)
  const middle = Math.floor(sorted.length / 2)
  const medianDurationSeconds =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]!.durationSeconds + sorted[middle]!.durationSeconds) / 2
      : sorted[middle]!.durationSeconds
  return {
    fastest: sorted[0]!,
    slowest: sorted[sorted.length - 1]!,
    averageDurationSeconds:
      durations.reduce((sum, result) => sum + result.durationSeconds, 0) / durations.length,
    medianDurationSeconds,
    measuredJobCount: durations.length
  }
}

function isApiWorkflow(value: unknown): value is object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const nodes = Object.values(value)
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        node !== null &&
        typeof node === 'object' &&
        typeof (node as { class_type?: unknown }).class_type === 'string' &&
        (node as { inputs?: unknown }).inputs !== null &&
        typeof (node as { inputs?: unknown }).inputs === 'object' &&
        !Array.isArray((node as { inputs?: unknown }).inputs)
    )
  )
}

/** Return a workflow copy with every numeric seed input advanced by one. */
export function incrementWorkflowSeeds(workflow: object): object {
  const nextWorkflow = structuredClone(workflow) as Record<string, unknown>
  for (const node of Object.values(nextWorkflow)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const inputs = (node as { inputs?: unknown }).inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const mutableInputs = inputs as Record<string, unknown>
    for (const [name, value] of Object.entries(inputs)) {
      if (
        name.toLowerCase().includes('seed') &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        mutableInputs[name] = value + 1
      }
    }
  }
  return nextWorkflow
}

function formatPerformanceTestSessionId(date: Date): string {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join('')
}

function resolveManagedWorkflowPath(
  filePath: string,
  userDataPath: string
): { filePath: string; sessionDir: string } {
  const performanceTestsDir = path.resolve(userDataPath, PERFORMANCE_TESTS_DIR)
  const resolvedPath = path.resolve(filePath)
  const relativePath = path.relative(performanceTestsDir, resolvedPath)
  const parts = relativePath.split(path.sep)
  if (
    parts.length !== 2 ||
    !/^\d{14}$/.test(parts[0]!) ||
    path.isAbsolute(relativePath) ||
    parts.includes('..')
  ) {
    throw new Error('The workflow is outside a managed performance test session directory.')
  }
  return { filePath: resolvedPath, sessionDir: path.dirname(resolvedPath) }
}

async function readPerformanceTestWorkflow(
  filePath: string,
  userDataPath: string
): Promise<object> {
  const managedPath = resolveManagedWorkflowPath(filePath, userDataPath).filePath
  const contents = await fs.promises.readFile(managedPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error('The performance test workflow is not valid JSON.')
  }
  if (!isApiWorkflow(parsed)) {
    throw new Error('The performance test workflow is not a ComfyUI API-format workflow.')
  }
  return parsed
}

/** Validate and persist a user-selected API workflow outside any installation. */
export async function storePerformanceTestWorkflow(
  sourcePath: string,
  userDataPath: string
): Promise<string> {
  if (path.extname(sourcePath).toLowerCase() !== '.json') {
    throw new Error('Select a .json workflow file.')
  }
  const sourceFileName = path.basename(sourcePath)
  if (['results.json', 'results_summary.json'].includes(sourceFileName.toLowerCase())) {
    throw new Error(
      `The workflow filename ${sourceFileName} is reserved for performance test output.`
    )
  }

  const contents = await fs.promises.readFile(sourcePath)
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.toString('utf8'))
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }
  if (!isApiWorkflow(parsed)) {
    throw new Error('The selected file is not a ComfyUI API-format workflow.')
  }

  const performanceTestsDir = path.join(userDataPath, PERFORMANCE_TESTS_DIR)
  await fs.promises.mkdir(performanceTestsDir, { recursive: true })

  for (let offsetSeconds = 0; ; offsetSeconds++) {
    const sessionId = formatPerformanceTestSessionId(new Date(Date.now() + offsetSeconds * 1000))
    const sessionDir = path.join(performanceTestsDir, sessionId)
    try {
      await fs.promises.mkdir(sessionDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }

    const destinationPath = path.join(sessionDir, sourceFileName)
    try {
      await fs.promises.writeFile(destinationPath, contents)
      return destinationPath
    } catch (error) {
      await fs.promises.rm(sessionDir, { recursive: true, force: true })
      throw error
    }
  }
}

/** Delete a workflow copy managed by the performance test page. */
export async function deletePerformanceTestWorkflow(
  filePath: string,
  userDataPath: string
): Promise<void> {
  const managedPath = resolveManagedWorkflowPath(filePath, userDataPath)
  try {
    await fs.promises.access(path.join(managedPath.sessionDir, 'results.json'))
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.promises.unlink(managedPath.filePath)
  await fs.promises.rmdir(managedPath.sessionDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOTEMPTY') throw error
  })
}

/** Queue model-load and warm-up requests, followed by each measured run. */
export async function submitPerformanceTestWorkflow(
  filePath: string,
  userDataPath: string,
  sessionUrl: string,
  measuredRuns: number,
  warmupRuns: number,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!Number.isInteger(measuredRuns) || measuredRuns < 1 || measuredRuns > 100) {
    throw new Error('Measured runs must be an integer between 1 and 100.')
  }
  if (!Number.isInteger(warmupRuns) || warmupRuns < 1 || warmupRuns > 5) {
    throw new Error('Warm-up runs must be an integer between 1 and 5.')
  }

  let workflow = await readPerformanceTestWorkflow(filePath, userDataPath)
  const endpoint = new URL('/prompt', sessionUrl)
  const promptIds: string[] = []
  const totalRuns = measuredRuns + warmupRuns + PERFORMANCE_TEST_MODEL_LOAD_RUNS

  for (let run = 1; run <= totalRuns; run++) {
    workflow = incrementWorkflowSeeds(workflow)
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    })
    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new Error(
        `Performance Test request ${run} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
      )
    }
    const result = (await response.json()) as { prompt_id?: unknown; error?: unknown }
    if (result.error) {
      throw new Error(`Performance Test request ${run} failed: ${String(result.error)}`)
    }
    if (typeof result.prompt_id !== 'string') {
      throw new Error(`Performance Test request ${run} did not return a prompt ID.`)
    }
    promptIds.push(result.prompt_id)
  }

  return promptIds
}

/** Poll the jobs collection until every submitted prompt reaches a terminal state. */
export async function waitForPerformanceTestJobs(
  sessionUrl: string,
  promptIds: string[],
  fetchImpl: typeof fetch = fetch,
  pollIntervalMs = PERFORMANCE_TEST_POLL_INTERVAL_MS
): Promise<PerformanceTestJobsResponse> {
  const endpoint = new URL('/api/jobs', sessionUrl)
  endpoint.searchParams.set('limit', String(promptIds.length))
  const expectedPromptIds = new Set(promptIds)

  for (;;) {
    const response = await fetchImpl(endpoint)
    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new Error(
        `Could not check performance test jobs: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
      )
    }

    const result = (await response.json()) as Partial<PerformanceTestJobsResponse>
    if (!Array.isArray(result.jobs)) {
      throw new Error('The ComfyUI jobs response did not contain a jobs array.')
    }

    const statuses = new Map(
      result.jobs
        .filter(
          (job): job is PerformanceTestJob =>
            job !== null &&
            typeof job === 'object' &&
            typeof job.id === 'string' &&
            typeof job.status === 'string'
        )
        .map((job) => [job.id, job.status])
    )
    const allTerminal = [...expectedPromptIds].every((id) => {
      const status = statuses.get(id)
      return status !== undefined && TERMINAL_JOB_STATUSES.has(status)
    })
    if (allTerminal) return result as PerformanceTestJobsResponse

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

/** Persist the final jobs API response and return its absolute path. */
export async function savePerformanceTestJobsResponse(
  response: PerformanceTestJobsResponse,
  workflowFilePath: string,
  userDataPath: string
): Promise<string> {
  const { sessionDir } = resolveManagedWorkflowPath(workflowFilePath, userDataPath)
  const resultPath = path.join(sessionDir, 'results.json')
  await fs.promises.writeFile(resultPath, `${JSON.stringify(response, null, 2)}\n`, 'utf8')
  return resultPath
}

/** Persist the displayed performance test summary beside the workflow and raw jobs response. */
export async function savePerformanceTestResultsSummary(
  statistics: PerformanceTestStatistics | null,
  instance: PerformanceTestResultsSummary['instance'],
  workspace: PerformanceTestResultsSummary['workspace'],
  hardware: AcceleratorSnapshot | null,
  workflowFilePath: string,
  userDataPath: string
): Promise<string> {
  const { sessionDir } = resolveManagedWorkflowPath(workflowFilePath, userDataPath)
  const summary: PerformanceTestResultsSummary = {
    instance,
    workspace,
    workflowName: path.basename(workflowFilePath),
    fastestJobDurationSeconds: statistics?.fastest.durationSeconds ?? null,
    slowestJobDurationSeconds: statistics?.slowest.durationSeconds ?? null,
    averageJobDurationSeconds: statistics?.averageDurationSeconds ?? null,
    medianJobDurationSeconds: statistics?.medianDurationSeconds ?? null,
    measuredJobCount: statistics?.measuredJobCount ?? 0,
    hardware
  }
  const summaryPath = path.join(sessionDir, 'results_summary.json')
  await fs.promises.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summaryPath
}
