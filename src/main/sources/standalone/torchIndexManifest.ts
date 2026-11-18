import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { dataDir } from '../../lib/paths'
import { writeFileSafe } from '../../lib/safe-file'
import { fetchJSON } from '../../lib/fetch'
import { compareVersions, detectNvidiaDriverVersion } from '../../lib/gpu'
import { R2_BASE_URL } from '../../lib/r2Mirror'
import { isArm64Variant, variantAccel } from './envPaths'
import {
  isDevVersion,
  makeAmdIndexStackId,
  makeIndexStackId,
  publicVersion,
  torchIndexUrlForSource,
  torchLocalTag
} from './torchStackTypes'
import type { TorchStackPackages, TorchStackSource } from './torchStackTypes'
import type { TorchStackEntry } from './torchStackCatalog'

type IndexAccel = 'nvidia' | 'amd' | 'intel-xpu' | 'cpu' | 'mps'

export interface TorchIndexStackDef {
  indexTag: string
  accel: IndexAccel
  platforms: readonly NodeJS.Platform[]
  packages: TorchStackPackages
  date: string
  kind?: 'pytorch-nightly-index' | 'amd-multi-arch-index'
  computeCap?: { min: number; max: number }
  pythonAbis?: readonly string[]
  noteKey?: string
  note?: string
}

export interface TorchSeriesInfo {
  noteKey?: string
  note?: string
  minDriver?: Partial<Record<'win32' | 'linux' | 'darwin', string>>
}

const INDEX_SERIES: Readonly<Record<string, TorchSeriesInfo>> = {
  cu126: { noteKey: 'pytorchSeriesNoteCu126', minDriver: { win32: '527.41', linux: '525.60.13' } },
  cu128: { noteKey: 'pytorchSeriesNoteCu128', minDriver: { win32: '527.41', linux: '525.60.13' } },
  cu130: { noteKey: 'pytorchSeriesNoteCu130', minDriver: { win32: '580.88', linux: '580.65.06' } },
  cu132: { noteKey: 'pytorchSeriesNoteCu132', minDriver: { win32: '580.88', linux: '580.65.06' } },
  'rocm7.1': { noteKey: 'pytorchSeriesNoteRocm71' },
  'rocm7.14.0': { noteKey: 'pytorchSeriesNoteRocm714' },
  xpu: { noteKey: 'pytorchSeriesNoteXpu' },
  cpu: { noteKey: 'pytorchSeriesNoteCpu' }
}

const INDEX_STACKS: readonly TorchIndexStackDef[] = [
  {
    indexTag: 'cu126',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu126', torchvision: '0.26.0+cu126', torchaudio: '2.11.0+cu126' },
    date: '2026-03-25',
    computeCap: { min: 5.0, max: 9.0 },
    noteKey: 'pytorchIndexNoteCu126'
  },
  {
    indexTag: 'cu128',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu128', torchvision: '0.26.0+cu128', torchaudio: '2.11.0+cu128' },
    date: '2026-03-25',
    computeCap: { min: 7.5, max: 12.0 },
    noteKey: 'pytorchIndexNoteCu128'
  }
]

const REMOTE_MANIFEST_URL = `${R2_BASE_URL}/torch-index-stacks.json`
const REMOTE_CACHE_FILE = (): string => path.join(dataDir(), 'torch-index-manifest-cache.json')

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+]*$/
const PYTHON_ABI = /^\d+\.\d+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
const NIGHTLY_DEV_DATE = /\.dev(\d{8})$/
const ACCELS: readonly IndexAccel[] = ['nvidia', 'amd', 'intel-xpu', 'cpu', 'mps']
const PLATFORMS: readonly NodeJS.Platform[] = ['win32', 'linux', 'darwin']
const NOTE_MAX_LENGTH = 300

function isSafeNote(v: unknown): v is string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' && v.length <= NOTE_MAX_LENGTH && !/[\x00-\x1f\x7f]/.test(v)
}

const DRIVER_VERSION = /^\d+(\.\d+)*$/

function parseRemoteSeriesEntry(v: unknown): TorchSeriesInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (r.noteKey !== undefined && (typeof r.noteKey !== 'string' || !SAFE_SEGMENT.test(r.noteKey)))
    return null
  if (r.note !== undefined && !isSafeNote(r.note)) return null
  let minDriver: TorchSeriesInfo['minDriver']
  if (r.minDriver !== undefined) {
    if (!r.minDriver || typeof r.minDriver !== 'object' || Array.isArray(r.minDriver)) return null
    minDriver = {}
    for (const [plat, version] of Object.entries(r.minDriver)) {
      if (!PLATFORMS.includes(plat as NodeJS.Platform)) return null
      if (typeof version !== 'string' || !DRIVER_VERSION.test(version)) return null
      minDriver[plat as 'win32' | 'linux' | 'darwin'] = version
    }
    if (Object.keys(minDriver).length === 0) return null
  }
  return {
    ...(r.noteKey ? { noteKey: r.noteKey as string } : {}),
    ...(r.note ? { note: r.note as string } : {}),
    ...(minDriver ? { minDriver } : {})
  }
}

