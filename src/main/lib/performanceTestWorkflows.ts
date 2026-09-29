import fs from 'fs'
import path from 'path'
import type {
  AcceleratorSnapshot,
  PerformanceTestBenchmark,
  PerformanceTestResultValue,
  PerformanceTestResultsSummary,
  PerformanceTestStatistics,
  SystemInfo
} from '../../types/ipc'

const PERFORMANCE_TEST_POLL_INTERVAL_MS = 1000
const PERFORMANCE_TEST_TIMEOUT_MS = 4 * 60 * 60 * 1000

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

function isDuration(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function parsePerformanceTestBenchmark(
  value: unknown,
  id: string
): PerformanceTestBenchmark | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const summary = value as Partial<PerformanceTestResultsSummary>
  if (
    !summary.instance ||
    typeof summary.instance.id !== 'string' ||
    typeof summary.instance.name !== 'string' ||
    !summary.workspace ||
    (summary.workspace.id !== null && typeof summary.workspace.id !== 'string') ||
    (summary.workspace.name !== null && typeof summary.workspace.name !== 'string') ||
    (summary.createdAt !== undefined &&
      (typeof summary.createdAt !== 'string' || Number.isNaN(Date.parse(summary.createdAt)))) ||
    typeof summary.workflowName !== 'string' ||
    !isDuration(summary.fastestJobDurationSeconds) ||
    !isDuration(summary.slowestJobDurationSeconds) ||
    !isDuration(summary.averageJobDurationSeconds) ||
    !isDuration(summary.medianJobDurationSeconds) ||
    !Number.isInteger(summary.measuredJobCount) ||
    summary.measuredJobCount! < 0 ||
    (summary.failedRunCount !== undefined &&
      (!Number.isInteger(summary.failedRunCount) || summary.failedRunCount < 0))
  ) {
    return null
  }
  const hardware = summary.hardware
  const hardwareName =
    hardware && typeof hardware.deviceName === 'string'
      ? hardware.deviceName
      : hardware && typeof hardware.deviceType === 'string'
        ? hardware.deviceType
        : null
  return {
    id,
    createdAt: summary.createdAt ?? null,
    instance: summary.instance,
    workspace: summary.workspace,
    workflowName: summary.workflowName,
    fastestJobDurationSeconds: summary.fastestJobDurationSeconds,
    slowestJobDurationSeconds: summary.slowestJobDurationSeconds,
    averageJobDurationSeconds: summary.averageJobDurationSeconds,
    medianJobDurationSeconds: summary.medianJobDurationSeconds,
    measuredJobCount: summary.measuredJobCount!,
    hardwareName,
    result: value as Record<string, PerformanceTestResultValue>
  }
}

function resolvePerformanceTestSessionDir(performanceTestsDir: string, sessionId: string): string {
  const testsDir = path.resolve(performanceTestsDir)
  const sessionDir = path.resolve(testsDir, sessionId)
  if (
    !sessionId ||
    path.dirname(sessionDir) !== testsDir ||
    path.basename(sessionDir) !== sessionId
  ) {
    throw new Error('Invalid performance test benchmark ID.')
  }
  return sessionDir
}

async function readPerformanceTestBenchmark(
  performanceTestsDir: string,
  sessionId: string
): Promise<PerformanceTestBenchmark | null> {
  const sessionDir = resolvePerformanceTestSessionDir(performanceTestsDir, sessionId)
  const contents = await fs.promises.readFile(path.join(sessionDir, 'results.json'), 'utf8')
  return parsePerformanceTestBenchmark(JSON.parse(contents) as unknown, sessionId)
}

/** List valid completed performance test summaries, newest first. */
export async function listPerformanceTestBenchmarks(
  performanceTestsDir: string
): Promise<PerformanceTestBenchmark[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(performanceTestsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const benchmarks: PerformanceTestBenchmark[] = []
  const sessions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  for (const session of sessions) {
    try {
      const benchmark = await readPerformanceTestBenchmark(performanceTestsDir, session)
      if (benchmark) benchmarks.push(benchmark)
    } catch {
      // Missing or malformed sessions are ignored without hiding valid results.
    }
  }
  return benchmarks.sort((a, b) => {
    if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt)
    if (a.createdAt) return -1
    if (b.createdAt) return 1
    return b.id.localeCompare(a.id)
  })
}

