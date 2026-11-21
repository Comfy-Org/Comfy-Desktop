import fs from 'fs'

export type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch {
    return null
  }
}
