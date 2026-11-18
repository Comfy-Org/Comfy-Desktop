import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import type { WebContents } from 'electron'

import type {
  ComfyDesktopAssetBytes,
  ComfyDesktopAssetError,
  ComfyDesktopAssetFailure,
  ComfyDesktopAssetKind,
  ComfyDesktopAssetRef,
  ComfyDesktopAssetValue,
  ComfyDesktopAssetWhere
} from '../../types/comfyDesktopBridge'
import * as installations from '../installations'
import { listNewestCloudOutputs, readCloudOutput } from '../lib/assets'
import type { CloudOutput } from '../lib/assets'
import { comfyFoldersOf, thumbnailDataUrl, thumbnailDataUrlFromBytes } from '../lib/outputFolders'
import type { ComfyFolders } from '../lib/outputFolders'
import { runPool } from '../sources/standalone/templateDownloadCore'
import { pageBuildId } from './localComfy'

export const DEFAULT_RECENT = 12
export const MAX_RECENT = 48
export const MAX_FILE_BYTES = 2 * 1024 ** 3
export const MAX_READ_BYTES = 512 * 1024 ** 2
export const MAX_REFS_PER_PAGE = 500
const APPS_FOLDER = 'apps'
const COPIES_FOLDER = 'desktop'
const THUMB_LONG_SIDE = 256

const MAX_FOLDER_DEPTH = 6
const STATS_AT_ONCE = 32
const THUMBS_AT_ONCE = 4
const HASH_NAME_LENGTH = 16
const CLOUD_LIST_FACTOR = 4
const CLOUD_THUMB_MAX_BYTES = 8 * 1024 ** 2
const CLOUD_THUMB_TIMEOUT_MS = 5_000
const CLOUD_READ_TIMEOUT_MS = 5 * 60_000
const MISSING_TAG = 'missing'
const READ_WITHOUT_FOLLOWING =
  fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)

interface FileType {
  kind: ComfyDesktopAssetKind
  mime: string
}

