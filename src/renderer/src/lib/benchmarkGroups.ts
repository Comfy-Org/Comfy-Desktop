import type {
  PerformanceTestBenchmark,
  PerformanceTestMachine,
  PerformanceTestResultValue
} from '../types/ipc'
import {
  calculateRelativeSpeedFactor,
  getRelativeSpeedKind,
  type RelativeSpeedKind
} from './relativeSpeed'

export const DURATION_KEYS = [
  'fastestJobDurationSeconds',
  'averageJobDurationSeconds',
  'medianJobDurationSeconds',
  'slowestJobDurationSeconds'
] as const

export type DurationKey = (typeof DURATION_KEYS)[number]

export const DURATION_LABEL_KEYS: Record<DurationKey, string> = {
  fastestJobDurationSeconds: 'benchmarks.fastest',
  averageJobDurationSeconds: 'benchmarks.average',
  medianJobDurationSeconds: 'benchmarks.median',
  slowestJobDurationSeconds: 'benchmarks.slowest'
}

export interface ColumnSort {
  key: string
  ascending: boolean
}

export interface RunComparison {
  factor: number | null
  kind: RelativeSpeedKind
}

export interface BenchmarkGroup {
  key: string
  workflowName: string
  machineKey: string
  members: PerformanceTestBenchmark[]
  rows: PerformanceTestBenchmark[]
  manual: boolean
  buildCount: number
  measuredCount: number
  fastestId: string | null
  referenceId: string | null
  customBaseline: boolean
  comparisons: ReadonlyMap<string, RunComparison>
  scaleMaximum: number
}