/** Delete a completed benchmark session and all files stored with it. */
export async function deletePerformanceTestBenchmark(
  performanceTestsDir: string,
  sessionId: string
): Promise<void> {
  const sessionDir = resolvePerformanceTestSessionDir(performanceTestsDir, sessionId)
  if (!(await readPerformanceTestBenchmark(performanceTestsDir, sessionId))) {
    throw new Error('The performance test benchmark is invalid.')
  }
  await fs.promises.rm(sessionDir, { recursive: true })
}

/** Rename a completed benchmark session folder. */
export async function renamePerformanceTestBenchmark(
  performanceTestsDir: string,
  sessionId: string,
  newSessionId: string
): Promise<void> {
  const sessionDir = resolvePerformanceTestSessionDir(performanceTestsDir, sessionId)
  const renamedSessionDir = resolvePerformanceTestSessionDir(performanceTestsDir, newSessionId)
  if (!(await readPerformanceTestBenchmark(performanceTestsDir, sessionId))) {
    throw new Error('The performance test benchmark is invalid.')
  }
  if (sessionDir === renamedSessionDir) return
  try {
    await fs.promises.stat(renamedSessionDir)
    throw new Error('A benchmark session with that name already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.promises.rename(sessionDir, renamedSessionDir)
}

/** Calculate duration statistics for measured jobs with valid start and end timestamps. */
export function calculatePerformanceTestStatistics(
  response: PerformanceTestJobsResponse,
  measuredPromptIds: string[]
): PerformanceTestStatistics | null {
  const measuredIds = new Set(measuredPromptIds)
  const durations = response.jobs.flatMap((job) => {
    if (!measuredIds.has(job.id) || job.status !== 'completed') return []
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
  benchmarksDir: string
): { filePath: string; sessionDir: string } {
  const performanceTestsDir = path.resolve(benchmarksDir)
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
  benchmarksDir: string
): Promise<object> {
  const managedPath = resolveManagedWorkflowPath(filePath, benchmarksDir).filePath
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

/** Read and validate the persisted data used by the results UI and image export. */
export async function readPerformanceTestResultsSummary(
  filePath: string,
  benchmarksDir: string
): Promise<PerformanceTestResultsSummary> {
  const managedPath = resolveManagedWorkflowPath(filePath, benchmarksDir).filePath
  if (path.basename(managedPath).toLowerCase() !== 'results.json') {
    throw new Error('Select a performance test results.json file.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.promises.readFile(managedPath, 'utf8')) as unknown
  } catch {
    throw new Error('The performance test results are not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The performance test results are invalid.')
  }

  const summary = parsed as Partial<PerformanceTestResultsSummary>
  const systemInfo = summary.systemInfo as Partial<SystemInfo> | undefined
  const hardware = summary.hardware
  if (
    typeof summary.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(summary.createdAt)) ||
    !parsePerformanceTestBenchmark(summary, '') ||
    !Number.isInteger(summary.failedRunCount) ||
    summary.failedRunCount! < 0 ||
    !systemInfo ||
    typeof systemInfo.cpu_model !== 'string' ||
    typeof systemInfo.cpu_cores !== 'number' ||
    typeof systemInfo.arch !== 'string' ||
    typeof systemInfo.platform !== 'string' ||
    typeof systemInfo.os_version !== 'string' ||
    (hardware !== null &&
      (!hardware || typeof hardware !== 'object' || !Array.isArray(hardware.devices)))
  ) {
    throw new Error('The performance test results are invalid.')
  }
  return summary as PerformanceTestResultsSummary
}

/** Validate and persist a user-selected API workflow outside any installation. */
export async function storePerformanceTestWorkflow(
  sourcePath: string,
  benchmarksDir: string
): Promise<string> {
  if (path.extname(sourcePath).toLowerCase() !== '.json') {
    throw new Error('Select a .json workflow file.')
  }
  const sourceFileName = path.basename(sourcePath)
  if (['jobs.json', 'results.json'].includes(sourceFileName.toLowerCase())) {
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

  await fs.promises.mkdir(benchmarksDir, { recursive: true })

  for (let offsetSeconds = 0; ; offsetSeconds++) {
    const sessionId = formatPerformanceTestSessionId(new Date(Date.now() + offsetSeconds * 1000))
    const sessionDir = path.join(benchmarksDir, sessionId)
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
  benchmarksDir: string
): Promise<'deleted' | 'preserved'> {
  const managedPath = resolveManagedWorkflowPath(filePath, benchmarksDir)
  for (const outputName of ['jobs.json', 'results.json', 'logs.txt']) {
    try {
      await fs.promises.access(path.join(managedPath.sessionDir, outputName))
      return 'preserved'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await fs.promises.unlink(managedPath.filePath)
  await fs.promises.rmdir(managedPath.sessionDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOTEMPTY') throw error
  })
  return 'deleted'
}

/** POST one workflow to `/prompt` and return its accepted prompt id. Throws a
 *  run-numbered error when ComfyUI rejects the request or omits the id. */
async function postPerformanceTestPrompt(
  endpoint: URL,
  workflow: object,
  run: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    signal
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
  return result.prompt_id
}

/**
 * Run the warm-up then measured passes **serially**: submit one run, wait for it
 * to reach a terminal state, then submit the next. This mirrors the one-at-a-time
 * cadence of an interactive generation so ComfyUI reclaims each run's
 * dynamically-staged model weights (~model size, pinned in system RAM) before the
 * next begins. Submitting the whole batch up front instead pins that staging N
 * times over with no idle gap to release it, which exhausts system RAM and OOMs
 * the backend on memory-constrained machines even when a single run fits fine.
 *
 * Returns every accepted prompt id (warm-up first, then measured) and the combined
 * terminal jobs response. A run that ends non-`completed` (e.g. it failed) is
 * still terminal, so the loop records it and continues to the next run.
 */
export async function runPerformanceTestWorkflow(
  filePath: string,
  benchmarksDir: string,
  sessionUrl: string,
  measuredRuns: number,
  warmupRuns: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  onSubmitted?: (promptId: string) => void,
  onProgress?: (completedRuns: number, totalRuns: number) => void,
  onSample?: (signal: AbortSignal) => Promise<void> | void,
  pollIntervalMs = PERFORMANCE_TEST_POLL_INTERVAL_MS,
  timeoutMs = PERFORMANCE_TEST_TIMEOUT_MS
): Promise<{ promptIds: string[]; jobsResponse: PerformanceTestJobsResponse }> {
  if (!Number.isInteger(measuredRuns) || measuredRuns < 1 || measuredRuns > 100) {
    throw new Error('Measured runs must be an integer between 1 and 100.')
  }
  if (!Number.isInteger(warmupRuns) || warmupRuns < 1 || warmupRuns > 5) {
    throw new Error('Warm-up runs must be an integer between 1 and 5.')
  }

  let workflow = await readPerformanceTestWorkflow(filePath, benchmarksDir)
  const endpoint = new URL('/prompt', sessionUrl)
  const promptIds: string[] = []
  const jobs: PerformanceTestJob[] = []
  const totalRuns = measuredRuns + warmupRuns
  const deadline = Date.now() + timeoutMs
  let lastResponse: PerformanceTestJobsResponse = { jobs: [] }

  for (let run = 1; run <= totalRuns; run++) {
    signal?.throwIfAborted()
    workflow = incrementWorkflowSeeds(workflow)
    const promptId = await postPerformanceTestPrompt(endpoint, workflow, run, fetchImpl, signal)
    promptIds.push(promptId)
    onSubmitted?.(promptId)

    const completedBefore = run - 1
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Timed out waiting for performance test jobs.')
    // Wait for this run alone before submitting the next — the serialization barrier.
    lastResponse = await waitForPerformanceTestJobs(
      sessionUrl,
      [promptId],
      fetchImpl,
      pollIntervalMs,
      (completed) => onProgress?.(completedBefore + completed, totalRuns),
      signal,
      remaining,
      onSample
    )
    const job = lastResponse.jobs.find((entry) => entry.id === promptId)
    if (job) jobs.push(job)
  }

  return { promptIds, jobsResponse: { ...lastResponse, jobs } }
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, delayMs)
    signal.addEventListener('abort', aborted, { once: true })

    function done(): void {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timeout)
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
  })
}

/** Poll the jobs collection until every submitted prompt reaches a terminal state. */
export async function waitForPerformanceTestJobs(
  sessionUrl: string,
  promptIds: string[],
  fetchImpl: typeof fetch = fetch,
  pollIntervalMs = PERFORMANCE_TEST_POLL_INTERVAL_MS,
  onProgress?: (completedRuns: number, totalRuns: number) => void,
  signal?: AbortSignal,
  timeoutMs = PERFORMANCE_TEST_TIMEOUT_MS,
  // Best-effort per-poll hook (e.g. sample `/system_stats` for peak VRAM). It
  // shares the poll's abort signal; any thrown error is swallowed so a failed
  // sample never aborts the run.
  onSample?: (signal: AbortSignal) => Promise<void> | void
): Promise<PerformanceTestJobsResponse> {
  const endpoint = new URL('/api/jobs', sessionUrl)
  endpoint.searchParams.set('limit', String(promptIds.length))
  const expectedPromptIds = new Set(promptIds)
  const deadline = Date.now() + timeoutMs
  const pollAbort = new AbortController()
  const abortPolling = () => pollAbort.abort(signal?.reason)
  signal?.addEventListener('abort', abortPolling, { once: true })
  if (signal?.aborted) abortPolling()
  const deadlineTimeout = setTimeout(
    () => pollAbort.abort(new Error('Timed out waiting for performance test jobs.')),
    timeoutMs
  )

  try {
    for (;;) {
      pollAbort.signal.throwIfAborted()
      if (Date.now() >= deadline) throw new Error('Timed out waiting for performance test jobs.')
      const response = await fetchImpl(endpoint, { signal: pollAbort.signal })
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

      const jobs = result.jobs.filter(
        (job): job is PerformanceTestJob =>
          job !== null &&
          typeof job === 'object' &&
          typeof job.id === 'string' &&
          typeof job.status === 'string' &&
          expectedPromptIds.has(job.id)
      )
      const statuses = new Map(jobs.map((job) => [job.id, job.status]))
      const completedRuns = [...expectedPromptIds].filter((id) => {
        const status = statuses.get(id)
        return status !== undefined && TERMINAL_JOB_STATUSES.has(status)
      }).length
      onProgress?.(completedRuns, expectedPromptIds.size)
      if (onSample) {
        try {
          await onSample(pollAbort.signal)
        } catch {
          // Sampling is best-effort; never let it abort the run.
        }
      }
      const allTerminal = [...expectedPromptIds].every((id) => {
        const status = statuses.get(id)
        return status !== undefined && TERMINAL_JOB_STATUSES.has(status)
      })
      if (allTerminal) return { ...result, jobs } as PerformanceTestJobsResponse

      await abortableDelay(
        Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())),
        pollAbort.signal
      )
    }
  } finally {
    clearTimeout(deadlineTimeout)
    signal?.removeEventListener('abort', abortPolling)
  }
}

/** Persist the final jobs API response and return its absolute path. */
export async function savePerformanceTestJobsResponse(
  response: PerformanceTestJobsResponse,
  workflowFilePath: string,
  benchmarksDir: string
): Promise<string> {
  const { sessionDir } = resolveManagedWorkflowPath(workflowFilePath, benchmarksDir)
  const resultPath = path.join(sessionDir, 'jobs.json')
  await fs.promises.writeFile(resultPath, `${JSON.stringify(response, null, 2)}\n`, 'utf8')
  return resultPath
}

/** Persist the instance output displayed by the performance test page. */
export async function savePerformanceTestLogs(
  logs: string,
  workflowFilePath: string,
  benchmarksDir: string
): Promise<string> {
  const { sessionDir } = resolveManagedWorkflowPath(workflowFilePath, benchmarksDir)
  const logsPath = path.join(sessionDir, 'logs.txt')
  await fs.promises.writeFile(logsPath, logs, 'utf8')
  return logsPath
}

/** Persist the displayed performance test summary beside the workflow and raw jobs response. */
export async function savePerformanceTestResultsSummary(
  statistics: PerformanceTestStatistics | null,
  instance: PerformanceTestResultsSummary['instance'],
  workspace: PerformanceTestResultsSummary['workspace'],
  hardware: AcceleratorSnapshot | null,
  systemInfo: SystemInfo,
  workflowFilePath: string,
  benchmarksDir: string,
  successfulRunCount: number,
  failedRunCount: number
): Promise<string> {
  const { sessionDir } = resolveManagedWorkflowPath(workflowFilePath, benchmarksDir)
  const summary: PerformanceTestResultsSummary = {
    createdAt: new Date().toISOString(),
    instance,
    workspace,
    workflowName: path.basename(workflowFilePath),
    fastestJobDurationSeconds: statistics?.fastest.durationSeconds ?? null,
    slowestJobDurationSeconds: statistics?.slowest.durationSeconds ?? null,
    averageJobDurationSeconds: statistics?.averageDurationSeconds ?? null,
    medianJobDurationSeconds: statistics?.medianDurationSeconds ?? null,
    measuredJobCount: successfulRunCount,
    failedRunCount,
    hardware,
    systemInfo
  }
  const summaryPath = path.join(sessionDir, 'results.json')
  await fs.promises.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summaryPath
}