const FILE_TYPES: ReadonlyMap<string, FileType> = new Map<string, FileType>([
  ['.png', { kind: 'image', mime: 'image/png' }],
  ['.jpg', { kind: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { kind: 'image', mime: 'image/jpeg' }],
  ['.webp', { kind: 'image', mime: 'image/webp' }],
  ['.gif', { kind: 'image', mime: 'image/gif' }],
  ['.avif', { kind: 'image', mime: 'image/avif' }],
  ['.bmp', { kind: 'image', mime: 'image/bmp' }],
  ['.tif', { kind: 'image', mime: 'image/tiff' }],
  ['.tiff', { kind: 'image', mime: 'image/tiff' }],
  ['.mp4', { kind: 'video', mime: 'video/mp4' }],
  ['.m4v', { kind: 'video', mime: 'video/mp4' }],
  ['.webm', { kind: 'video', mime: 'video/webm' }],
  ['.mov', { kind: 'video', mime: 'video/quicktime' }],
  ['.mkv', { kind: 'video', mime: 'video/x-matroska' }],
  ['.avi', { kind: 'video', mime: 'video/x-msvideo' }]
])

const KINDS: readonly ComfyDesktopAssetKind[] = ['image', 'video']

interface LocalEntry {
  where: 'local'
  key: string
  file: string
  type: FileType
}

interface CloudEntry {
  where: 'cloud'
  key: string
  assetId: string
  mime: string
  loaderPath: string | null
}

type Entry = LocalEntry | CloudEntry

interface PageRefs {
  byRef: Map<string, Entry>
  byKey: Map<string, string>
}

interface FoundFile {
  file: string
  type: FileType
  size: number
  modifiedMs: number
  app: string | null
}

export interface PathApi {
  sep: string
  relative(from: string, to: string): string
  isAbsolute(target: string): boolean
}

export type AssetResult<T> = T | ComfyDesktopAssetFailure

const refsByPage = new WeakMap<WebContents, PageRefs>()
const watchedPages = new WeakSet<WebContents>()
const copiesUnderWay = new Map<string, Promise<AssetResult<ComfyDesktopAssetValue>>>()

function failure(error: ComfyDesktopAssetError): ComfyDesktopAssetFailure {
  return { error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fileTypeOf(name: string): FileType | null {
  return FILE_TYPES.get(path.extname(name).toLowerCase()) ?? null
}

function isOfKinds(name: string, kinds: readonly ComfyDesktopAssetKind[]): boolean {
  const type = fileTypeOf(name)
  return type !== null && kinds.includes(type.kind)
}

function readKinds(raw: unknown): ComfyDesktopAssetKind[] {
  const kinds = isRecord(raw) && Array.isArray(raw['kinds']) ? raw['kinds'] : []
  return KINDS.filter((kind) => kinds.includes(kind))
}

function readWhere(raw: unknown): ComfyDesktopAssetWhere | null {
  const where = isRecord(raw) ? raw['where'] : null
  return where === 'local' || where === 'cloud' ? where : null
}

function readLimit(raw: unknown): number {
  const limit = isRecord(raw) ? raw['limit'] : undefined
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_RECENT
  return Math.min(MAX_RECENT, Math.max(1, Math.floor(limit)))
}

function relativeInside(root: string, target: string, paths: PathApi = path): string | null {
  const relative = paths.relative(root, target)
  if (relative === '' || paths.isAbsolute(relative)) return null
  const parts = relative.split(paths.sep)
  return parts[0] === '..' ? null : parts.join('/')
}

export function annotatedName(
  root: string,
  file: string,
  folder: 'output' | 'input',
  paths: PathApi = path
): string | null {
  const relative = relativeInside(root, file, paths)
  return relative === null ? null : `${relative} [${folder}]`
}

export function appOfResult(appsDir: string, file: string, paths: PathApi = path): string | null {
  const relative = relativeInside(appsDir, file, paths)
  const parts = relative?.split('/') ?? []
  return parts.length > 1 ? (parts[0] ?? null) : null
}

async function realFolder(dir: string | null): Promise<string | null> {
  if (!dir) return null
  const real = await fsp.realpath(dir).catch(() => null)
  if (!real) return null
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isDirectory() ? real : null
}

async function appsFolderOf(outputDir: string | null): Promise<string | null> {
  const root = await realFolder(outputDir)
  if (!root) return null
  const apps = await realFolder(path.join(root, APPS_FOLDER))
  return apps && relativeInside(root, apps) !== null ? apps : null
}

async function foldersFor(page: WebContents): Promise<ComfyFolders> {
  const buildId = pageBuildId(page)
  const build = buildId ? await installations.get(buildId).catch(() => null) : null
  return comfyFoldersOf(build ?? null)
}

function forgetPage(page: WebContents): void {
  refsByPage.delete(page)
}

function refsFor(page: WebContents): PageRefs {
  const known = refsByPage.get(page)
  if (known) return known
  const refs: PageRefs = { byRef: new Map(), byKey: new Map() }
  refsByPage.set(page, refs)
  if (!watchedPages.has(page)) {
    watchedPages.add(page)
    page.on('did-navigate', () => forgetPage(page))
    page.once('destroyed', () => forgetPage(page))
  }
  return refs
}

function remember(page: WebContents, entry: Entry): string {
  const refs = refsFor(page)
  const ref = refs.byKey.get(entry.key) ?? randomUUID()
  refs.byRef.delete(ref)
  refs.byRef.set(ref, entry)
  refs.byKey.set(entry.key, ref)
  for (const [oldest, dropped] of refs.byRef) {
    if (refs.byRef.size <= MAX_REFS_PER_PAGE) break
    refs.byRef.delete(oldest)
    refs.byKey.delete(dropped.key)
  }
  return ref
}

function entryOf(page: WebContents, ref: unknown): Entry | null {
  return typeof ref === 'string' ? (refsByPage.get(page)?.byRef.get(ref) ?? null) : null
}

export function _heldRefsForTest(page: WebContents): number {
  return refsByPage.get(page)?.byRef.size ?? 0
}

async function collectResults(
  appsDir: string,
  kinds: readonly ComfyDesktopAssetKind[]
): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const dirents: Dirent[] = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory() && depth < MAX_FOLDER_DEPTH) await walk(full, depth + 1)
      else if (dirent.isFile() && isOfKinds(dirent.name, kinds)) files.push(full)
    }
  }
  await walk(appsDir, 0)
  return files
}

async function findAppResults(
  outputDir: string | null,
  kinds: readonly ComfyDesktopAssetKind[]
): Promise<FoundFile[]> {
  const appsDir = await appsFolderOf(outputDir)
  if (!appsDir || kinds.length === 0) return []
  const found: FoundFile[] = []
  await runPool(await collectResults(appsDir, kinds), STATS_AT_ONCE, async (file) => {
    const stat = await fsp.lstat(file).catch(() => null)
    const type = fileTypeOf(file)
    if (!stat?.isFile() || !type) return
    const modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
    found.push({ file, type, size: stat.size, modifiedMs, app: appOfResult(appsDir, file) })
  })
  return found.sort((a, b) => b.modifiedMs - a.modifiedMs)
}

