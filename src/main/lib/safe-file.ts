import fs from 'fs'
import path from 'path'

const TRANSIENT_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRIES = 3
const RENAME_DELAY_MS = 100
const READ_RETRIES = 3
const READ_DELAY_MS = 50

function isTransientFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code !== undefined && TRANSIENT_FS_CODES.has(code)
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {}
}

async function fsyncDirBestEffortAsync(dirPath: string): Promise<void> {
  try {
    const handle = await fs.promises.open(dirPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {}
}

let _bakFallbacks = 0

export function getSafeFileDiagnostics(): { bakFallbacks: number } {
  return { bakFallbacks: _bakFallbacks }
}

export type SafeReadOutcome =
  | { kind: 'data'; data: string; primaryUnreadable?: true }
  | { kind: 'absent' }
  | { kind: 'unreadable' }

export function readFileWithRetrySync(filePath: string): SafeReadOutcome {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return data.length > 0 ? { kind: 'data', data } : { kind: 'absent' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'absent' }
      if (isTransientFsError(err) && attempt < READ_RETRIES) {
        sleepSync(READ_DELAY_MS * (attempt + 1))
        continue
      }
      return { kind: 'unreadable' }
    }
  }
}

async function readFileWithRetryAsync(filePath: string): Promise<SafeReadOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8')
      return data.length > 0 ? { kind: 'data', data } : { kind: 'absent' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'absent' }
      if (isTransientFsError(err) && attempt < READ_RETRIES) {
        await new Promise((r) => setTimeout(r, READ_DELAY_MS * (attempt + 1)))
        continue
      }
      return { kind: 'unreadable' }
    }
  }
}

export interface SafeWriteOptions {
  backup?: boolean
  durable?: boolean
}

function writeTmpSync(tmpPath: string, data: string, durable: boolean): void {
  if (!durable) {
    fs.writeFileSync(tmpPath, data, 'utf-8')
    return
  }
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeFileSync(fd, data, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

export function writeFileSafe(
  filePath: string,
  data: string,
  options: SafeWriteOptions = {}
): void {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeTmpSync(tmpPath, data, options.durable === true)
  if (options.backup) {
    try {
      fs.copyFileSync(filePath, bakPath)
    } catch {}
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath)
      if (options.durable) fsyncDirBestEffort(path.dirname(filePath))
      return
    } catch (err) {
      if (isTransientFsError(err) && attempt < RENAME_RETRIES) {
        sleepSync(RENAME_DELAY_MS * (attempt + 1))
        continue
      }
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      throw err
    }
  }
}

export function readFileSafe(
  filePath: string,
  options: { restore?: boolean } = {}
): SafeReadOutcome {
  const primary = readFileWithRetrySync(filePath)
  if (primary.kind === 'data') return primary

  const bakPath = filePath + '.bak'
  const { outcome, restoreBak } = resolveBakFallback(primary, readFileWithRetrySync(bakPath))
  if (restoreBak && options.restore !== false) {
    try {
      fs.copyFileSync(bakPath, filePath)
    } catch {}
  }
  return outcome
}

function resolveBakFallback(
  primary: { kind: 'absent' } | { kind: 'unreadable' },
  bak: SafeReadOutcome
): { outcome: SafeReadOutcome; restoreBak: boolean } {
  if (bak.kind === 'data') {
    _bakFallbacks++
    return {
      outcome: primary.kind === 'unreadable' ? { ...bak, primaryUnreadable: true } : bak,
      restoreBak: primary.kind === 'absent'
    }
  }
  return {
    outcome:
      primary.kind === 'unreadable' || bak.kind === 'unreadable'
        ? { kind: 'unreadable' }
        : { kind: 'absent' },
    restoreBak: false
  }
}

async function writeTmpAsync(tmpPath: string, data: string, durable: boolean): Promise<void> {
  if (!durable) {
    await fs.promises.writeFile(tmpPath, data, 'utf-8')
    return
  }
  const handle = await fs.promises.open(tmpPath, 'w')
  try {
    await handle.writeFile(data, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writeFileSafeAsync(
  filePath: string,
  data: string,
  options: SafeWriteOptions = {}
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await writeTmpAsync(tmpPath, data, options.durable === true)
  if (options.backup) {
    try {
      await fs.promises.copyFile(filePath, bakPath)
    } catch {}
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmpPath, filePath)
      if (options.durable) await fsyncDirBestEffortAsync(path.dirname(filePath))
      return
    } catch (err) {
      if (isTransientFsError(err) && attempt < RENAME_RETRIES) {
        await new Promise((r) => setTimeout(r, RENAME_DELAY_MS * (attempt + 1)))
        continue
      }
      try {
        await fs.promises.unlink(tmpPath)
      } catch {}
      throw err
    }
  }
}

export async function readFileSafeAsync(
  filePath: string,
  options: { restore?: boolean } = {}
): Promise<SafeReadOutcome> {
  const primary = await readFileWithRetryAsync(filePath)
  if (primary.kind === 'data') return primary

  const bakPath = filePath + '.bak'
  const { outcome, restoreBak } = resolveBakFallback(primary, await readFileWithRetryAsync(bakPath))
  if (restoreBak && options.restore !== false) {
    try {
      await fs.promises.copyFile(bakPath, filePath)
    } catch {}
  }
  return outcome
}