function parseRemoteSeries(v: unknown): Record<string, TorchSeriesInfo> {
  const out: Record<string, TorchSeriesInfo> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [key, entry] of Object.entries(v)) {
    if (!SAFE_SEGMENT.test(key)) continue
    const parsed = parseRemoteSeriesEntry(entry)
    if (parsed) out[key] = parsed
  }
  return out
}

function parseRemoteStackDef(v: unknown): TorchIndexStackDef | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.indexTag !== 'string' || !SAFE_SEGMENT.test(r.indexTag)) return null
  if (typeof r.accel !== 'string' || !ACCELS.includes(r.accel as IndexAccel)) return null
  const stableKind = r.accel === 'mps' ? 'pypi' : 'pytorch-index'
  const nightly = r.kind === 'pytorch-nightly-index'
  const amdMultiArch = r.kind === 'amd-multi-arch-index'
  if (amdMultiArch && r.accel !== 'amd') return null
  if ('kind' in r && !nightly && !amdMultiArch && r.kind !== stableKind) return null
  if (nightly && r.accel === 'mps') return null
  if (!Array.isArray(r.platforms) || r.platforms.length === 0) return null
  if (!r.platforms.every((p) => PLATFORMS.includes(p as NodeJS.Platform))) return null
  const pkgs = r.packages as Record<string, unknown> | undefined
  if (!pkgs || typeof pkgs !== 'object') return null
  if (typeof pkgs.torch !== 'string' || !SAFE_VERSION.test(pkgs.torch)) return null
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (
      pkgs[opt] !== undefined &&
      (typeof pkgs[opt] !== 'string' || !SAFE_VERSION.test(pkgs[opt] as string))
    )
      return null
  }
  for (const v of [pkgs.torch, pkgs.torchvision, pkgs.torchaudio]) {
    if (typeof v === 'string' && isDevVersion(v) !== nightly) return null
  }
  if (nightly) {
    const wheelDates = new Set<string>()
    for (const v of [pkgs.torch, pkgs.torchvision, pkgs.torchaudio]) {
      if (typeof v !== 'string') continue
      const day = NIGHTLY_DEV_DATE.exec(publicVersion(v))?.[1]
      if (!day) return null
      wheelDates.add(day)
    }
    if (wheelDates.size !== 1) return null
    const [d] = wheelDates
    if (!d) return null
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
    if (r.date !== iso) return null
    const parsed = Date.parse(`${iso}T00:00:00Z`)
    if (!Number.isFinite(parsed)) return null
    if (new Date(parsed).toISOString().slice(0, 10) !== iso) return null
    if (parsed - Date.now() > 24 * 60 * 60 * 1000) return null
  }
  const tagOk =
    r.accel === 'nvidia'
      ? /^cu\d+$/.test(r.indexTag)
      : r.accel === 'amd'
        ? /^rocm[\d.]+$/.test(r.indexTag)
        : r.accel === 'intel-xpu'
          ? r.indexTag === 'xpu'
          : r.accel === 'cpu'
            ? r.indexTag === 'cpu'
            : r.indexTag === 'pypi'
  if (!tagOk) return null
  const torchTag = torchLocalTag(pkgs.torch)
  if (r.accel === 'mps') {
    if (torchTag !== '' || !r.platforms.every((p) => p === 'darwin')) return null
  } else if (torchTag !== r.indexTag) {
    return null
  }
  if (r.accel === 'amd' && r.platforms.includes('win32') && !amdMultiArch) return null
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (pkgs[opt] === undefined) continue
    const companionTag = torchLocalTag(pkgs[opt] as string)
    if (companionTag !== torchTag && !(companionTag === '' && !amdMultiArch)) return null
  }
  if (typeof r.date !== 'string' || !ISO_DATE.test(r.date)) return null
  if (r.computeCap !== undefined) {
    const cap = r.computeCap as Record<string, unknown>
    if (!cap || typeof cap !== 'object') return null
    if (typeof cap.min !== 'number' || !Number.isFinite(cap.min)) return null
    if (typeof cap.max !== 'number' || !Number.isFinite(cap.max)) return null
    if (cap.min > cap.max) return null
  }
  if (r.pythonAbis !== undefined) {
    if (!Array.isArray(r.pythonAbis) || r.pythonAbis.length === 0) return null
    if (!r.pythonAbis.every((a) => typeof a === 'string' && PYTHON_ABI.test(a))) return null
  }
  if (r.noteKey !== undefined && (typeof r.noteKey !== 'string' || !SAFE_SEGMENT.test(r.noteKey)))
    return null
  if (r.note !== undefined && !isSafeNote(r.note)) return null
  return {
    indexTag: r.indexTag,
    accel: r.accel as IndexAccel,
    ...(nightly ? { kind: 'pytorch-nightly-index' as const } : {}),
    ...(amdMultiArch ? { kind: 'amd-multi-arch-index' as const } : {}),
    platforms: r.platforms as NodeJS.Platform[],
    packages: {
      torch: pkgs.torch,
      ...(pkgs.torchvision ? { torchvision: pkgs.torchvision as string } : {}),
      ...(pkgs.torchaudio ? { torchaudio: pkgs.torchaudio as string } : {})
    },
    date: r.date,
    ...(r.computeCap
      ? {
          computeCap: {
            min: (r.computeCap as { min: number }).min,
            max: (r.computeCap as { max: number }).max
          }
        }
      : {}),
    ...(r.pythonAbis ? { pythonAbis: r.pythonAbis as string[] } : {}),
    ...(r.noteKey ? { noteKey: r.noteKey } : {}),
    ...(r.note ? { note: r.note } : {})
  }
}