export interface BenchmarkGroupsInput {
  benchmarks: readonly PerformanceTestBenchmark[]
  isVisible: (benchmark: PerformanceTestBenchmark) => boolean
  metric: DurationKey
  sort: ColumnSort
  valueOf: (
    benchmark: PerformanceTestBenchmark,
    key: string
  ) => PerformanceTestResultValue | undefined
  manualOrders: Readonly<Record<string, readonly string[]>>
  baselineIds: Readonly<Record<string, string>>
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

export function isDurationKey(key: string): key is DurationKey {
  return (DURATION_KEYS as readonly string[]).includes(key)
}

export function formatSeconds(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(2).replace(/\.?0+$/, '')} s`
}

export function machineKey(benchmark: PerformanceTestBenchmark): string {
  const { gpu, cpu, memoryGb, platform } = benchmark.machine
  return JSON.stringify([gpu, cpu, memoryGb, platform])
}

export function benchmarkGroupKey(benchmark: PerformanceTestBenchmark): string {
  return JSON.stringify([benchmark.workflowName, machineKey(benchmark)])
}

export function machineLabels(
  benchmarks: readonly PerformanceTestBenchmark[],
  text: { unknownHardware: string; memory: (gigabytes: number) => string }
): Map<string, string> {
  const machines = new Map<string, PerformanceTestMachine>(
    benchmarks.map((benchmark) => [machineKey(benchmark), benchmark.machine])
  )
  const details = [...machines].map(([key, machine]) => ({
    key,
    parts: [
      machine.gpu ?? text.unknownHardware,
      machine.cpu,
      machine.memoryGb === null ? null : text.memory(machine.memoryGb),
      machine.platform === null ? null : (PLATFORM_NAMES[machine.platform] ?? machine.platform)
    ]
  }))
  const label = (parts: Array<string | null>, depth: number): string =>
    parts
      .slice(0, depth)
      .filter((part): part is string => part !== null)
      .join(' · ')
  return new Map(
    details.map(({ key, parts }) => {
      let depth = 1
      while (
        depth < parts.length &&
        details.some(
          (other) => other.key !== key && label(other.parts, depth) === label(parts, depth)
        )
      ) {
        depth += 1
      }
      return [key, label(parts, depth)]
    })
  )
}

export function compareFieldValues(
  a: PerformanceTestResultValue | undefined,
  b: PerformanceTestResultValue | undefined,
  ascending: boolean
): number {
  const aMissing = a === undefined || a === null
  const bMissing = b === undefined || b === null
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing)
  const order =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true })
  return ascending ? order : -order
}

export function moveRunInOrder(order: readonly string[], id: string, targetId: string): string[] {
  const from = order.indexOf(id)
  const to = order.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = order.filter((candidate) => candidate !== id)
  const targetIndex = next.indexOf(targetId)
  next.splice(from < to ? targetIndex + 1 : targetIndex, 0, id)
  return next
}

function newestRunTime(members: readonly PerformanceTestBenchmark[]): number {
  return Math.max(
    0,
    ...members.map((benchmark) =>
      benchmark.createdAt === null ? 0 : Date.parse(benchmark.createdAt) || 0
    )
  )
}

function orderMembers(
  members: readonly PerformanceTestBenchmark[],
  input: BenchmarkGroupsInput,
  manualIds: readonly string[] | undefined
): PerformanceTestBenchmark[] {
  const sorted = [...members].sort((a, b) =>
    compareFieldValues(
      input.valueOf(a, input.sort.key),
      input.valueOf(b, input.sort.key),
      input.sort.ascending
    )
  )
  if (!manualIds) return sorted
  const manualIndex = new Map(manualIds.map((id, index) => [id, index]))
  const position = (benchmark: PerformanceTestBenchmark): number =>
    manualIndex.get(benchmark.id) ?? Number.MAX_SAFE_INTEGER
  return sorted.sort((a, b) => position(a) - position(b))
}

function buildGroup(
  key: string,
  members: PerformanceTestBenchmark[],
  input: BenchmarkGroupsInput
): BenchmarkGroup {
  const { metric } = input
  const manualIds = input.manualOrders[key]
  const ordered = orderMembers(members, input, manualIds)
  const measured = members
    .filter((benchmark) => benchmark[metric] !== null)
    .sort((a, b) => a[metric]! - b[metric]!)
  const fastest = measured[0] ?? null
  const chosen = measured.find((benchmark) => benchmark.id === input.baselineIds[key]) ?? null
  const reference = chosen ?? fastest
  const referenceDuration = reference?.[metric] ?? null
  const comparisons = new Map(
    members.map((benchmark) => {
      const factor = calculateRelativeSpeedFactor(referenceDuration, benchmark[metric])
      return [
        benchmark.id,
        { factor, kind: getRelativeSpeedKind(factor, benchmark.id === reference?.id) }
      ]
    })
  )
  const scaleValues = members.flatMap((benchmark) =>
    [benchmark.slowestJobDurationSeconds, benchmark[metric]].filter(
      (value): value is number => value !== null && value > 0
    )
  )
  return {
    key,
    workflowName: members[0]!.workflowName,
    machineKey: machineKey(members[0]!),
    members: ordered,
    rows: ordered.filter(input.isVisible),
    manual: manualIds !== undefined,
    buildCount: new Set(members.map((benchmark) => benchmark.instance.id)).size,
    measuredCount: measured.length,
    fastestId: fastest?.id ?? null,
    referenceId: reference?.id ?? null,
    customBaseline: chosen !== null && chosen.id !== fastest?.id,
    comparisons,
    scaleMaximum: scaleValues.length > 0 ? Math.max(...scaleValues) : 1
  }
}

export function buildBenchmarkGroups(input: BenchmarkGroupsInput): BenchmarkGroup[] {
  const membersByKey = new Map<string, PerformanceTestBenchmark[]>()
  for (const benchmark of input.benchmarks) {
    const key = benchmarkGroupKey(benchmark)
    const members = membersByKey.get(key)
    if (members) members.push(benchmark)
    else membersByKey.set(key, [benchmark])
  }
  return [...membersByKey]
    .map(([key, members]) => buildGroup(key, members, input))
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => newestRunTime(b.members) - newestRunTime(a.members))
}
