import path from 'node:path'
import process from 'node:process'

export const VIDEO_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'videos')
export const VIDEO_SIZE = { width: 1280, height: 800 } as const
export const VIDEO_PACE_MS = 1000

export interface RecordVideoOptions {
  dir: string
  size: { width: number; height: number }
}

export function videoRecordingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['E2E_VIDEO']
  return value !== undefined && value !== '' && value !== '0'
}

export function recordVideoOptions(
  env: NodeJS.ProcessEnv = process.env
): RecordVideoOptions | undefined {
  if (!videoRecordingEnabled(env)) return undefined
  return { dir: VIDEO_DIR, size: { ...VIDEO_SIZE } }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withPausesAround<T>(action: () => Promise<T>): Promise<T> {
  await pause(VIDEO_PACE_MS)
  const result = await action()
  await pause(VIDEO_PACE_MS)
  return result
}

export function pacedForVideo<T>(
  action: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T> {
  if (!videoRecordingEnabled(env)) return action()
  return withPausesAround(action)
}