function parseRemoteManifest(
  data: unknown
): { defs: TorchIndexStackDef[]; series: Record<string, TorchSeriesInfo> } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const doc = data as Record<string, unknown>
  if (doc.schemaVersion !== 1) return null
  if (!Array.isArray(doc.stacks)) return null
  const defs = doc.stacks
    .map(parseRemoteStackDef)
    .filter((d): d is TorchIndexStackDef => d !== null)
  const ids = new Map<string, number>()
  for (const d of defs) {
    const id = stackIdForDef(d)
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  const unique = defs.filter((d) => ids.get(stackIdForDef(d)) === 1)
  if (doc.stacks.length > 0 && unique.length === 0) return null
  return { defs: unique, series: parseRemoteSeries(doc.series) }
}

let _remoteDefs: TorchIndexStackDef[] | null = null
let _remoteSeries: Record<string, TorchSeriesInfo> | null = null
let _remoteDiskLoaded = false
let _remoteAttempted = false
let _remoteRefresh: Promise<void> | null = null

export function _setRemoteDefsForTest(
  defs: TorchIndexStackDef[] | null,
  series?: Record<string, TorchSeriesInfo> | null
): void {
  _remoteDefs = defs
  _remoteSeries = series ?? null
  _remoteDiskLoaded = true
  _remoteAttempted = true
}

export function _resetRemoteForTest(): void {
  _remoteDefs = null
  _remoteSeries = null
  _remoteDiskLoaded = false
  _remoteAttempted = false
  _remoteRefresh = null
}

function activeDefs(): readonly TorchIndexStackDef[] {
  if (_remoteDefs === null && !_remoteDiskLoaded) {
    _remoteDiskLoaded = true
    try {
      const raw = JSON.parse(fs.readFileSync(REMOTE_CACHE_FILE(), 'utf-8'))
      const parsed = parseRemoteManifest(raw)
      if (parsed !== null) {
        _remoteDefs = parsed.defs
        _remoteSeries = parsed.series
      }
    } catch {}
  }
  return _remoteDefs ?? INDEX_STACKS
}

async function fetchRemoteIndexStacks(): Promise<void> {
  try {
    const data = await fetchJSON(REMOTE_MANIFEST_URL, { refresh: true })
    const parsed = parseRemoteManifest(data)
    if (parsed !== null) {
      _remoteDefs = parsed.defs
      _remoteSeries = parsed.series
      _remoteDiskLoaded = true
      try {
        writeFileSafe(
          REMOTE_CACHE_FILE(),
          JSON.stringify({ schemaVersion: 1, series: parsed.series, stacks: parsed.defs }, null, 2)
        )
      } catch {}
    }
  } catch {
  } finally {
    _remoteAttempted = true
  }
}

export function refreshRemoteIndexStacks(): Promise<void> {
  _remoteRefresh ??= fetchRemoteIndexStacks().finally(() => {
    _remoteRefresh = null
  })
  return _remoteRefresh
}

export function ensureRemoteIndexStacks(): Promise<void> {
  if (_remoteAttempted) return Promise.resolve()
  return refreshRemoteIndexStacks()
}

