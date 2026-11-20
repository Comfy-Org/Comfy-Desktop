import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { ipcMain } from 'electron'

import { openEmbeddedWorkflow } from '../apps/openInComfy'
import type { WorkflowPlace } from '../apps/openInComfy'
import { isBuildId } from '../apps/openRequest'
import { isPanelSender } from '../host/registry'
import type { ComfyDesktopOpenInComfy } from '../../types/comfyDesktopBridge'
import { LOCAL_ASSETS_SOURCE } from '../../types/ipc'
import { cloudAccessToken, firstBytes, resolveCloudContentUrl } from './assets'
import { isPng, readEmbeddedWorkflow } from './embeddedWorkflow'
import type { EmbeddedWorkflow } from './embeddedWorkflow'
import * as i18n from './i18n'
import { outputFilePath, READ_WITHOUT_FOLLOWING } from './outputFolders'

export const ASSET_WORKFLOW_CHANNELS = {
  has: 'assets:has-workflow',
  open: 'assets:open-workflow'
} as const

export const PART_BYTES = 4 * 1024 * 1024
const READ_TIMEOUT_MS = 30_000
const REMEMBERED_CLOUD_ASSETS = 20

const remembered = new Map<string, Promise<ReadFile | null>>()

async function readPart(
  handle: fsp.FileHandle,
  position: number,
  length: number
): Promise<Uint8Array> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
}

function headHoldsPngWorkflow(head: Uint8Array): boolean {
  return isPng(head) && readEmbeddedWorkflow([head])?.format === 'graph'
}

async function localParts(assetId: string): Promise<Uint8Array[] | null> {
  const file = await outputFilePath(assetId)
  if (!file) return null
  const handle = await fsp.open(file, READ_WITHOUT_FOLLOWING)
  try {
    const { size } = await handle.stat()
    const head = await readPart(handle, 0, Math.min(size, PART_BYTES))
    if (size <= PART_BYTES) return [head]
    if (size <= PART_BYTES * 2) {
      const rest = await readPart(handle, PART_BYTES, size - PART_BYTES)
      return [Buffer.concat([head, rest])]
    }
    if (headHoldsPngWorkflow(head)) return [head]
    const tailStart = Math.max(PART_BYTES, size - PART_BYTES)
    return [head, await readPart(handle, tailStart, size - tailStart)]
  } finally {
    await handle.close()
  }
}

function totalSize(response: Response): number | null {
  const match = /\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '')
  return match ? Number(match[1]) : null
}

async function rangeOf(url: string, range: string, deadline: AbortSignal): Promise<Response> {
  return fetch(url, { headers: { Range: range }, redirect: 'error', signal: deadline })
}

async function unread(response: Response): Promise<null> {
  await response.body?.cancel().catch(() => {})
  return null
}

async function cloudParts(assetId: string, accessToken: string): Promise<Uint8Array[] | null> {
  const deadline = AbortSignal.timeout(READ_TIMEOUT_MS)
  const url = await resolveCloudContentUrl(assetId, accessToken, 'inline', deadline)
  if (!url) return null
  const headResponse = await rangeOf(url, `bytes=0-${PART_BYTES - 1}`, deadline)
  if (!headResponse.ok) return unread(headResponse)
  const head = await firstBytes(headResponse, PART_BYTES)
  const size = headResponse.status === 206 ? totalSize(headResponse) : null
  if (size === null || size <= PART_BYTES) return [head]
  if (size <= PART_BYTES * 2) {
    const restResponse = await rangeOf(url, `bytes=${PART_BYTES}-`, deadline)
    if (restResponse.status === 200) return [await firstBytes(restResponse, PART_BYTES * 2)]
    if (restResponse.status !== 206) return unread(restResponse)
    return [Buffer.concat([head, await firstBytes(restResponse, PART_BYTES)])]
  }
  if (headHoldsPngWorkflow(head)) return [head]
  const tailResponse = await rangeOf(url, `bytes=-${PART_BYTES}`, deadline)
  if (!tailResponse.ok) return unread(tailResponse)
  if (tailResponse.status !== 206) return [head]
  return [head, await firstBytes(tailResponse, PART_BYTES)]
}

interface ReadFile {
  workflow: EmbeddedWorkflow | null
}

async function workflowIn(
  read: Promise<Uint8Array[] | null>,
  onUnread: () => void = () => {}
): Promise<ReadFile | null> {
  const parts = await read.catch(() => null)
  if (!parts) onUnread()
  return parts ? { workflow: readEmbeddedWorkflow(parts) } : null
}

function sessionKey(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex')
}

function rememberCloud(key: string, read: Promise<ReadFile | null>): void {
  remembered.delete(key)
  remembered.set(key, read)
  if (remembered.size > REMEMBERED_CLOUD_ASSETS) {
    remembered.delete(remembered.keys().next().value!)
  }
}

async function readAsset(source: string, assetId: string): Promise<ReadFile | null> {
  if (source === LOCAL_ASSETS_SOURCE) return workflowIn(localParts(assetId))
  const accessToken = await cloudAccessToken(source)
  if (!accessToken) return null
  const key = `${source}\n${assetId}\n${sessionKey(accessToken)}`
  const known = remembered.get(key)
  if (known) return known
  const read = workflowIn(cloudParts(assetId, accessToken), () => remembered.delete(key))
  rememberCloud(key, read)
  return read
}

function placeOf(source: string, build: unknown): WorkflowPlace | null {
  if (source !== LOCAL_ASSETS_SOURCE) return { where: 'cloud' }
  return isBuildId(build) ? { where: 'local', build } : null
}

function titleOf(name: unknown): string {
  if (typeof name !== 'string') return ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

async function openAssetWorkflow(
  source: string,
  assetId: string,
  name: unknown,
  build: unknown
): Promise<ComfyDesktopOpenInComfy> {
  const place = placeOf(source, build)
  if (!place) return { opened: false, error: i18n.t('apps.local.openUnknownBuild') }
  const read = await readAsset(source, assetId)
  if (!read) return { opened: false, error: i18n.t('apps.local.openUnreadable') }
  if (!read.workflow) return { opened: false, error: i18n.t('apps.local.openNotWorkflow') }
  return openEmbeddedWorkflow(place, read.workflow, titleOf(name))
}

export function registerAssetWorkflowHandlers(): void {
  ipcMain.handle(
    ASSET_WORKFLOW_CHANNELS.has,
    async (event, source: unknown, assetId: unknown): Promise<boolean | null> => {
      if (!isPanelSender(event.sender)) return false
      if (typeof source !== 'string' || typeof assetId !== 'string') return false
      const read = await readAsset(source, assetId)
      return read ? read.workflow !== null : null
    }
  )
  ipcMain.handle(
    ASSET_WORKFLOW_CHANNELS.open,
    (
      event,
      source: unknown,
      assetId: unknown,
      name: unknown,
      build: unknown
    ): ComfyDesktopOpenInComfy | Promise<ComfyDesktopOpenInComfy> =>
      isPanelSender(event.sender) && typeof source === 'string' && typeof assetId === 'string'
        ? openAssetWorkflow(source, assetId, name, build)
        : { opened: false, error: i18n.t('apps.local.openNotTaken') }
  )
}

export function _resetForTest(): void {
  remembered.clear()
}