function localRef(page: WebContents, found: FoundFile, thumb: string | null): ComfyDesktopAssetRef {
  const ref = remember(page, {
    where: 'local',
    key: `local\n${found.file}`,
    file: found.file,
    type: found.type
  })
  return {
    ref,
    name: path.basename(found.file),
    kind: found.type.kind,
    where: 'local',
    app: found.app,
    createdAt: found.modifiedMs,
    size: found.size,
    thumb
  }
}

async function withThumbs<T, R>(
  items: readonly T[],
  thumbOf: (item: T) => Promise<string | null>,
  build: (item: T, thumb: string | null) => R
): Promise<R[]> {
  const thumbs: (string | null)[] = items.map(() => null)
  await runPool(items, THUMBS_AT_ONCE, async (item, i) => {
    thumbs[i] = await thumbOf(item).catch(() => null)
  })
  return items.map((item, i) => build(item, thumbs[i] ?? null))
}

async function recentLocal(
  page: WebContents,
  kinds: readonly ComfyDesktopAssetKind[],
  limit: number
): Promise<ComfyDesktopAssetRef[]> {
  const { output } = await foldersFor(page)
  const newest = (await findAppResults(output, kinds)).slice(0, limit)
  return withThumbs(
    newest,
    (found) => thumbnailDataUrl(found.file, THUMB_LONG_SIDE),
    (found, thumb) => localRef(page, found, thumb)
  )
}

function cloudTypeOf(output: CloudOutput): FileType | null {
  const byName = fileTypeOf(output.name)
  if (byName) return byName
  return [...FILE_TYPES.values()].find((type) => type.mime === output.mimeType) ?? null
}

async function cloudThumb(output: CloudOutput, type: FileType): Promise<string | null> {
  if (type.kind !== 'image' || output.size === null || output.size > CLOUD_THUMB_MAX_BYTES) {
    return null
  }
  const read = await readCloudOutput(output.id, CLOUD_THUMB_MAX_BYTES, CLOUD_THUMB_TIMEOUT_MS)
  return 'bytes' in read ? thumbnailDataUrlFromBytes(read.bytes, THUMB_LONG_SIDE) : null
}

function createdAtOf(output: CloudOutput): number {
  const at = output.createdAt ? Date.parse(output.createdAt) : NaN
  return Number.isFinite(at) ? at : 0
}

function cloudRef(
  page: WebContents,
  output: CloudOutput,
  type: FileType,
  thumb: string | null
): ComfyDesktopAssetRef {
  const ref = remember(page, {
    where: 'cloud',
    key: `cloud\n${output.id}`,
    assetId: output.id,
    mime: output.mimeType ?? type.mime,
    loaderPath: output.loaderPath
  })
  return {
    ref,
    name: output.name,
    kind: type.kind,
    where: 'cloud',
    app: null,
    createdAt: createdAtOf(output),
    size: output.size ?? 0,
    thumb
  }
}

async function recentCloud(
  page: WebContents,
  kinds: readonly ComfyDesktopAssetKind[],
  limit: number
): Promise<ComfyDesktopAssetRef[]> {
  const outputs = await listNewestCloudOutputs(limit * CLOUD_LIST_FACTOR)
  if (!outputs) return []
  const usable: { output: CloudOutput; type: FileType }[] = []
  for (const output of outputs) {
    const type = cloudTypeOf(output)
    if (!type || !kinds.includes(type.kind) || output.tags.includes(MISSING_TAG)) continue
    usable.push({ output, type })
    if (usable.length === limit) break
  }
  return withThumbs(
    usable,
    ({ output, type }) => cloudThumb(output, type),
    ({ output, type }, thumb) => cloudRef(page, output, type, thumb)
  )
}

export async function recentAssets(
  page: WebContents,
  request: unknown
): Promise<ComfyDesktopAssetRef[]> {
  const kinds = readKinds(request)
  const where = readWhere(request)
  if (kinds.length === 0 || !where) return []
  const limit = readLimit(request)
  return where === 'local' ? recentLocal(page, kinds, limit) : recentCloud(page, kinds, limit)
}

async function appOfFile(page: WebContents, file: string): Promise<string | null> {
  const appsDir = await appsFolderOf((await foldersFor(page)).output)
  return appsDir ? appOfResult(appsDir, file) : null
}

export async function assetFromPath(
  page: WebContents,
  rawPath: unknown,
  request: unknown
): Promise<AssetResult<ComfyDesktopAssetRef>> {
  if (typeof rawPath !== 'string' || rawPath === '' || !path.isAbsolute(rawPath)) {
    return failure('no-path')
  }
  const real = await fsp.realpath(rawPath).catch(() => null)
  const stat = real ? await fsp.stat(real).catch(() => null) : null
  if (!real || !stat) return failure('missing')
  if (!stat.isFile()) return failure('not-a-file')
  const type = fileTypeOf(real)
  if (!type || !readKinds(request).includes(type.kind)) return failure('wrong-kind')
  if (stat.size > MAX_FILE_BYTES) return failure('too-large')
  const found: FoundFile = {
    file: real,
    type,
    size: stat.size,
    modifiedMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0,
    app: await appOfFile(page, real)
  }
  const thumb = await thumbnailDataUrl(real, THUMB_LONG_SIDE).catch(() => null)
  return localRef(page, found, thumb)
}