function sourceFor(def: TorchIndexStackDef): TorchStackSource {
  if (def.kind === 'amd-multi-arch-index')
    return { kind: 'amd-multi-arch-index', indexTag: def.indexTag }
  if (def.accel === 'mps') return { kind: 'pypi', backend: 'mps' }
  const backend =
    def.accel === 'nvidia'
      ? 'cuda'
      : def.accel === 'amd'
        ? 'rocm'
        : def.accel === 'intel-xpu'
          ? 'xpu'
          : 'cpu'
  return { kind: 'pytorch-index', backend, indexTag: def.indexTag }
}

let _computeCaps: number[] | null | undefined

export function _setComputeCapsForTest(caps: number[] | null | undefined): void {
  _computeCaps = caps
}

export function _setComputeCapProbeForTest(
  probe: (() => Promise<number[] | null>) | undefined
): void {
  _probeFn = probe ?? probeComputeCaps
}

function probeComputeCaps(): Promise<number[] | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=compute_cap', '--format=csv,noheader'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const caps = stdout
          .split('\n')
          .map((line) => Number.parseFloat(line.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
        resolve(caps.length > 0 ? caps : null)
      }
    )
  })
}

let _probeFn: () => Promise<number[] | null> = probeComputeCaps

export async function refreshComputeCaps(): Promise<void> {
  _computeCaps = await _probeFn()
}

let _nvidiaDriver: string | null | undefined

export function _setNvidiaDriverForTest(version: string | null | undefined): void {
  _nvidiaDriver = version
}

let _driverProbeFn: () => Promise<string | null> = async () =>
  (await detectNvidiaDriverVersion()) ?? null

export function _setNvidiaDriverProbeForTest(
  probe: (() => Promise<string | null>) | undefined
): void {
  _driverProbeFn = probe ?? (async () => (await detectNvidiaDriverVersion()) ?? null)
}

export async function refreshNvidiaDriver(): Promise<void> {
  try {
    _nvidiaDriver = await _driverProbeFn()
  } catch {
    _nvidiaDriver = null
  }
}

export function torchSeriesInfo(seriesId: string): TorchSeriesInfo | null {
  activeDefs()
  return _remoteSeries?.[seriesId] ?? INDEX_SERIES[seriesId] ?? null
}

export function nvidiaDriverMismatch(
  info: TorchSeriesInfo | null
): { required: string; detected: string } | null {
  const required = info?.minDriver?.[process.platform as 'win32' | 'linux' | 'darwin']
  if (!required || !_nvidiaDriver) return null
  if (compareVersions(_nvidiaDriver, required) >= 0) return null
  return { required, detected: _nvidiaDriver }
}

function capMismatch(
  def: TorchIndexStackDef
): { min: number; max: number; detected: number[] } | null {
  if (!def.computeCap) return null
  if (_computeCaps == null || _computeCaps.length === 0) return null
  const { min, max } = def.computeCap
  if (_computeCaps.some((cap) => cap >= min && cap <= max)) return null
  return { min, max, detected: [..._computeCaps] }
}

function stackIdForDef(def: TorchIndexStackDef): string {
  return def.kind === 'amd-multi-arch-index'
    ? makeAmdIndexStackId(def.indexTag, def.packages.torch)
    : makeIndexStackId(def.indexTag, def.packages.torch)
}

function entryFromDef(def: TorchIndexStackDef, variant: string): TorchStackEntry {
  const mismatch = capMismatch(def)
  return {
    stackId: stackIdForDef(def),
    variant,
    pythonVersion: '',
    packages: def.packages,
    source: sourceFor(def),
    date: def.date,
    comfyuiVersion: '',
    ...(def.noteKey ? { noteKey: def.noteKey } : {}),
    ...(def.note ? { note: def.note } : {}),
    ...(def.pythonAbis ? { pythonAbis: [...def.pythonAbis] } : {}),
    ...(mismatch ? { capWarning: mismatch } : {})
  }
}

const NIGHTLY_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000

function nightlyFresh(def: TorchIndexStackDef): boolean {
  if (def.kind !== 'pytorch-nightly-index') return true
  const wheelDate = Date.parse(`${def.date}T00:00:00Z`)
  return Number.isFinite(wheelDate) && Date.now() - wheelDate <= NIGHTLY_MAX_AGE_MS
}

export function indexStacksForVariant(variant: string): TorchStackEntry[] {
  if (isArm64Variant(variant)) return []
  const accel = variantAccel(variant)
  return activeDefs()
    .filter((def) => def.accel === accel)
    .filter((def) => def.platforms.includes(process.platform))
    .filter(nightlyFresh)
    .filter(
      (def) =>
        torchIndexUrlForSource(sourceFor(def), def.packages) !== null ||
        (def.accel === 'mps' && torchLocalTag(def.packages.torch) === '')
    )
    .map((def) => entryFromDef(def, variant))
    .sort((a, b) => b.date.localeCompare(a.date))
}
