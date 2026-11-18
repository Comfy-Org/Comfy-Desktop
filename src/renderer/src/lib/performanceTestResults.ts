import type { PerformanceTestResultsSummary } from '../types/ipc'

type SystemInfo = PerformanceTestResultsSummary['systemInfo']

export const RUN_COUNT_LIMITS = {
  warmup: { min: 0, max: 5, fallback: 1 },
  measured: { min: 1, max: 100, fallback: 5 }
} as const

export type RunCountLimits = (typeof RUN_COUNT_LIMITS)[keyof typeof RUN_COUNT_LIMITS]

export function clampRunCount(value: string | number, limits: RunCountLimits): number {
  const raw = String(value).trim()
  const parsed = raw === '' ? Number.NaN : Number(raw)
  if (!Number.isFinite(parsed)) return limits.fallback
  return Math.min(limits.max, Math.max(limits.min, Math.round(parsed)))
}

export function formatDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
}

export function formatMemory(megabytes: number): string {
  return `${(megabytes / 1024).toFixed(1)} GB`
}

export function formatOperatingSystem(info: SystemInfo): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}

export const DURATION_KEYS = ['fastest', 'median', 'average', 'slowest'] as const
export type DurationKey = (typeof DURATION_KEYS)[number]
export type RunDurations = Record<DurationKey, number>

export interface DurationRow {
  key: DurationKey
  seconds: number
  share: number
  highlight: boolean
}

export function summaryDurations(summary: PerformanceTestResultsSummary): RunDurations | null {
  const fastest = summary.fastestJobDurationSeconds
  const median = summary.medianJobDurationSeconds
  const average = summary.averageJobDurationSeconds
  const slowest = summary.slowestJobDurationSeconds
  if (fastest === null || median === null || average === null || slowest === null) return null
  return { fastest, median, average, slowest }
}

export function durationRows(durations: RunDurations): DurationRow[] {
  const longest = Math.max(...DURATION_KEYS.map((key) => durations[key]))
  return DURATION_KEYS.map((key) => ({
    key,
    seconds: durations[key],
    share: longest > 0 ? durations[key] / longest : 0,
    highlight: key === 'median'
  }))
}

export type SystemFactKey =
  | 'device'
  | 'vram'
  | 'ram'
  | 'pytorchVersion'
  | 'xformersVersion'
  | 'cpu'
  | 'cpuCores'
  | 'operatingSystem'
  | 'architecture'

export interface SystemFact {
  key: SystemFactKey
  value: string
}

export function systemFacts(
  hardware: PerformanceTestResultsSummary['hardware'] | undefined,
  systemInfo: SystemInfo | undefined
): SystemFact[] {
  const facts: SystemFact[] = []
  const add = (key: SystemFactKey, value: string | null | undefined): void => {
    if (value) facts.push({ key, value })
  }
  if (hardware) {
    add('device', hardware.devices.flatMap((device) => device.deviceName ?? []).join(', '))
    if (hardware.vramMb != null) add('vram', formatMemory(hardware.vramMb))
    if (hardware.ramMb != null) add('ram', formatMemory(hardware.ramMb))
    add('pytorchVersion', hardware.pytorchVersion)
    add('xformersVersion', hardware.xformersVersion)
  }
  if (systemInfo) {
    add('cpu', systemInfo.cpu_model)
    add('cpuCores', String(systemInfo.cpu_cores))
    add('operatingSystem', formatOperatingSystem(systemInfo))
    add('architecture', systemInfo.arch)
  }
  return facts
}

export function lastNonEmptyLine(text: string): string {
  let end = text.length
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1)
    const line = text.slice(start + 1, end).trim()
    if (line) return line
    end = Math.max(start, 0)
  }
  return ''
}

export function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? ''
}

export function parentFolder(filePath: string): string | null {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return separatorIndex > 0 ? filePath.slice(0, separatorIndex) : null
}