async function sameRegularFile(file: string): Promise<boolean> {
  const real = await fsp.realpath(file).catch(() => null)
  if (real !== file) return false
  const stat = await fsp.stat(real).catch(() => null)
  return stat?.isFile() === true
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  return (whole ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
}

async function readLocal(entry: LocalEntry): Promise<AssetResult<ComfyDesktopAssetBytes>> {
  if (!(await sameRegularFile(entry.file))) return failure('missing')
  const handle = await fsp.open(entry.file, READ_WITHOUT_FOLLOWING).catch(() => null)
  if (!handle) return failure('missing')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) return failure('missing')
    if (stat.size > MAX_READ_BYTES) return failure('too-large')
    const bytes = await handle.readFile()
    if (bytes.byteLength > MAX_READ_BYTES) return failure('too-large')
    return { bytes: asArrayBuffer(bytes), mime: entry.type.mime }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function readCloud(entry: CloudEntry): Promise<AssetResult<ComfyDesktopAssetBytes>> {
  const read = await readCloudOutput(entry.assetId, MAX_READ_BYTES, CLOUD_READ_TIMEOUT_MS)
  return 'bytes' in read ? { bytes: asArrayBuffer(read.bytes), mime: entry.mime } : read
}

export async function readAsset(
  page: WebContents,
  ref: unknown
): Promise<AssetResult<ComfyDesktopAssetBytes>> {
  const entry = entryOf(page, ref)
  if (!entry) return failure('missing')
  return entry.where === 'local' ? readLocal(entry) : readCloud(entry)
}

async function contentHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex').slice(0, HASH_NAME_LENGTH)
}

async function placeCopy(source: string, target: string): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.part`)
  try {
    await fsp.copyFile(source, temp, fs.constants.COPYFILE_FICLONE)
    await fsp.rename(temp, target)
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

async function copyIntoInput(
  file: string,
  inputRoot: string
): Promise<AssetResult<ComfyDesktopAssetValue>> {
  const extension = path.extname(file).toLowerCase()
  const name = `${await contentHash(file)}${extension}`
  const copiesDir = path.join(inputRoot, COPIES_FOLDER)
  await fsp.mkdir(copiesDir, { recursive: true })
  const realCopies = await realFolder(copiesDir)
  const target = realCopies ? path.join(realCopies, name) : null
  const value = target ? annotatedName(inputRoot, target, 'input') : null
  if (!target || !value) return failure('elsewhere')
  const existing = await fsp.lstat(target).catch(() => null)
  if (existing && !existing.isFile()) return failure('elsewhere')
  if (!existing) await placeCopy(file, target)
  return { value }
}

function copyOnce(file: string, inputRoot: string): Promise<AssetResult<ComfyDesktopAssetValue>> {
  const key = `${inputRoot}\n${file}`
  const pending = copiesUnderWay.get(key)
  if (pending) return pending
  const copy = copyIntoInput(file, inputRoot)
    .catch(() => failure('missing'))
    .finally(() => copiesUnderWay.delete(key))
  copiesUnderWay.set(key, copy)
  return copy
}

async function localRunValue(
  file: string,
  folders: ComfyFolders
): Promise<AssetResult<ComfyDesktopAssetValue>> {
  if (!(await sameRegularFile(file))) return failure('missing')
  const outputRoot = await realFolder(folders.output)
  const inOutput = outputRoot ? annotatedName(outputRoot, file, 'output') : null
  if (inOutput) return { value: inOutput }
  const inputRoot = await realFolder(folders.input)
  if (!inputRoot) return failure('elsewhere')
  const inInput = annotatedName(inputRoot, file, 'input')
  return inInput ? { value: inInput } : copyOnce(file, inputRoot)
}

export async function assetRunValue(
  page: WebContents,
  ref: unknown,
  request: unknown
): Promise<AssetResult<ComfyDesktopAssetValue>> {
  const entry = entryOf(page, ref)
  if (!entry) return failure('missing')
  if (entry.where !== readWhere(request)) return failure('elsewhere')
  if (entry.where === 'cloud') {
    return entry.loaderPath ? { value: `${entry.loaderPath} [output]` } : failure('elsewhere')
  }
  return localRunValue(entry.file, await foldersFor(page))
}

export function _resetForTest(): void {
  copiesUnderWay.clear()
}
